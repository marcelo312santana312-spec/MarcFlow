import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { GoogleGenAI } from "@google/genai";
import { sendScheduledMessage } from "@/modules/whatsapp/scheduler";
import { logger } from "@/lib/logger";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import sharp from "sharp";
import moment from "moment-timezone";

const execFileAsync = promisify(execFile);

export interface AiStudioMediaItem {
    id: string;
    type: "image" | "video";
    prompt: string;
    enhancedPrompt?: string;
    caption?: string;
    model: string;
    aspectRatio: string;
    filename: string;
    url: string;
    localPath: string;
    createdAt: string;
}

function getStudioDir(sessionId: string): string {
    const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(process.cwd(), "public", "ai-studio", safeSession);
}

function buildFileUrl(sessionId: string, filename: string): string {
    const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
    return `/api/ai-studio/${safeSession}?file=${encodeURIComponent(path.basename(filename))}`;
}

async function readGalleryIndex(sessionId: string): Promise<AiStudioMediaItem[]> {
    const dir = getStudioDir(sessionId);
    const indexPath = path.join(dir, "index.json");
    try {
        const raw = await fs.readFile(indexPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((item: AiStudioMediaItem) => ({
            ...item,
            url: buildFileUrl(sessionId, item.filename),
        }));
    } catch {
        return [];
    }
}

async function writeGalleryIndex(sessionId: string, items: AiStudioMediaItem[]): Promise<void> {
    const dir = getStudioDir(sessionId);
    await fs.mkdir(dir, { recursive: true });
    const indexPath = path.join(dir, "index.json");
    await fs.writeFile(indexPath, JSON.stringify(items, null, 2), "utf-8");
}

async function resolveGeminiApiKey(sessionId: string): Promise<{ apiKey: string | null; dbSessionId: string | null }> {
    const session = await (prisma as any).session.findUnique({
        where: { sessionId },
        select: {
            id: true,
            botConfig: {
                select: { aiApiKey: true },
            },
        },
    });

    const keyFromDb = session?.botConfig?.aiApiKey?.trim() || null;
    const keyFromEnv = process.env.GEMINI_API_KEY?.trim() || null;

    return {
        apiKey: keyFromDb || keyFromEnv || null,
        dbSessionId: session?.id || null,
    };
}

function createGenAIClients(apiKey: string): { primary: GoogleGenAI; secondary: GoogleGenAI; isVertexKey: boolean } {
    const isVertexKey = apiKey.startsWith("AQ.");
    const primary = new GoogleGenAI(
        isVertexKey
            ? { vertexai: true, apiKey, project: "gen-lang-client-0642333908", location: "us-central1" }
            : { apiKey }
    );
    const secondary = new GoogleGenAI(
        isVertexKey
            ? { vertexai: false, apiKey }
            : { vertexai: true, apiKey, project: "gen-lang-client-0642333908", location: "us-central1" }
    );
    return { primary, secondary, isVertexKey };
}

function sanitizeJid(rawJid: string): string {
    const trimmed = (rawJid || "").trim();
    if (trimmed === "status@broadcast" || trimmed.endsWith("@g.us") || trimmed.endsWith("@newsletter")) {
        return trimmed;
    }
    const cleanNumber = trimmed.split("@")[0].replace(/\D/g, "");
    return `${cleanNumber}@s.whatsapp.net`;
}

async function translatePtToEnFree(text: string): Promise<string> {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
        const { stdout } = await execFileAsync("curl", ["-4", "-fsSL", "--max-time", "10", url], {
            encoding: "utf8",
        });
        const parsed = JSON.parse(stdout);
        if (Array.isArray(parsed?.[0])) {
            const joined = parsed[0].map((seg: any) => seg?.[0] || "").join("");
            if (joined.trim()) return joined.trim();
        }
    } catch {}
    return text;
}

async function generateTextWithGeminiFallback(
    apiKey: string,
    contents: any,
    config?: Record<string, any>
): Promise<string> {
    const { primary, secondary } = createGenAIClients(apiKey);
    const textModels = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash", "gemini-3.8-flash"];
    let lastErr: any = null;

    for (const client of [primary, secondary]) {
        for (const model of textModels) {
            try {
                const res = await client.models.generateContent({
                    model,
                    contents,
                    config,
                });
                if (res.text) return res.text;
            } catch (err) {
                lastErr = err;
            }
        }
    }
    throw lastErr || new Error("Falha ao comunicar com os modelos de texto do Gemini.");
}

async function buildEnglishVisualPromptWithGemini(
    apiKey: string,
    rawPrompt: string,
    stylePreset: string,
    referenceImageBase64?: string | null,
    referenceImageMimeType?: string
): Promise<string> {
    const photoPrefix =
        "RAW photo, photorealistic DSLR photography, 85mm f/1.4 lens, ultra-detailed realistic skin and surface texture, natural golden hour lighting, 8k resolution, sharp focus:";
    try {
        const contents: any[] = [];
        if (referenceImageBase64) {
            contents.push({
                inlineData: {
                    data: referenceImageBase64.replace(/^data:[^;]+;base64,/, ""),
                    mimeType: referenceImageMimeType || "image/png",
                },
            });
            contents.push({
                text: `Describe the subject/product in this reference image in detail (colors, shape, material, branding) and combine it with this scene request: "${rawPrompt}". Style: "${stylePreset}". Output ONLY a single concise English photorealistic DSLR photography prompt (max 75 words), no quotes or markdown. Never use cartoon or illustration words.`,
            });
        } else {
            contents.push({
                text: `Translate and enhance this visual prompt into a hyper-realistic English DSLR photography prompt (max 75 words, no quotes, no markdown). Idea: "${rawPrompt}". Style: "${stylePreset}". Must look like a real photograph taken with a full-frame camera, never a drawing or illustration.`,
            });
        }
        const out = await generateTextWithGeminiFallback(apiKey, contents);
        const cleaned = out.replace(/[\r\n]+/g, " ").trim();
        if (cleaned) {
            return `${photoPrefix} ${cleaned}`;
        }
    } catch (e: any) {
        logger.warn("AiStudio", `Tradutor Gemini indisponível (${e?.message?.slice(0, 80)}), usando tradutor direto PT->EN.`);
    }

    const translatedIdea = await translatePtToEnFree(rawPrompt);
    const translatedStyle = stylePreset ? await translatePtToEnFree(stylePreset) : "";
    return `${photoPrefix} ${translatedIdea}. ${translatedStyle}`.trim();
}

async function curlPostJson(url: string, bodyObj: any, maxTimeSec = 45): Promise<string> {
    const tmpFile = path.join(
        os.tmpdir(),
        `marcflow_curl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`
    );
    await fs.writeFile(tmpFile, JSON.stringify(bodyObj), "utf8");
    try {
        const { stdout } = await execFileAsync(
            "curl",
            [
                "-4",
                "-fsSL",
                "--max-time",
                String(maxTimeSec),
                "-X",
                "POST",
                url,
                "-H",
                "Content-Type: application/json",
                "-d",
                `@${tmpFile}`,
            ],
            { encoding: "utf8", maxBuffer: 35 * 1024 * 1024 }
        );
        return stdout;
    } finally {
        await fs.unlink(tmpFile).catch(() => {});
    }
}

