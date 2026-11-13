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

async function synthesizePortugueseVoiceover(
    rawScript: string,
    voiceId: string,
    outputMp3Path: string
): Promise<boolean> {
    const cleanScript = rawScript
        .replace(/https?:\/\/\S+/g, "")
        .replace(/[*_~`#]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    if (!cleanScript || voiceId === "none") return false;

    const sentences = cleanScript
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

    const chunks: string[] = [];
    let current = "";
    for (const s of sentences) {
        if ((current + " " + s).trim().length <= 180) {
            current = (current + " " + s).trim();
        } else {
            if (current) chunks.push(current);
            if (s.length <= 180) {
                current = s;
            } else {
                const words = s.split(" ");
                let sub = "";
                for (const w of words) {
                    if ((sub + " " + w).trim().length <= 180) {
                        sub = (sub + " " + w).trim();
                    } else {
                        if (sub) chunks.push(sub);
                        sub = w;
                    }
                }
                current = sub;
            }
        }
    }
    if (current) chunks.push(current);
    if (chunks.length === 0) chunks.push(cleanScript.slice(0, 180));

    const audioBuffers: Buffer[] = [];
    const selectedVoice = ["br_001", "br_003", "br_005"].includes(voiceId) ? voiceId : "br_001";

    for (const chunk of chunks) {
        let chunkBuf: Buffer | null = null;

        // 1. Voz Neural Brasileira (TikTok Neural TTS: br_001 Feminina, br_003 Jovem, br_005 Masculina)
        try {
            const ttOut = await curlPostJson(
                "https://tiktok-tts.weilnet.workers.dev/api/generation",
                { text: chunk, voice: selectedVoice },
                12
            );
            const parsed = JSON.parse(ttOut || "{}");
            if (parsed.data) {
                const buf = Buffer.from(parsed.data, "base64");
                if (buf.length > 500) chunkBuf = buf;
            }
        } catch (err: any) {
            logger.warn("AiStudio", `TikTok Neural TTS falhou no trecho (${err?.message?.slice(0, 80)}), usando Google TTS PT-BR...`);
        }

        // 2. Fallback Google Translate TTS (pt-BR)
        if (!chunkBuf) {
            try {
                const gUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=pt-BR&q=${encodeURIComponent(chunk)}`;
                const { stdout } = await execFileAsync(
                    "curl",
                    ["-4", "-fsSL", "--max-time", "12", "-A", "Mozilla/5.0", gUrl],
                    { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 }
                );
                if (stdout && stdout.length > 500) {
                    chunkBuf = stdout;
                }
            } catch (err2: any) {
                logger.warn("AiStudio", `Google TTS PT-BR falhou (${err2?.message?.slice(0, 80)})`);
            }
        }

        if (chunkBuf) {
            audioBuffers.push(chunkBuf);
        }
    }

    if (audioBuffers.length === 0) return false;
    await fs.writeFile(outputMp3Path, Buffer.concat(audioBuffers));
    return true;
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

