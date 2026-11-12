import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { GoogleGenAI } from "@google/genai";
import { sendScheduledMessage } from "@/modules/whatsapp/scheduler";
import { logger } from "@/lib/logger";
import fs from "fs/promises";
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
    const primary = new GoogleGenAI(isVertexKey ? { vertexai: true, apiKey } : { apiKey });
    const secondary = new GoogleGenAI(isVertexKey ? { vertexai: false, apiKey } : { vertexai: true, apiKey });
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
    const textModels = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"];
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
        const orPayload = JSON.stringify({
            prompt: englishPrompt,
            aspect: aspectRatio,
            images: cleanRefB64 ? [cleanRefB64] : [],
        });

        const { stdout: orOut } = await execFileAsync(
            "curl",
            [
                "-4",
                "-fsSL",
                "--max-time",
                "45",
                "-X",
                "POST",
                "https://bep40-ml-intern-flux3-comic.hf.space/api/openrouter-image",
                "-H",
                "Content-Type: application/json",
                "-d",
                orPayload,
            ],
            { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 }
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

        const proxyPayload = JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
                aspectRatio,
                width: dims.width,
                height: dims.height,
            },
        });

        const { stdout: proxyOut } = await execFileAsync(
            "curl",
            [
                "-4",
                "-fsSL",
                "--max-time",
                "55",
                "-X",
                "POST",
                "https://bep40-ml-intern-flux3-comic.hf.space/api/proxy/gemini/v1beta/models/flux-image:generateContent",
                "-H",
                "Content-Type: application/json",
                "-d",
                proxyPayload,
            ],
            { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 }
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
  "caption": "Legenda persuasiva em português pronta para postar no Status/Grupo do WhatsApp com emojis e chamada para ação (CTA)"
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

            return NextResponse.json({
                status: true,
                data: {
                    enhancedPrompt: autoEnhanced,
                    caption: autoCaption,
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

        // 4. Gerar Vídeo (Google Veo / Flow + Renderização Cinematográfica MP4 em Alta Definição)
        if (action === "generate-video") {
            const prompt = (body.prompt || "").trim();
            const aspectRatio: "9:16" | "16:9" = body.aspectRatio === "16:9" ? "16:9" : "9:16";
            const stylePreset = (body.stylePreset || "").trim();
            const requestedModel = body.model || "veo-2.0-generate-001";
            const caption = body.caption || "";
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

            let videoBuffer: Buffer | null = null;
            let usedModel = requestedModel;

            try {
                let operation = await ai.models.generateVideos({
                    model: requestedModel,
                    prompt: fullPrompt,
                    ...(imageInput ? { image: imageInput } : {}),
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
                logger.warn("AiStudio", `Modelo de vídeo ${requestedModel} indisponível (${err?.message?.slice(0, 100)}), usando FLUX.1 8K + Motion Render FFmpeg...`);
            }

            // Motor Híbrido de Vídeo HD (Fotografia 8K FLUX.1 + Câmera Cinematográfica MP4 com FFmpeg)
            if (!videoBuffer) {
                logger.info("AiStudio", "Gerando vídeo MP4 HD com motor híbrido (FLUX.1 8K + Motion Render FFmpeg)...");
                const dir = getStudioDir(sessionId);
                await fs.mkdir(dir, { recursive: true });

                let baseFrameBuffer: Buffer;
                if (imageInput?.imageBytes) {
                    baseFrameBuffer = Buffer.from(imageInput.imageBytes, "base64");
                } else {
                    const englishPrompt = await buildEnglishVisualPromptWithGemini(
                        apiKey,
                        prompt,
                        stylePreset,
                        referenceImageBase64,
                        referenceImageMimeType
                    );
                    baseFrameBuffer = await fetchBlackForestFluxUltraHd(englishPrompt, aspectRatio);
                }

                const tempId = `tmp_${Date.now()}`;
                const tempImgPath = path.join(dir, `${tempId}.png`);
                const tempMp4Path = path.join(dir, `${tempId}.mp4`);
                await fs.writeFile(tempImgPath, baseFrameBuffer);

                const outW = aspectRatio === "16:9" ? 1280 : 720;
                const outH = aspectRatio === "16:9" ? 720 : 1280;

                try {
                    await execFileAsync("ffmpeg", [
                        "-y",
                        "-loop",
                        "1",
                        "-i",
                        tempImgPath,
                        "-vf",
                        `scale=${outW * 2}:${outH * 2}:force_original_aspect_ratio=increase,crop=${outW * 2}:${outH * 2},zoompan=z='min(zoom+0.0012,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=${outW}x${outH}:fps=25,format=yuv420p`,
                        "-t",
                        "6",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "ultrafast",
                        "-pix_fmt",
                        "yuv420p",
                        "-movflags",
                        "+faststart",
                        tempMp4Path,
                    ]);
                    videoBuffer = await fs.readFile(tempMp4Path);
                    usedModel = "flux-1-cinema-motion-mp4";
                } finally {
                    await fs.unlink(tempImgPath).catch(() => {});
                    await fs.unlink(tempMp4Path).catch(() => {});
                }
            }

            if (!videoBuffer) {
                throw new Error("Não foi possível renderizar o vídeo.");
            }

            const id = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const filename = `${id}.mp4`;
            const dir = getStudioDir(sessionId);
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