function fitSpeechToVideoDuration(rawText: string, maxChars = 145): string {
    const clean = rawText
        .replace(/https?:\/\/\S+/g, "")
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
        .replace(/[*_~`#]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    if (!clean || clean.length <= maxChars) return clean;

    const sentences = clean
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

    let result = "";
    for (const s of sentences) {
        if ((result + " " + s).trim().length <= maxChars) {
            result = (result + " " + s).trim();
        } else {
            break;
        }
    }
    if (result) return result;

    // Se a primeira frase já excede maxChars, cortar no último espaço ou vírgula antes do limite e fechar pontuação
    const slice = clean.slice(0, maxChars - 1);
    const lastComma = slice.lastIndexOf(",");
    const lastSpace = slice.lastIndexOf(" ");
    const cutIdx = lastComma > maxChars * 0.55 ? lastComma : lastSpace > 20 ? lastSpace : slice.length;
    const trimmed = slice.slice(0, cutIdx).replace(/[,:;\s]+$/, "");
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}!`;
}

async function synthesizePortugueseVoiceover(
    rawScript: string,
    voiceId: string,
    outputMp3Path: string,
    apiKey?: string
): Promise<boolean> {
    const cleanScript = fitSpeechToVideoDuration(rawScript, 145);
    if (!cleanScript || voiceId === "none") return false;

    // 1. Motor Principal: Google Gemini Native Studio TTS (Voz humana expressiva, calorosa e natural em PT-BR)
    if (apiKey) {
        try {
            const geminiVoice = voiceId === "br_005" ? "Puck" : voiceId === "br_003" ? "Kore" : "Aoede";
            const { primary: ttsAi } = createGenAIClients(apiKey);
            const ttsRes = await ttsAi.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [
                    {
                        text: `Speak warmly, naturally and enthusiastically in Brazilian Portuguese: ${cleanScript}`,
                    },
                ],
                config: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: geminiVoice },
                        },
                    },
                } as any,
            });
            const inlineAudio = ttsRes?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData;
            if (inlineAudio?.data) {
                const pcmPath = `${outputMp3Path}.pcm`;
                await fs.writeFile(pcmPath, Buffer.from(inlineAudio.data, "base64"));
                await execFileAsync("ffmpeg", [
                    "-y",
                    "-f",
                    "s16le",
                    "-ar",
                    "24000",
                    "-ac",
                    "1",
                    "-i",
                    pcmPath,
                    "-c:a",
                    "libmp3lame",
                    "-b:a",
                    "192k",
                    outputMp3Path,
                ]);
                await fs.unlink(pcmPath).catch(() => {});
                logger.success("AiStudio", `Voz humana Gemini Studio (${geminiVoice}) sintetizada com sucesso!`);
                return true;
            }
        } catch (gemErr: any) {
            logger.warn("AiStudio", `Gemini Studio TTS falhou (${gemErr?.message?.slice(0, 80)}), usando Edge Neural PT-BR...`);
        }
    }

    // 2. Fallback: Voz Neural Brasileira (Microsoft Edge Neural: Thalita, Francisca, Antonio)
    const edgeVoiceMap: Record<string, string> = {
        br_001: "pt-BR-ThalitaMultilingualNeural - pt-BR (Female)",
        br_003: "pt-BR-FranciscaNeural - pt-BR (Female)",
        br_005: "pt-BR-AntonioNeural - pt-BR (Male)",
    };
    const edgeVoice = edgeVoiceMap[voiceId] || edgeVoiceMap.br_001;

    try {
        const postOut = await curlPostJson(
            "https://innoai-edge-tts-text-to-speech.hf.space/gradio_api/call/tts_interface",
            { data: [cleanScript, edgeVoice, 0, 0] },
            15
        );
        const parsedPost = JSON.parse(postOut || "{}");
        if (parsedPost.event_id) {
            const { stdout: sseOut } = await execFileAsync(
                "curl",
                [
                    "-4",
                    "-fsSL",
                    "--max-time",
                    "25",
                    `https://innoai-edge-tts-text-to-speech.hf.space/gradio_api/call/tts_interface/${parsedPost.event_id}`,
                ],
                { encoding: "utf8" }
            );
            const match = sseOut.match(/data:\s*(\[[\s\S]*?\])\s*(?:\r?\n|$)/);
            if (match) {
                const eventData = JSON.parse(match[1]);
                const audioUrl: string | undefined = eventData?.[0]?.url;
                if (audioUrl) {
                    const { stdout: audioBuf } = await execFileAsync(
                        "curl",
                        ["-4", "-fsSL", "--max-time", "20", audioUrl],
                        { encoding: "buffer", maxBuffer: 15 * 1024 * 1024 }
                    );
                    if (audioBuf && audioBuf.length > 1000) {
                        await fs.writeFile(outputMp3Path, audioBuf);
                        logger.success("AiStudio", `Voz humana neural (${edgeVoice.split(" - ")[0]}) sintetizada com sucesso!`);
                        return true;
                    }
                }
            }
        }
    } catch (edgeErr: any) {
        logger.warn("AiStudio", `Edge Neural TTS indisponível (${edgeErr?.message?.slice(0, 80)}), tentando fallback...`);
    }

    // 3. Último fallback: Google Translate TTS (pt-BR)
    try {
        const gUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=pt-BR&q=${encodeURIComponent(cleanScript)}`;
        const { stdout } = await execFileAsync(
            "curl",
            ["-4", "-fsSL", "--max-time", "12", "-A", "Mozilla/5.0", gUrl],
            { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 }
        );
        if (stdout && stdout.length > 500) {
            await fs.writeFile(outputMp3Path, stdout);
            return true;
        }
    } catch (err2: any) {
        logger.warn("AiStudio", `Google TTS PT-BR falhou (${err2?.message?.slice(0, 80)})`);
    }

    return false;
}



async function fetchBlackForestFluxUltraHd(
    englishPrompt: string,
    aspectRatio: string,
    referenceImageBase64?: string | null
): Promise<Buffer> {
    const dims =
        aspectRatio === "9:16"
            ? { width: 768, height: 1344 }
            : aspectRatio === "16:9"
            ? { width: 1344, height: 768 }
            : { width: 1024, height: 1024 };

    const cleanRefB64 = referenceImageBase64
        ? referenceImageBase64.replace(/^data:[^;]+;base64,/, "")
        : null;

    // 1. Provedor Dedicado 1: OpenRouter Gemini 3.1 Flash Image + FLUX-3 Klein Autenticado (Sem limite ZeroGPU por IP)
    try {
        const orOut = await curlPostJson(
            "https://bep40-ml-intern-flux3-comic.hf.space/api/openrouter-image",
            {
                prompt: englishPrompt,
                aspect: aspectRatio,
                images: cleanRefB64 ? [cleanRefB64] : [],
            },
            45
        );

        const parsedOr = JSON.parse(orOut || "{}");
        if (parsedOr.b64) {
            const rawB64 = String(parsedOr.b64).replace(/^data:[^;]+;base64,/, "");
            const buf = Buffer.from(rawB64, "base64");
            if (buf.length > 5000) {
                return await sharp(buf).png({ quality: 100 }).toBuffer();
            }
        }
    } catch (err: any) {
        logger.warn("AiStudio", `Provedor dedicado 1 (OpenRouter/FLUX-3) indisponível (${err?.message?.slice(0, 100)}), tentando Provedor 2...`);
    }

    // 2. Provedor Dedicado 2: Proxy Direto FLUX-3 Image Klein 16-Steps com Token HF Dedicado
    try {
        const parts: any[] = [{ text: englishPrompt }];
        if (cleanRefB64) {
            parts.push({ inlineData: { data: cleanRefB64, mimeType: "image/png" } });
        }

        const proxyOut = await curlPostJson(
            "https://bep40-ml-intern-flux3-comic.hf.space/api/proxy/gemini/v1beta/models/flux-image:generateContent",
            {
                contents: [{ parts }],
                generationConfig: {
                    aspectRatio,
                    width: dims.width,
                    height: dims.height,
                },
            },
            55
        );

        const parsedProxy = JSON.parse(proxyOut || "{}");
        const b64Data = parsedProxy?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (b64Data) {
            const buf = Buffer.from(b64Data, "base64");
            if (buf.length > 5000) {
                return await sharp(buf).png({ quality: 100 }).toBuffer();
            }
        }
    } catch (err: any) {
        logger.warn("AiStudio", `Provedor dedicado 2 (FLUX-3 Proxy) indisponível (${err?.message?.slice(0, 100)}), tentando Provedor 3...`);
    }

    // 3. Provedor 3: Pool Gradio FLUX (FLUX-3 Klein + Black Forest Labs FLUX.1 Schnell / Dev)
    const gradioPool = [
        {
            url: "https://bep40-flux-3-image-klein.hf.space",
            endpoint: "generate",
            data: [englishPrompt, null, "Distilled (16 steps)", 0, true, dims.width, dims.height, 16, 1.0, true],
        },
        {
            url: "https://black-forest-labs-flux-1-schnell.hf.space",
            endpoint: "infer",
            data: [englishPrompt, 0, true, dims.width, dims.height, 4],
        },
        {
            url: "https://black-forest-labs-flux-1-dev.hf.space",
            endpoint: "infer",
            data: [englishPrompt, 0, true, dims.width, dims.height, 20],
        },
    ];

    for (const provider of gradioPool) {
        try {
            const payload = JSON.stringify({ data: provider.data });

            const { stdout: postOut } = await execFileAsync(
                "curl",
                [
                    "-4",
                    "-fsSL",
                    "--max-time",
                    "25",
                    "-X",
                    "POST",
                    `${provider.url}/gradio_api/call/${provider.endpoint}`,
                    "-H",
                    "Content-Type: application/json",
                    "-d",
                    payload,
                ],
                { encoding: "utf8" }
            );

            const parsedPost = JSON.parse(postOut || "{}");
            const eventId = parsedPost.event_id;
            if (!eventId) continue;

            const { stdout: sseOut } = await execFileAsync(
                "curl",
                ["-4", "-fsSL", "--max-time", "60", `${provider.url}/gradio_api/call/${provider.endpoint}/${eventId}`],
                { encoding: "utf8" }
            );

            const match = sseOut.match(/data:\s*(\[[\s\S]*?\])\s*(?:\r?\n|$)/);
            if (!match) continue;

            const eventData = JSON.parse(match[1]);
            const firstItem = Array.isArray(eventData?.[0]) ? eventData[0][0] : eventData?.[0];
            const fileUrl: string | undefined = firstItem?.url || firstItem?.image?.url;
            if (!fileUrl) continue;

            const { stdout: rawImgBuf } = await execFileAsync(
                "curl",
                ["-4", "-fsSL", "--max-time", "45", fileUrl],
                { encoding: "buffer", maxBuffer: 30 * 1024 * 1024 }
            );

            if (rawImgBuf && rawImgBuf.length > 5000) {
                const pngBuffer = await sharp(rawImgBuf).png({ quality: 100 }).toBuffer();
                return pngBuffer;
            }
        } catch (err: any) {
            logger.warn("AiStudio", `Tentativa em ${provider.url} falhou (${err?.message?.slice(0, 100)}), tentando próximo...`);
        }
    }

    throw new Error("Os servidores de renderização fotográfica FLUX estão temporariamente ocupados. Tente novamente em alguns instantes.");
}

type ProviderHealth = {
    id: string;
    name: string;
    category: "video" | "image" | "voice";
    status: "online" | "limited" | "exhausted" | "offline";
    detail: string;
    updatedAt: number;
};

const providerQuotaCache: Record<string, { status: "online" | "limited" | "exhausted" | "offline"; detail: string; updatedAt: number }> = {};

function recordProviderStatus(id: string, status: "online" | "limited" | "exhausted" | "offline", detail: string) {
    providerQuotaCache[id] = { status, detail, updatedAt: Date.now() };
}

async function pingUrlQuick(url: string, timeoutSec = 4): Promise<boolean> {
    try {
        await execFileAsync("curl", ["-4", "-fsSL", "--max-time", String(timeoutSec), url], { encoding: "utf8" });
        return true;
    } catch {
        return false;
    }
}

async function resolveColabVideoUrl(dbSessionId: string): Promise<string> {
    try {
        const s = await prisma.session.findUnique({
            where: { id: dbSessionId },
            select: { config: true },
        });
        const cfg = (s?.config && typeof s.config === "object" ? s.config : {}) as Record<string, any>;
        return String(cfg.colabVideoUrl || "").trim().replace(/\/+$/, "");
    } catch {
        return "";
    }
}

async function generateColabGpuVideo(
    colabUrl: string,
    englishPrompt: string,
    aspectRatio: "9:16" | "16:9",
    imageBase64?: string,
    durationSec = 8
): Promise<Buffer | null> {
    if (!colabUrl) return null;
    const tmpDir = path.join(process.cwd(), "tmp");
    await fs.mkdir(tmpDir, { recursive: true });
    const reqPath = path.join(tmpDir, `colab_req_${Date.now()}.json`);
    const outPath = path.join(tmpDir, `colab_out_${Date.now()}.mp4`);
    try {
        logger.info("AiStudio", `Enviando geração cinematográfica para seu Google Colab GPU (${colabUrl})...`);
        const payload = {
            prompt: englishPrompt,
            aspect_ratio: aspectRatio,
            duration_sec: durationSec,
            image_base64: imageBase64 || null,
        };
        await fs.writeFile(reqPath, JSON.stringify(payload), "utf8");
        await execFileAsync(
            "curl",
            [
                "-4",
                "-fsSL",
                "--max-time",
                "480",
                "-X",
                "POST",
                `${colabUrl}/generate`,
                "-H",
                "Content-Type: application/json",
                "--data-binary",
                `@${reqPath}`,
                "-o",
                outPath,
            ],
            { encoding: "utf8" }
        );
        const buf = await fs.readFile(outPath);
        if (buf.length > 10000) {
            recordProviderStatus("colab-gpu", "online", "Colab GPU conectado e gerando vídeos");
            logger.info("AiStudio", `Vídeo gerado com sucesso no Google Colab GPU (${(buf.length / 1024 / 1024).toFixed(2)} MB)!`);
            return buf;
        }
        return null;
    } catch (err: any) {
        const msg = String(err?.message || "Erro ao conectar no Colab");
        recordProviderStatus("colab-gpu", "offline", "Colab desconectado ou célula parada");
        logger.warn("AiStudio", `Colab GPU indisponível (${msg.slice(0, 120)})`);
        return null;
    } finally {
        await fs.unlink(reqPath).catch(() => {});
        await fs.unlink(outPath).catch(() => {});
    }
}

async function checkAllProvidersHealth(apiKey: string | null, colabUrl?: string): Promise<ProviderHealth[]> {
    const now = Date.now();
    const isFresh = (id: string, ttlMs = 20 * 60 * 1000) => {
        const entry = providerQuotaCache[id];
        return entry && now - entry.updatedAt < ttlMs ? entry : null;
    };

    const [pikaUp, ltxUp, edgeUp, geminiCheck, colabCheck] = await Promise.all([
        pingUrlQuick("https://bep40-ml-intern-flux3-comic.hf.space/api/config", 4),
        pingUrlQuick("https://lightricks-ltx-video-distilled.hf.space/gradio_api/info", 4),
        pingUrlQuick("https://innoai-edge-tts-text-to-speech.hf.space/gradio_api/info", 4),
        (async () => {
            if (!apiKey) return { ok: false, reason: "Chave GEMINI_API_KEY não configurada" };
            try {
                const { stdout } = await execFileAsync(
                    "curl",
                    ["-4", "-sS", "--max-time", "5", `https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-fast-generate-001?key=${encodeURIComponent(apiKey)}`],
                    { encoding: "utf8" }
                );
                const j = JSON.parse(stdout || "{}");
                if (j?.name) return { ok: true, reason: "Chave ativa com acesso ao Veo 3.0" };
                if (j?.error?.code === 402 || j?.error?.code === 403) {
                    return { ok: false, reason: j?.error?.message?.slice(0, 70) || "Sem faturamento/créditos" };
                }
                return { ok: true, reason: "Chave Gemini conectada" };
            } catch {
                return { ok: false, reason: "Sem conexão com Google AI" };
            }
        })(),
        (async () => {
            if (!colabUrl) return { configured: false, ok: false, detail: "URL do Colab não configurada" };
            try {
                const { stdout } = await execFileAsync(
                    "curl",
                    ["-4", "-fsSL", "--max-time", "4", `${colabUrl}/health`],
                    { encoding: "utf8" }
                );
                const j = JSON.parse(stdout || "{}");
                if (j?.ok) {
                    return {
                        configured: true,
                        ok: true,
                        detail: `${j.gpu || "GPU"} • ${j.model || "Wan 2.1"}`,
                    };
                }
                return { configured: true, ok: false, detail: "Colab respondeu sem status OK" };
            } catch {
                return { configured: true, ok: false, detail: "Túnel Colab offline (inicie a célula no Colab)" };
            }
        })(),
    ]);

    const veoCached = isFresh("google-veo");
    const pikaCached = isFresh("pika-h3");
    const ltxCached = isFresh("ltx-video");

    return [
        ...(colabCheck.configured
            ? [
                  {
                      id: "colab-gpu",
                      name: "Google Colab GPU (A100/L4)",
                      category: "video" as const,
                      status: (colabCheck.ok ? "online" : "offline") as "online" | "offline",
                      detail: colabCheck.detail,
                      updatedAt: now,
                  },
              ]
            : []),
        {
            id: "google-veo",
            name: "Google Veo 3.0 / 2.0",
            category: "video",
            status: veoCached ? veoCached.status : geminiCheck.ok ? "online" : "exhausted",
            detail: veoCached ? veoCached.detail : geminiCheck.reason,
            updatedAt: veoCached?.updatedAt || now,
        },
        {
            id: "pika-h3",
            name: "Pika H3 / MiniMax (Grátis)",
            category: "video",
            status: pikaCached ? pikaCached.status : pikaUp ? "online" : "offline",
            detail: pikaCached ? pikaCached.detail : pikaUp ? "Conectado (cota diária livre)" : "Servidor fora do ar",
            updatedAt: pikaCached?.updatedAt || now,
        },
        {
            id: "ltx-video",
            name: "LTX-Video Nuvem (Grátis)",
            category: "video",
            status: ltxCached ? ltxCached.status : ltxUp ? "online" : "offline",
            detail: ltxCached ? ltxCached.detail : ltxUp ? "Conectado (~20s por vídeo)" : "Servidor fora do ar",
            updatedAt: ltxCached?.updatedAt || now,
        },
        {
            id: "flux-image",
            name: "FLUX.1 Ultra HD (Imagens)",
            category: "image",
            status: pikaUp || geminiCheck.ok ? "online" : "offline",
            detail: pikaUp ? "Servidor dedicado conectado" : geminiCheck.ok ? "Via Google Gemini" : "Offline",
            updatedAt: now,
        },
        {
            id: "human-voice",
            name: "Voz Humana Neural PT-BR",
            category: "voice",
            status: geminiCheck.ok || edgeUp ? "online" : "offline",
            detail: geminiCheck.ok ? "Gemini Studio + Edge Neural ativos" : edgeUp ? "Edge Neural PT-BR ativo" : "Offline",
            updatedAt: now,
        },
    ];
}

// 4. Motor de Difusão de Vídeo Real em Nuvem (Pika H3 Flex 8-10s 14-Steps HD + Fallback MiniMax H3 - Zero Carga no Celular)
async function generateCloudDiffusionVideo(
    prompt: string,
    aspectRatio: "9:16" | "16:9",
    imageBytesBase64?: string | null,
    durationSec = 8,
    spokenScript = ""
): Promise<Buffer | null> {
    const host = "https://bep40-ml-intern-flux3-comic.hf.space";
    const canvas = aspectRatio === "9:16" ? "640x1152 9:16" : "1152x640 16:9";
    const targetDuration = Math.min(10, Math.max(8, Math.round(durationSec)));
    const speechTag = spokenScript ? ` <d>[Portuguese] ${spokenScript}</d>` : "";
    const fluidPrompt = `photorealistic 4k DSLR cinematic video, crisp sharp focus, smooth continuous fluid motion, natural lively human gestures and expressions, ${prompt}.${speechTag}`;
    const cleanImg = imageBytesBase64 ? imageBytesBase64.replace(/^data:[^;]+;base64,/, "") : undefined;

    // 1. Tentar Pika H3 Flex HD (640x1152 / 1152x640, 8 a 10 segundos contínuos, 14 steps para alta nitidez e fluidez)
    try {
        logger.info("AiStudio", `Renderizando vídeo HD fluido na nuvem (Pika H3 Flex, ${canvas}, ${targetDuration}s, 14 steps)...`);
        const pikaPayload: any = {
            prompt: fluidPrompt,
            duration: targetDuration,
            steps: 14,
            mode: "single",
            lora: "off",
            with_audio: !spokenScript,
            canvas,
            ...(cleanImg ? { image_b64: cleanImg } : {}),
        };
        const jsonStr = await curlPostJson(`${host}/api/video/minimax`, pikaPayload, 240);
        const parsed = JSON.parse(jsonStr || "{}");
        if (parsed.video_b64) {
            const buf = Buffer.from(parsed.video_b64, "base64");
            if (buf.length > 50000) {
                recordProviderStatus("pika-h3", "online", "Gerando normalmente");
                logger.success("AiStudio", `Vídeo Pika H3 Flex HD (${targetDuration}s) gerado na nuvem! Tamanho: ${buf.length} bytes`);
                return buf;
            }
        }
        if (parsed.detail && /quota|exceeded|limit|credit/i.test(String(parsed.detail))) {
            recordProviderStatus("pika-h3", "exhausted", "Cota diária ZeroGPU esgotada");
        }
    } catch (err: any) {
        const msg = String(err?.message || "");
        if (/quota|exceeded|402|429/i.test(msg)) {
            recordProviderStatus("pika-h3", "exhausted", "Cota diária ZeroGPU esgotada");
        }
        logger.warn("AiStudio", `Pika H3 Flex falhou (${msg.slice(0, 100)}), tentando LTX-Video...`);
    }

    // 2. Provedor 2: Lightricks LTX-Video Distilled (Suporta Image-to-Video e Text-to-Video, 7-8s em ~19s, cota independente)
    try {
        const ltxHost = "https://lightricks-ltx-video-distilled.hf.space";
        const ltxDur = Math.min(8, Math.max(6, Math.round(durationSec)));
        const ltxH = aspectRatio === "9:16" ? 896 : 512;
        const ltxW = aspectRatio === "9:16" ? 512 : 896;

        let uploadedImgObj: any = null;
        let endpoint = "text_to_video";
        let modeStr = "text-to-video";

        if (cleanImg) {
            const tmpImgPath = path.join(os.tmpdir(), `ltx_ref_${Date.now()}.png`);
            try {
                await fs.writeFile(tmpImgPath, Buffer.from(cleanImg, "base64"));
                const { stdout: upOut } = await execFileAsync(
                    "curl",
                    ["-4", "-fsSL", "--max-time", "25", "-F", `files=@${tmpImgPath}`, `${ltxHost}/gradio_api/upload`],
                    { encoding: "utf8" }
                );
                const uploadedPaths = JSON.parse(upOut || "[]");
                if (Array.isArray(uploadedPaths) && uploadedPaths[0]) {
                    uploadedImgObj = { path: uploadedPaths[0], meta: { _type: "gradio.FileData" } };
                    endpoint = "image_to_video";
                    modeStr = "image-to-video";
                }
            } finally {
                await fs.unlink(tmpImgPath).catch(() => {});
            }
        }

        logger.info("AiStudio", `Renderizando vídeo em nuvem com Lightricks LTX-Video (${modeStr}, ${ltxW}x${ltxH}, ${ltxDur}s)...`);
        const ltxPayload = {
            data: [
                fluidPrompt,
                "worst quality, inconsistent motion, blurry, jittery, distorted, static",
                uploadedImgObj,
                null,
                ltxH,
                ltxW,
                modeStr,
                ltxDur,
                9,
                Math.floor(Math.random() * 100000),
                true,
                1,
                true,
            ],
        };
        const postOut = await curlPostJson(`${ltxHost}/gradio_api/call/${endpoint}`, ltxPayload, 30);
        const { event_id } = JSON.parse(postOut || "{}");
        if (event_id) {
            const { stdout: sseOut } = await execFileAsync(
                "curl",
                ["-4", "-fsSL", "--max-time", "120", `${ltxHost}/gradio_api/call/${endpoint}/${event_id}`],
                { encoding: "utf8" }
            );
            const match = sseOut.match(/data:\s*(\[[\s\S]*?\])\s*(?:\r?\n|$)/);
            if (match) {
                const eventData = JSON.parse(match[1]);
                const vidUrl: string | undefined = eventData?.[0]?.video?.url || eventData?.[0]?.url;
                if (vidUrl) {
                    const { stdout: vidBuf } = await execFileAsync(
                        "curl",
                        ["-4", "-fsSL", "--max-time", "60", vidUrl],
                        { encoding: "buffer", maxBuffer: 40 * 1024 * 1024 }
                    );
                    if (vidBuf && vidBuf.length > 50000) {
                        recordProviderStatus("ltx-video", "online", "Gerando normalmente (~20s)");
                        logger.success("AiStudio", `Vídeo Lightricks LTX-Video (${ltxDur}s) gerado na nuvem! Tamanho: ${vidBuf.length} bytes`);
                        return vidBuf;
                    }
                }
            } else if (sseOut.includes("event: error")) {
                recordProviderStatus("ltx-video", "exhausted", "Cota gratuita de IP esgotada hoje (tente 4G)");
            }
        }
    } catch (ltxErr: any) {
        logger.warn("AiStudio", `Lightricks LTX-Video falhou (${ltxErr?.message?.slice(0, 100)}), tentando MiniMax H3 Turbo...`);
    }

    // 3. Fallback para MiniMax H3 Turbo (10 steps, até 8s)
    try {
        const h3Payload: any = {
            prompt: fluidPrompt,
            duration: Math.min(8, targetDuration),
            steps: 10,
            canvas,
            ...(cleanImg ? { image_b64: cleanImg } : {}),
        };
        const jsonStr = await curlPostJson(`${host}/api/video/minimax-h3`, h3Payload, 240);
        const parsed = JSON.parse(jsonStr || "{}");
        if (parsed.video_b64) {
            const buf = Buffer.from(parsed.video_b64, "base64");
            if (buf.length > 50000) {
                logger.success("AiStudio", `Vídeo MiniMax H3 gerado na nuvem! Tamanho: ${buf.length} bytes`);
                return buf;
            }
        }
    } catch (err: any) {
        logger.warn("AiStudio", `MiniMax H3 falhou (${err?.message?.slice(0, 100)})`);
    }
    return null;
}

// GET: Serve media file (?file=...) OR List generated media & check API Key status
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;

        const requestedFile = request.nextUrl.searchParams.get("file");
        if (requestedFile) {
            const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
            const safeFile = path.basename(requestedFile);
            const filePath = path.join(process.cwd(), "public", "ai-studio", safeSession, safeFile);

            try {
                const buffer = await fs.readFile(filePath);
                const ext = path.extname(safeFile).toLowerCase();
                const mimeType =
                    ext === ".mp4"
                        ? "video/mp4"
                        : ext === ".webp"
                        ? "image/webp"
                        : ext === ".jpg" || ext === ".jpeg"
                        ? "image/jpeg"
                        : "image/png";

                return new NextResponse(new Uint8Array(buffer), {
                    status: 200,
                    headers: {
                        "Content-Type": mimeType,
                        "Content-Length": String(buffer.length),
                        "Content-Disposition": `inline; filename="${safeFile}"`,
                        "Cache-Control": "public, max-age=31536000, immutable",
                    },
                });
            } catch {
                return NextResponse.json({ status: false, message: "Arquivo não encontrado no disco" }, { status: 404 });
            }
        }

        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Não autorizado" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Acesso negado a esta sessão" }, { status: 403 });
        }

        const { apiKey, dbSessionId } = await resolveGeminiApiKey(sessionId);
        const colabUrl = dbSessionId ? await resolveColabVideoUrl(dbSessionId) : "";

        if (request.nextUrl.searchParams.get("status") === "providers") {
            const providers = await checkAllProvidersHealth(apiKey, colabUrl);
            return NextResponse.json({ status: true, data: { providers } });
        }

        const items = await readGalleryIndex(sessionId);

        const maskedApiKey = apiKey
            ? apiKey.length > 10
                ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`
                : "••••••••"
            : null;

        return NextResponse.json({
            status: true,
            data: {
                hasApiKey: Boolean(apiKey),
                maskedApiKey,
                colabUrl,
                items,
            },
        });
    } catch (error: any) {
        logger.error("AiStudio", "Erro ao listar galeria:", error);
        return NextResponse.json(
            { status: false, message: error?.message || "Erro interno ao carregar Estúdio IA" },
            { status: 500 }
        );
    }
}