// 4. Motor de Difusão de Vídeo Real em Nuvem (Pika H3 Flex 8-10s 10-Steps + Fallback MiniMax H3 - Zero Carga no Celular)
async function generateCloudDiffusionVideo(
    prompt: string,
    aspectRatio: "9:16" | "16:9",
    imageBytesBase64?: string | null,
    durationSec = 8
): Promise<Buffer | null> {
    const host = "https://bep40-ml-intern-flux3-comic.hf.space";
    const canvas = aspectRatio === "9:16" ? "544x960 · 9:16 fast" : "960x544 · 16:9 fast";
    const targetDuration = Math.min(10, Math.max(8, Math.round(durationSec)));
    const fluidPrompt = `smooth continuous fluid cinematic motion, natural lively human gestures and camera movement, high frame rate, ${prompt}`;
    const cleanImg = imageBytesBase64 ? imageBytesBase64.replace(/^data:[^;]+;base64,/, "") : undefined;

    // 1. Tentar Pika H3 Flex (8 a 10 segundos contínuos, 10 steps para alta fluidez)
    try {
        logger.info("AiStudio", `Renderizando vídeo fluido na nuvem (Pika H3 Flex, ${targetDuration}s, 10 steps)...`);
        const pikaPayload: any = {
            prompt: fluidPrompt,
            duration: targetDuration,
            steps: 10,
            mode: "single",
            lora: "off",
            with_audio: true,
            canvas,
            ...(cleanImg ? { image_b64: cleanImg } : {}),
        };
        const jsonStr = await curlPostJson(`${host}/api/video/minimax`, pikaPayload, 240);
        const parsed = JSON.parse(jsonStr || "{}");
        if (parsed.video_b64) {
            const buf = Buffer.from(parsed.video_b64, "base64");
            if (buf.length > 50000) {
                logger.success("AiStudio", `Vídeo Pika H3 Flex (${targetDuration}s) gerado na nuvem! Tamanho: ${buf.length} bytes`);
                return buf;
            }
        }
    } catch (err: any) {
        logger.warn("AiStudio", `Pika H3 Flex falhou (${err?.message?.slice(0, 100)}), tentando MiniMax H3 Turbo...`);
    }

    // 2. Fallback para MiniMax H3 Turbo (8 steps, até 8s)
    try {
        const h3Payload: any = {
            prompt: fluidPrompt,
            duration: Math.min(8, targetDuration),
            steps: 8,
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

        const { apiKey } = await resolveGeminiApiKey(sessionId);
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
  "enhancedPrompt": "Prompt fotográfico hiper-realista detalhado em inglês para máxima fidelidade no FLUX.1/Gemini (incluindo RAW photo, 85mm f/1.4 lens, natural golden hour lighting, photorealistic, ultra detailed skin and texture, 8k)",
  "caption": "Legenda persuasiva em português pronta para postar no Status/Grupo do WhatsApp com emojis e chamada para ação (CTA)",
  "speechText": "Fala curta, natural e persuasiva em português do Brasil (1 a 2 frases, sem emojis nem links) para ser narrada por voz no vídeo comercial"
}`;

                const rawText = await generateTextWithGeminiFallback(apiKey, rawPrompt, {
                    systemInstruction: sysInstruction,
                    responseMimeType: "application/json",
                });

                const parsed = JSON.parse(rawText || "{}");
                if (parsed.enhancedPrompt) {
                    return NextResponse.json({
                        status: true,
                        data: {
                            enhancedPrompt: parsed.enhancedPrompt,
                            caption: parsed.caption || `✨ Confira essa novidade incrível! 🔥\n\n👉 Chame aqui ou clique no link para garantir!`,
                            speechText:
                                parsed.speechText ||
                                `Olha só essa novidade incrível! ${rawPrompt}. Aproveite as condições especiais de hoje e garanta já o seu!`,
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

            // Determinar roteiro falado em Português para a locução do vídeo
            let spokenScript = rawSpeechText;
            if (!spokenScript && voiceId !== "none") {
                const cleanCaption = caption
                    .replace(/https?:\/\/\S+/g, "")
                    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
                    .replace(/[*_~`#]/g, "")
                    .replace(/\s+/g, " ")
                    .trim();

                if (cleanCaption && cleanCaption.length >= 12) {
                    spokenScript = cleanCaption.slice(0, 260);
                } else {
                    const isAlreadyEnglish = /^RAW photo/i.test(prompt);
                    spokenScript = isAlreadyEnglish
                        ? "Olha só essa novidade exclusiva que preparamos para você hoje! Aproveite as condições especiais e garanta já!"
                        : `Olha só que incrível: ${prompt.slice(0, 140)}! Aproveite a oportunidade exclusiva de hoje e garanta já!`;
                }
            }

            const dir = getStudioDir(sessionId);
            await fs.mkdir(dir, { recursive: true });
            const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const tempSpeechPath = path.join(dir, `${tempId}_speech.mp3`);
            let hasSpeechAudio = false;

            if (voiceId !== "none" && spokenScript) {
                try {
                    hasSpeechAudio = await synthesizePortugueseVoiceover(spokenScript, voiceId, tempSpeechPath);
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

            // 1. Tentar Google Veo (se solicitado)
            if (requestedModel.startsWith("veo-")) {
                try {
                    const veoModel = requestedModel;
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
                            videoBuffer = Buffer.from(inlineVideoBytes, "base64");
                        } else if (videoUri) {
                            const separator = videoUri.includes("?") ? "&" : "?";
                            const downloadUrl = `${videoUri}${separator}key=${encodeURIComponent(apiKey)}`;
                            const videoRes = await fetch(downloadUrl, {
                                headers: { "x-goog-api-key": apiKey },
                            });
                            if (videoRes.ok) {
                                videoBuffer = Buffer.from(await videoRes.arrayBuffer());
                            }
                        }
                    }
                } catch (err: any) {
                    logger.warn("AiStudio", `Google Veo (${requestedModel}) indisponível (${err?.message?.slice(0, 100)}), acionando IA Video Diffusion na nuvem...`);
                }
            }

            // 2. Se Veo não foi solicitado ou não gerou buffer, usar IA Video Diffusion na Nuvem (MiniMax H3 / Wan 2.1 Fast com Movimento Humano Real)
            if (!videoBuffer && requestedModel !== "cinematic-multiscene") {
                const englishPrompt = await buildEnglishVisualPromptWithGemini(
                    apiKey,
                    prompt,
                    stylePreset,
                    referenceImageBase64,
                    referenceImageMimeType
                );
                videoBuffer = await generateCloudDiffusionVideo(englishPrompt, aspectRatio, imageInput?.imageBytes, totalDur);
                if (videoBuffer) {
                    usedModel = "pika-h3-flex";
                }
            }

            // Se o vídeo foi gerado (seja pelo Veo ou pela Difusão em Nuvem) e temos locução PT-BR, mixar com FFmpeg
            if (videoBuffer && hasSpeechAudio) {
                const rawPath = path.join(dir, `${tempId}_raw.mp4`);
                const muxPath = path.join(dir, `${tempId}_mux.mp4`);
                try {
                    await fs.writeFile(rawPath, videoBuffer);
                    await execFileAsync("ffmpeg", [
                        "-y",
                        "-i",
                        rawPath,
                        "-i",
                        tempSpeechPath,
                        "-c:v",
                        "copy",
                        "-c:a",
                        "aac",
                        "-b:a",
                        "128k",
                        "-shortest",
                        "-movflags",
                        "+faststart",
                        muxPath,
                    ]);
                    videoBuffer = await fs.readFile(muxPath);
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