// POST: Actions (save-api-key, enhance-prompt, generate-image, generate-video, send-whatsapp)
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Não autorizado" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Acesso negado a esta sessão" }, { status: 403 });
        }

        const body = await request.json();
        const action = body.action || "generate-image";

        const { apiKey, dbSessionId } = await resolveGeminiApiKey(sessionId);
        if (!dbSessionId) {
            return NextResponse.json({ status: false, message: "Sessão não encontrada" }, { status: 404 });
        }

        // 1. Salvar Chave da API Gemini
        if (action === "save-api-key") {
            const newKey = (body.apiKey || "").trim();
            if (!newKey) {
                return NextResponse.json({ status: false, message: "Informe uma chave de API válida" }, { status: 400 });
            }

            await (prisma as any).botConfig.upsert({
                where: { sessionId: dbSessionId },
                create: {
                    sessionId: dbSessionId,
                    aiApiKey: newKey,
                    aiEnabled: true,
                },
                update: {
                    aiApiKey: newKey,
                },
            });

            return NextResponse.json({
                status: true,
                message: "Chave da API Google Gemini salva com sucesso!",
            });
        }

        // 1B. Salvar URL do Túnel Google Colab GPU
        if (action === "save-colab-url") {
            const newUrl = String(body.colabUrl || "").trim().replace(/\/+$/, "");
            const existing = await prisma.session.findUnique({
                where: { id: dbSessionId },
                select: { config: true },
            });
            const cfg = (existing?.config && typeof existing.config === "object" ? existing.config : {}) as Record<string, any>;
            await prisma.session.update({
                where: { id: dbSessionId },
                data: {
                    config: {
                        ...cfg,
                        colabVideoUrl: newUrl,
                    },
                },
            });
            return NextResponse.json({
                status: true,
                message: newUrl ? "Servidor Google Colab GPU conectado!" : "URL do Google Colab removida.",
            });
        }

        if (!apiKey) {
            return NextResponse.json(
                {
                    status: false,
                    message: "Chave da API Google Gemini não configurada. Insira sua GEMINI_API_KEY no topo do Estúdio IA.",
                },
                { status: 400 }
            );
        }

        const { primary: ai, isVertexKey } = createGenAIClients(apiKey);

        // 2. Otimizar Prompt + Gerar Legenda para WhatsApp (Com fallback inteligente caso Vertex API esteja desativada no projeto)
        if (action === "enhance-prompt") {
            const rawPrompt = (body.prompt || "").trim();
            const mediaType = body.mediaType === "video" ? "vídeo" : "imagem";
            const stylePreset = body.stylePreset || "";

            if (!rawPrompt) {
                return NextResponse.json({ status: false, message: "Digite uma ideia ou produto primeiro." }, { status: 400 });
            }

            try {
                const sysInstruction = `Você é um diretor de fotografia especialista em retratos hiper-realistas, fotografia comercial de e-commerce (Mercado Livre, Shopee, Amazon) e vídeos virais para Status do WhatsApp e Reels (Google Flow / Veo / FLUX.1).
O usuário vai fornecer uma descrição curta para gerar um(a) ${mediaType}${stylePreset ? ` no estilo "${stylePreset}"` : ""}.
Retorne APENAS um JSON válido (sem markdown) no formato:
{
  "enhancedPrompt": "Prompt fotográfico/cinematográfico hiper-realista em inglês (incluindo natural lifestyle movement, smiling warmly, expressive gestures, natural golden hour lighting, 8k DSLR)",
  "caption": "Legenda persuasiva em português pronta para postar no Status/Grupo do WhatsApp com emojis e chamada para ação (CTA)",
  "speechText": "Fala natural, animada e persuasiva em português do Brasil com EXATAMENTE 16 a 20 palavras (entre 110 e 140 caracteres, frase completa com ponto final, sem emojis nem links) para preencher todo o vídeo de 8 segundos sem pausas"
}`;

                const rawText = await generateTextWithGeminiFallback(apiKey, rawPrompt, {
                    systemInstruction: sysInstruction,
                    responseMimeType: "application/json",
                });

                const parsed = JSON.parse(rawText || "{}");
                if (parsed.enhancedPrompt) {
                    const fittedSpeech = fitSpeechToVideoDuration(
                        parsed.speechText || `Olha só que novidade incrível separamos para você hoje! Venha conferir e garanta já o seu!`,
                        145
                    );
                    return NextResponse.json({
                        status: true,
                        data: {
                            enhancedPrompt: parsed.enhancedPrompt,
                            caption: parsed.caption || `✨ Confira essa novidade incrível! 🔥\n\n👉 Chame aqui ou clique no link para garantir!`,
                            speechText: fittedSpeech,
                        },
                    });
                }
            } catch (err: any) {
                logger.warn("AiStudio", `Enhance prompt via Gemini falhou (${err?.message?.slice(0, 100)}), usando otimizador fotográfico automático.`);
            }

            // Fallback automático caso a API Vertex ainda não esteja ativada no projeto Google Cloud
            const translatedEn = await translatePtToEnFree(rawPrompt);
            const autoEnhanced = `RAW photo, ${translatedEn}, natural golden hour sunlight, 85mm f/1.4 DSLR lens, photorealistic, ultra detailed skin and surface texture, cinematic lighting, sharp focus, 8k`;
            const autoCaption = `🔥 *Destaque Especial!* ✨\n\n${rawPrompt.charAt(0).toUpperCase() + rawPrompt.slice(1)} com condições imperdíveis!\n\n🛒 Confira agora mesmo e garanta o seu! 👇`;
            const autoSpeech = `Olha só esse destaque especial que separamos para você hoje! ${rawPrompt}. Aproveite a oportunidade e clique no link agora mesmo!`;

            return NextResponse.json({
                status: true,
                data: {
                    enhancedPrompt: autoEnhanced,
                    caption: autoCaption,
                    speechText: autoSpeech,
                },
            });
        }

        // 3. Gerar Imagem (Suporta Vertex AI Express Mode "AQ." + Gemini Nano Banana + Black Forest Labs FLUX.1 8K)
        if (action === "generate-image") {
            const prompt = (body.prompt || "").trim();
            const aspectRatio: "1:1" | "9:16" | "16:9" = body.aspectRatio || "9:16";
            const stylePreset = (body.stylePreset || "").trim();
            const requestedModel = body.model || "auto";
            const referenceImageBase64 = body.referenceImageBase64 || null;
            const referenceImageMimeType = body.referenceImageMimeType || "image/png";
            const caption = body.caption || "";

            if (!prompt) {
                return NextResponse.json({ status: false, message: "Digite um prompt para gerar a imagem." }, { status: 400 });
            }

            const ratioHint =
                aspectRatio === "9:16"
                    ? "Vertical 9:16 portrait format for mobile stories/status."
                    : aspectRatio === "16:9"
                    ? "Horizontal 16:9 widescreen format."
                    : "Square 1:1 composition.";

            const fullPrompt = `RAW photograph, photorealistic DSLR 8k, ultra-detailed realistic texture: ${prompt}. ${stylePreset ? `Style: ${stylePreset}.` : ""} ${ratioHint}`;

            let imageBuffer: Buffer | null = null;
            let usedModel = requestedModel;

            const tryGeminiNativeImage = async (modelName: string, includeModalities: boolean) => {
                const contents: any[] = [];
                if (referenceImageBase64) {
                    contents.push({
                        inlineData: {
                            data: referenceImageBase64.replace(/^data:[^;]+;base64,/, ""),
                            mimeType: referenceImageMimeType,
                        },
                    });
                }
                contents.push({ text: `Generate a photorealistic high-resolution photograph: ${fullPrompt}` });

                const response = await ai.models.generateContent({
                    model: modelName,
                    contents,
                    ...(includeModalities
                        ? {
                              config: {
                                  responseModalities: ["IMAGE", "TEXT"],
                              },
                          }
                        : {}),
                });

                const parts = response.candidates?.[0]?.content?.parts || [];
                for (const part of parts) {
                    if (part.inlineData?.data) {
                        const buf = Buffer.from(part.inlineData.data, "base64");
                        if (buf.length > 5000) {
                            usedModel = modelName;
                            return buf;
                        }
                    }
                }
                throw new Error(`O modelo ${modelName} não retornou bytes de imagem.`);
            };

            if (requestedModel !== "flux-1-ultra-hd") {
                const geminiImageModels =
                    requestedModel && requestedModel !== "auto" && !requestedModel.startsWith("imagen-")
                        ? [requestedModel]
                        : ["gemini-2.5-flash-image"];

                for (const mName of geminiImageModels) {
                    try {
                        imageBuffer = await tryGeminiNativeImage(mName, !isVertexKey);
                        if (imageBuffer) break;
                    } catch {
                        try {
                            imageBuffer = await tryGeminiNativeImage(mName, isVertexKey);
                            if (imageBuffer) break;
                        } catch (err2: any) {
                            logger.warn("AiStudio", `Modelo Gemini Image ${mName} indisponível (${err2?.message?.slice(0, 100)}), usando FLUX.1 Ultra-HD...`);
                        }
                    }
                }
            }

            // Motor Fotográfico Ultra HD Black Forest Labs FLUX.1
            if (!imageBuffer) {
                logger.info("AiStudio", "Renderizando fotografia realista 8K com Black Forest Labs FLUX.1...");
                const englishPrompt = await buildEnglishVisualPromptWithGemini(
                    apiKey,
                    prompt,
                    stylePreset,
                    referenceImageBase64,
                    referenceImageMimeType
                );
                imageBuffer = await fetchBlackForestFluxUltraHd(englishPrompt, aspectRatio, referenceImageBase64);
                usedModel = "flux-1-ultra-hd";
            }

            const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const filename = `${id}.png`;
            const dir = getStudioDir(sessionId);
            await fs.mkdir(dir, { recursive: true });
            const filePath = path.join(dir, filename);
            await fs.writeFile(filePath, imageBuffer);

            const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
            const item: AiStudioMediaItem = {
                id,
                type: "image",
                prompt,
                enhancedPrompt: fullPrompt,
                caption,
                model: usedModel,
                aspectRatio,
                filename,
                url: buildFileUrl(sessionId, filename),
                localPath: `public/ai-studio/${safeSession}/${filename}`,
                createdAt: new Date().toISOString(),
            };

            const existing = await readGalleryIndex(sessionId);
            await writeGalleryIndex(sessionId, [item, ...existing]);

            logger.success("AiStudio", `Imagem HD gerada com sucesso (${usedModel}, ${imageBuffer.length} bytes): ${filename}`);
            return NextResponse.json({
                status: true,
                message: "Imagem em Alta Definição gerada com sucesso!",
                data: item,
            });
        }

        // 4. Gerar Vídeo (Movimento Multi-Cena + Fala/Locução Neural PT-BR + Áudio Estéreo MP4 HD)
        if (action === "generate-video") {
            const prompt = (body.prompt || "").trim();
            const aspectRatio: "9:16" | "16:9" = body.aspectRatio === "16:9" ? "16:9" : "9:16";
            const stylePreset = (body.stylePreset || "").trim();
            const requestedModel = body.model || "veo-2.0-generate-001";
            const caption = body.caption || "";
            const rawSpeechText = (body.speechText || "").trim();
            const voiceId = (body.voiceId || "br_001").trim();
            const sourceImageFilename = body.sourceImageFilename || null;
            const referenceImageBase64 = body.referenceImageBase64 || null;
            const referenceImageMimeType = body.referenceImageMimeType || "image/png";

            if (!prompt) {
                return NextResponse.json({ status: false, message: "Digite um prompt descrevendo o movimento/cena do vídeo." }, { status: 400 });
            }

            const fullPrompt = stylePreset ? `${prompt}. Estilo cinematográfico: ${stylePreset}` : prompt;

            let imageInput: { imageBytes: string; mimeType: string } | undefined;
            if (sourceImageFilename) {
                const dir = getStudioDir(sessionId);
                const imgPath = path.join(dir, path.basename(sourceImageFilename));
                const imgBuf = await fs.readFile(imgPath);
                imageInput = {
                    imageBytes: imgBuf.toString("base64"),
                    mimeType: "image/png",
                };
            } else if (referenceImageBase64) {
                imageInput = {
                    imageBytes: referenceImageBase64.replace(/^data:[^;]+;base64,/, ""),
                    mimeType: referenceImageMimeType,
                };
            }

            // Determinar roteiro falado em Português ajustado exatamente ao tempo do vídeo (7-8s, preenchendo todo o vídeo sem silêncio nem cortes)
            let spokenScript = rawSpeechText ? fitSpeechToVideoDuration(rawSpeechText, 145) : "";
            if (!spokenScript && voiceId !== "none") {
                const cleanCaption = fitSpeechToVideoDuration(caption, 145);
                if (cleanCaption && cleanCaption.length >= 12) {
                    spokenScript = cleanCaption;
                } else {
                    const isAlreadyEnglish = /^RAW photo/i.test(prompt);
                    spokenScript = isAlreadyEnglish
                        ? "Oi pessoal! Acabaram de chegar novidades incríveis com preços imperdíveis por aqui, venha conferir hoje mesmo!"
                        : fitSpeechToVideoDuration(`Oi pessoal! Confira essa novidade incrível: ${prompt}. Venha aproveitar as ofertas especiais de hoje mesmo!`, 145);
                }
            }

            const dir = getStudioDir(sessionId);
            await fs.mkdir(dir, { recursive: true });
            const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const tempSpeechPath = path.join(dir, `${tempId}_speech.mp3`);
            let hasSpeechAudio = false;

            if (voiceId !== "none" && spokenScript) {
                try {
                    hasSpeechAudio = await synthesizePortugueseVoiceover(spokenScript, voiceId, tempSpeechPath, apiKey);
                } catch (ttsErr: any) {
                    logger.warn("AiStudio", `Falha ao sintetizar locução PT-BR (${ttsErr?.message?.slice(0, 80)})`);
                }
            }

            const wordCount = spokenScript ? spokenScript.split(/\s+/).filter(Boolean).length : 0;
            const totalDur = hasSpeechAudio
                ? Math.max(8, Math.min(10, Math.ceil(wordCount / 2.2) + 1.5))
                : 8;

            let videoBuffer: Buffer | null = null;
            let usedModel = requestedModel;

            const tryGoogleVeo = async (veoModel: string): Promise<Buffer | null> => {
                try {
                    logger.info("AiStudio", `Enviando solicitação de vídeo cinematográfico ao Google Veo (${veoModel})...`);
                    let operation = await ai.models.generateVideos({
                        model: veoModel,
                        source: {
                            prompt: fullPrompt,
                            ...(imageInput ? { image: imageInput } : {}),
                        },
                        config: {
                            numberOfVideos: 1,
                            aspectRatio,
                        },
                    });

                    const maxAttempts = 42;
                    let attempts = 0;
                    while (!operation.done && attempts < maxAttempts) {
                        await new Promise((resolve) => setTimeout(resolve, 5000));
                        operation = await ai.operations.getVideosOperation({ operation });
                        attempts++;
                    }

                    if (operation.done && !operation.error) {
                        const videoObj = operation.response?.generatedVideos?.[0]?.video;
                        const videoUri = videoObj?.uri;
                        const inlineVideoBytes = (videoObj as any)?.videoBytes;

                        if (inlineVideoBytes) {
                            recordProviderStatus("google-veo", "online", "Gerando normalmente via Google Veo");
                            return Buffer.from(inlineVideoBytes, "base64");
                        } else if (videoUri) {
                            const separator = videoUri.includes("?") ? "&" : "?";
                            const downloadUrl = `${videoUri}${separator}key=${encodeURIComponent(apiKey)}`;
                            const videoRes = await fetch(downloadUrl, {
                                headers: { "x-goog-api-key": apiKey },
                            });
                            if (videoRes.ok) {
                                recordProviderStatus("google-veo", "online", "Gerando normalmente via Google Veo");
                                return Buffer.from(await videoRes.arrayBuffer());
                            }
                        }
                    }
                } catch (err: any) {
                    const msg = String(err?.message || "");
                    if (/402|403|billing|credit|depleted|quota/i.test(msg)) {
                        recordProviderStatus("google-veo", "exhausted", msg.slice(0, 80));
                    }
                    logger.warn("AiStudio", `Google Veo (${veoModel}) indisponível (${msg.slice(0, 120)})`);
                }
                return null;
            };

            const colabUrl = (body.colabUrl || (await resolveColabVideoUrl(dbSessionId)) || "").trim().replace(/\/+$/, "");
            let cachedEnglishPrompt: string | null = null;
            const getEnglishPrompt = async () => {
                if (!cachedEnglishPrompt) {
                    cachedEnglishPrompt = await buildEnglishVisualPromptWithGemini(
                        apiKey,
                        prompt,
                        stylePreset,
                        referenceImageBase64,
                        referenceImageMimeType
                    );
                }
                return cachedEnglishPrompt;
            };

            // 0. Se Google Colab GPU (A100/L4/T4) estiver configurado e selecionado (ou Automático), tentar Colab primeiro!
            if (colabUrl && (requestedModel === "colab-wan" || requestedModel === "minimax-h3-turbo")) {
                const engPrompt = await getEnglishPrompt();
                videoBuffer = await generateColabGpuVideo(
                    colabUrl,
                    engPrompt,
                    aspectRatio,
                    imageInput?.imageBytes,
                    Math.max(10, totalDur)
                );
                if (videoBuffer) {
                    usedModel = "colab-wan-gpu";
                }
            }

            // 1. Se usuário pediu Google Veo explicitamente, tentar Veo primeiro
            if (!videoBuffer && requestedModel.startsWith("veo-")) {
                videoBuffer = await tryGoogleVeo(requestedModel);
                if (videoBuffer) usedModel = requestedModel;
            }

            // 2. Tentar IA Video Diffusion na Nuvem (Pika H3 -> LTX-Video -> MiniMax H3)
            if (!videoBuffer && requestedModel !== "cinematic-multiscene") {
                const englishPrompt = await getEnglishPrompt();
                videoBuffer = await generateCloudDiffusionVideo(
                    englishPrompt,
                    aspectRatio,
                    imageInput?.imageBytes,
                    totalDur,
                    hasSpeechAudio ? spokenScript : ""
                );
                if (videoBuffer) {
                    usedModel = "cloud-video-diffusion";
                }
            }

            // 3. Se os servidores gratuitos atingiram cota diária (ZeroGPU), acionar Google Veo Oficial automaticamente via chave GEMINI_API_KEY
            if (!videoBuffer && requestedModel !== "cinematic-multiscene" && !requestedModel.startsWith("veo-")) {
                logger.info("AiStudio", "Servidores gratuitos atingiram cota de GPU, acionando Google Veo Oficial via sua chave Gemini...");
                for (const veoCandidate of ["veo-3.0-fast-generate-001", "veo-2.0-generate-001"]) {
                    videoBuffer = await tryGoogleVeo(veoCandidate);
                    if (videoBuffer) {
                        usedModel = veoCandidate;
                        break;
                    }
                }
            }

            // Se o vídeo foi gerado (seja pelo Veo ou pela Difusão em Nuvem) e temos locução PT-BR, sincronizar e substituir o áudio
            if (videoBuffer && hasSpeechAudio) {
                const rawPath = path.join(dir, `${tempId}_raw.mp4`);
                const muxPath = path.join(dir, `${tempId}_mux.mp4`);
                try {
                    await fs.writeFile(rawPath, videoBuffer);

                    // Medir durações exatas de vídeo e áudio para nunca cortar a frase no meio
                    let vidDur = totalDur;
                    let spkDur = 0;
                    try {
                        const { stdout: vOut } = await execFileAsync("ffprobe", [
                            "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", rawPath
                        ], { encoding: "utf8" });
                        vidDur = parseFloat(vOut.trim()) || totalDur;

                        const { stdout: aOut } = await execFileAsync("ffprobe", [
                            "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", tempSpeechPath
                        ], { encoding: "utf8" });
                        spkDur = parseFloat(aOut.trim()) || 0;
                    } catch {}

                    let audioFilter = "adelay=200|200,apad";
                    const extraArgs: string[] = [];
                    if (spkDur > 0 && vidDur > 1) {
                        const available = Math.max(1, vidDur - 0.30);
                        if (spkDur > available) {
                            const tempo = Math.min(1.22, Math.max(1.02, spkDur / available));
                            audioFilter = `atempo=${tempo.toFixed(3)},apad`;
                        } else if (vidDur - spkDur > 1.0) {
                            // Evitar silêncio longo no final enquanto a pessoa ainda gesticula: alinhar o fim do vídeo ao término da fala
                            const syncedDur = Math.max(4.5, Math.min(vidDur, spkDur + 0.50));
                            audioFilter = "adelay=200|200,apad";
                            extraArgs.push("-t", syncedDur.toFixed(2));
                        } else if (spkDur + 0.30 < vidDur) {
                            audioFilter = "adelay=200|200,apad";
                        } else {
                            audioFilter = "apad";
                        }
                    }

                    await execFileAsync("ffmpeg", [
                        "-y",
                        "-i",
                        rawPath,
                        "-i",
                        tempSpeechPath,
                        "-map",
                        "0:v:0",
                        "-map",
                        "1:a:0",
                        "-c:v",
                        "copy",
                        "-c:a",
                        "aac",
                        "-b:a",
                        "192k",
                        "-af",
                        audioFilter,
                        ...extraArgs,
                        "-shortest",
                        "-movflags",
                        "+faststart",
                        muxPath,
                    ]);
                    videoBuffer = await fs.readFile(muxPath);
                    logger.success("AiStudio", `Locução humana PT-BR sincronizada (${spkDur.toFixed(1)}s em vídeo de ${vidDur.toFixed(1)}s)!`);
                } catch (muxErr: any) {
                    logger.warn("AiStudio", `Falha ao mixar áudio no vídeo (${muxErr?.message?.slice(0, 80)})`);
                } finally {
                    await fs.unlink(rawPath).catch(() => {});
                    await fs.unlink(muxPath).catch(() => {});
                }
            }

            // Motor Multi-Cena Dinâmico HD (2 Poses/Ângulos Coerentes + Transição Cinematográfica + Fala Neural PT-BR + Trilha Sonora)
            
            
            if (!videoBuffer) {
                logger.info("AiStudio", "Gerando vídeo MP4 HD com movimento multi-cena, fala neural PT-BR e trilha de áudio...");

                const englishPrompt = await buildEnglishVisualPromptWithGemini(
                    apiKey,
                    prompt,
                    stylePreset,
                    referenceImageBase64,
                    referenceImageMimeType
                );

                let frame1Buffer: Buffer;
                if (imageInput?.imageBytes) {
                    frame1Buffer = Buffer.from(imageInput.imageBytes, "base64");
                } else {
                    frame1Buffer = await fetchBlackForestFluxUltraHd(englishPrompt, aspectRatio);
                }

                // Gerar Quadro 2 (mesma pessoa/produto em nova pose, gesto expressivo falando para a câmera e novo ângulo)
                let frame2Buffer: Buffer = frame1Buffer;
                try {
                    const frame1B64 = frame1Buffer.toString("base64");
                    const shot2Prompt = `Exact same person or main subject, exact same outfit and background environment from the reference image, now in a closer medium-close camera angle, speaking warmly and enthusiastically to the camera with an expressive hand gesture and natural lively body movement, 8k photorealistic DSLR. ${englishPrompt}`;
                    frame2Buffer = await fetchBlackForestFluxUltraHd(shot2Prompt, aspectRatio, frame1B64);
                } catch (shot2Err: any) {
                    logger.warn("AiStudio", `Quadro 2 dinâmico usará ângulo alternativo do Quadro 1 (${shot2Err?.message?.slice(0, 80)})`);
                }

                const tempImg1Path = path.join(dir, `${tempId}_f1.png`);
                const tempImg2Path = path.join(dir, `${tempId}_f2.png`);
                const tempMp4Path = path.join(dir, `${tempId}.mp4`);
                await fs.writeFile(tempImg1Path, frame1Buffer);
                await fs.writeFile(tempImg2Path, frame2Buffer);

                const outW = aspectRatio === "16:9" ? 1280 : 720;
                const outH = aspectRatio === "16:9" ? 720 : 1280;

                const fadeDur = 0.6;
                const shot1Sec = Number((totalDur * 0.52).toFixed(1));
                const shot2Sec = Number((totalDur - shot1Sec + fadeDur).toFixed(1));
                const shot1Frames = Math.round(shot1Sec * 25);
                const shot2Frames = Math.round(shot2Sec * 25);
                const xfadeOffset = Number((shot1Sec - fadeDur).toFixed(2));
                const fadeOutStart = Math.max(1, Number((totalDur - 1.2).toFixed(1)));

                try {
                    const vFilter = [
                        `[0:v]scale=${outW * 2}:${outH * 2}:force_original_aspect_ratio=increase,crop=${outW * 2}:${outH * 2},zoompan=z='min(zoom+0.0018,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${shot1Frames}:s=${outW}x${outH}:fps=25,setsar=1,format=yuv420p[v0]`,
                        `[1:v]scale=${outW * 2}:${outH * 2}:force_original_aspect_ratio=increase,crop=${outW * 2}:${outH * 2},zoompan=z='if(eq(on,1),1.15,max(zoom-0.0015,1.0))':x='iw/2-(iw/zoom/2)+sin(on/14)*12':y='ih/2-(ih/zoom/2)':d=${shot2Frames}:s=${outW}x${outH}:fps=25,setsar=1,format=yuv420p[v1]`,
                        `[v0][v1]xfade=transition=fade:duration=${fadeDur}:offset=${xfadeOffset},format=yuv420p[vout]`,
                    ].join(";");

                    if (hasSpeechAudio) {
                        const aFilter = [
                            `[2:a]aresample=44100,volume=1.5,apad=whole_dur=${totalDur}[voice]`,
                            `[3:a]aresample=44100,afade=t=in:st=0:d=0.6,afade=t=out:st=${fadeOutStart}:d=1.2[bgm]`,
                            `[voice][bgm]amix=inputs=2:duration=first:dropout_transition=2,asetpts=PTS-STARTPTS[aout]`,
                        ].join(";");

                        await execFileAsync("ffmpeg", [
                            "-y",
                            "-loop",
                            "1",
                            "-t",
                            String(shot1Sec + 0.5),
                            "-i",
                            tempImg1Path,
                            "-loop",
                            "1",
                            "-t",
                            String(shot2Sec + 0.5),
                            "-i",
                            tempImg2Path,
                            "-i",
                            tempSpeechPath,
                            "-f",
                            "lavfi",
                            "-t",
                            String(totalDur + 1),
                            "-i",
                            "aevalsrc=0.018*sin(2*PI*220*t)+0.014*sin(2*PI*277.18*t)+0.014*sin(2*PI*329.63*t)+0.01*sin(2*PI*440*t):s=44100",
                            "-filter_complex",
                            `${vFilter};${aFilter}`,
                            "-map",
                            "[vout]",
                            "-map",
                            "[aout]",
                            "-t",
                            String(totalDur),
                            "-c:v",
                            "libx264",
                            "-preset",
                            "ultrafast",
                            "-pix_fmt",
                            "yuv420p",
                            "-c:a",
                            "aac",
                            "-b:a",
                            "128k",
                            "-movflags",
                            "+faststart",
                            tempMp4Path,
                        ]);
                    } else {
                        const aFilterOnlyBgm = `[2:a]aresample=44100,afade=t=in:st=0:d=0.6,afade=t=out:st=${fadeOutStart}:d=1.2[aout]`;
                        await execFileAsync("ffmpeg", [
                            "-y",
                            "-loop",
                            "1",
                            "-t",
                            String(shot1Sec + 0.5),
                            "-i",
                            tempImg1Path,
                            "-loop",
                            "1",
                            "-t",
                            String(shot2Sec + 0.5),
                            "-i",
                            tempImg2Path,
                            "-f",
                            "lavfi",
                            "-t",
                            String(totalDur + 1),
                            "-i",
                            "aevalsrc=0.03*sin(2*PI*220*t)+0.025*sin(2*PI*277.18*t)+0.025*sin(2*PI*329.63*t)+0.018*sin(2*PI*440*t):s=44100",
                            "-filter_complex",
                            `${vFilter};${aFilterOnlyBgm}`,
                            "-map",
                            "[vout]",
                            "-map",
                            "[aout]",
                            "-t",
                            String(totalDur),
                            "-c:v",
                            "libx264",
                            "-preset",
                            "ultrafast",
                            "-pix_fmt",
                            "yuv420p",
                            "-c:a",
                            "aac",
                            "-b:a",
                            "128k",
                            "-movflags",
                            "+faststart",
                            tempMp4Path,
                        ]);
                    }

                    videoBuffer = await fs.readFile(tempMp4Path);
                    usedModel = hasSpeechAudio ? "flux-cinema-voice-ptbr-mp4" : "flux-1-cinema-motion-mp4";
                } catch (ffErr: any) {
                    logger.warn("AiStudio", `Filtro avançado FFmpeg falhou (${ffErr?.message?.slice(0, 120)}), usando fallback simplificado com voz...`);
                    const fallbackArgs = [
                        "-y",
                        "-loop",
                        "1",
                        "-i",
                        tempImg1Path,
                        ...(hasSpeechAudio ? ["-i", tempSpeechPath] : []),
                        "-vf",
                        `scale=${outW * 2}:${outH * 2}:force_original_aspect_ratio=increase,crop=${outW * 2}:${outH * 2},zoompan=z='min(zoom+0.0015,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(totalDur * 25)}:s=${outW}x${outH}:fps=25,format=yuv420p`,
                        "-t",
                        String(totalDur),
                        "-c:v",
                        "libx264",
                        "-preset",
                        "ultrafast",
                        "-pix_fmt",
                        "yuv420p",
                        ...(hasSpeechAudio ? ["-c:a", "aac", "-b:a", "128k"] : []),
                        "-movflags",
                        "+faststart",
                        tempMp4Path,
                    ];
                    await execFileAsync("ffmpeg", fallbackArgs);
                    videoBuffer = await fs.readFile(tempMp4Path);
                    usedModel = "flux-cinema-voice-ptbr-mp4";
                } finally {
                    await fs.unlink(tempImg1Path).catch(() => {});
                    await fs.unlink(tempImg2Path).catch(() => {});
                    await fs.unlink(tempMp4Path).catch(() => {});
                    await fs.unlink(tempSpeechPath).catch(() => {});
                }
            } else {
                await fs.unlink(tempSpeechPath).catch(() => {});
            }

            if (!videoBuffer) {
                throw new Error("Não foi possível renderizar o vídeo.");
            }

            const id = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const filename = `${id}.mp4`;
            await fs.mkdir(dir, { recursive: true });
            const filePath = path.join(dir, filename);
            await fs.writeFile(filePath, videoBuffer);

            const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
            const item: AiStudioMediaItem = {
                id,
                type: "video",
                prompt,
                enhancedPrompt: fullPrompt,
                caption,
                model: usedModel,
                aspectRatio,
                filename,
                url: buildFileUrl(sessionId, filename),
                localPath: `public/ai-studio/${safeSession}/${filename}`,
                createdAt: new Date().toISOString(),
            };

            const existing = await readGalleryIndex(sessionId);
            await writeGalleryIndex(sessionId, [item, ...existing]);

            logger.success("AiStudio", `Vídeo gerado com sucesso (${usedModel}): ${filename}`);
            return NextResponse.json({
                status: true,
                message: "Vídeo gerado com sucesso!",
                data: item,
            });
        }

        // 5. Publicar / Agendar no WhatsApp (Status, Grupos ou Contatos)
        if (action === "send-whatsapp") {
            const { itemId, targetType, jids, caption, sendMode, sendAt } = body;
            const items = await readGalleryIndex(sessionId);
            const mediaItem = items.find((i) => i.id === itemId);

            if (!mediaItem) {
                return NextResponse.json({ status: false, message: "Mídia não encontrada na galeria." }, { status: 404 });
            }

            let targetList: string[] = [];
            if (targetType === "status") {
                targetList = ["status@broadcast"];
            } else if (Array.isArray(jids) && jids.length > 0) {
                targetList = jids.map(sanitizeJid);
            } else if (typeof body.jid === "string" && body.jid.trim()) {
                targetList = [sanitizeJid(body.jid)];
            }

            if (targetList.length === 0) {
                return NextResponse.json({ status: false, message: "Selecione pelo menos um destinatário (Status, Grupo ou Contato)." }, { status: 400 });
            }

            const systemConfig = await (prisma as any).systemConfig.findUnique({ where: { id: "default" } });
            const timezone = systemConfig?.timezone || "America/Sao_Paulo";

            const isImmediate = sendMode !== "schedule";
            const effectiveSendAt = isImmediate
                ? new Date()
                : moment.tz(sendAt, timezone).toDate();

            if (isNaN(effectiveSendAt.getTime())) {
                return NextResponse.json({ status: false, message: "Data/hora de agendamento inválida." }, { status: 400 });
            }

            const createdSchedules = [];
            for (let idx = 0; idx < targetList.length; idx++) {
                const cleanJid = targetList[idx];
                const scheduledDate = isImmediate
                    ? new Date()
                    : moment(effectiveSendAt).add(idx * 10, "seconds").toDate();

                const scheduled = await prisma.scheduledMessage.create({
                    data: {
                        sessionId: dbSessionId,
                        jid: cleanJid,
                        content: caption || null,
                        mediaUrl: mediaItem.localPath,
                        mediaType: mediaItem.type,
                        sendAt: scheduledDate,
                        status: "PENDING",
                    },
                });
                createdSchedules.push(scheduled);
            }

            if (isImmediate) {
                const errors: string[] = [];
                for (const sched of createdSchedules) {
                    const res = await sendScheduledMessage(sched.id);
                    if (!res.success && res.error) {
                        errors.push(res.error);
                    }
                }
                if (errors.length === createdSchedules.length) {
                    return NextResponse.json(
                        { status: false, message: errors[0] || "Falha ao enviar para o WhatsApp" },
                        { status: 500 }
                    );
                }
                return NextResponse.json({
                    status: true,
                    message:
                        targetType === "status"
                            ? "Publicado no Status do WhatsApp com sucesso!"
                            : `Enviado com sucesso para ${createdSchedules.length} destinatário(s)!`,
                });
            }

            return NextResponse.json({
                status: true,
                message:
                    targetType === "status"
                        ? "Postagem agendada para o Status do WhatsApp com sucesso!"
                        : `Envio agendado para ${createdSchedules.length} destinatário(s)!`,
            });
        }

        return NextResponse.json({ status: false, message: `Ação desconhecida: ${action}` }, { status: 400 });
    } catch (error: any) {
        logger.error("AiStudio", "Erro na requisição POST do Estúdio IA:", error);
        return NextResponse.json(
            {
                status: false,
                message: error?.message || "Erro ao processar solicitação no Estúdio IA",
            },
            { status: 500 }
        );
    }
}

// DELETE: Remove a generated item from gallery
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Não autorizado" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Acesso negado" }, { status: 403 });
        }

        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) {
            return NextResponse.json({ status: false, message: "ID do item não informado" }, { status: 400 });
        }

        const items = await readGalleryIndex(sessionId);
        const target = items.find((i) => i.id === id);
        if (!target) {
            return NextResponse.json({ status: false, message: "Item não encontrado" }, { status: 404 });
        }

        const dir = getStudioDir(sessionId);
        const filePath = path.join(dir, path.basename(target.filename));
        await fs.unlink(filePath).catch(() => {});

        const updated = items.filter((i) => i.id !== id);
        await writeGalleryIndex(sessionId, updated);

        return NextResponse.json({
            status: true,
            message: "Mídia removida da galeria com sucesso!",
        });
    } catch (error: any) {
        return NextResponse.json(
            { status: false, message: error?.message || "Erro ao excluir mídia" },
            { status: 500 }
        );
    }
}
