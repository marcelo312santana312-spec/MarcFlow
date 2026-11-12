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

async function readGalleryIndex(sessionId: string): Promise<AiStudioMediaItem[]> {
    const dir = getStudioDir(sessionId);
    const indexPath = path.join(dir, "index.json");
    try {
        const raw = await fs.readFile(indexPath, "utf-8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
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

function sanitizeJid(rawJid: string): string {
    const trimmed = (rawJid || "").trim();
    if (trimmed === "status@broadcast" || trimmed.endsWith("@g.us") || trimmed.endsWith("@newsletter")) {
        return trimmed;
    }
    const cleanNumber = trimmed.split("@")[0].replace(/\D/g, "");
    return `${cleanNumber}@s.whatsapp.net`;
}

async function generateTextWithGeminiFallback(
    ai: GoogleGenAI,
    contents: any,
    config?: Record<string, any>
): Promise<string> {
    const textModels = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-3.1-flash-lite"];
    let lastErr: any = null;
    for (const model of textModels) {
        try {
            const res = await ai.models.generateContent({
                model,
                contents,
                config,
            });
            if (res.text) return res.text;
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr || new Error("Falha ao comunicar com os modelos de texto do Gemini.");
}

async function buildEnglishVisualPromptWithGemini(
    ai: GoogleGenAI,
    rawPrompt: string,
    stylePreset: string,
    referenceImageBase64?: string | null,
    referenceImageMimeType?: string
): Promise<string> {
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
                text: `Describe the product in this reference image in detail (colors, shape, material, branding) and combine it with this scene request: "${rawPrompt}". Style: "${stylePreset}". Output ONLY a single concise English image generation prompt (max 70 words), no quotes or markdown.`,
            });
        } else {
            contents.push({
                text: `Translate and enhance this visual prompt into a high-detail English photography/commercial prompt (max 70 words, no quotes, no markdown). Idea: "${rawPrompt}". Style: "${stylePreset}".`,
            });
        }
        const out = await generateTextWithGeminiFallback(ai, contents);
        return out.replace(/[\r\n]+/g, " ").trim() || rawPrompt;
    } catch {
        return `${rawPrompt}. ${stylePreset}`;
    }
}

async function fetchFluxImageFallback(
    englishPrompt: string,
    aspectRatio: string
): Promise<Buffer> {
    const dims =
        aspectRatio === "9:16"
            ? { width: 720, height: 1280 }
            : aspectRatio === "16:9"
            ? { width: 1280, height: 720 }
            : { width: 1024, height: 1024 };

    const seed = Math.floor(Math.random() * 1000000);
    const cleanPrompt = englishPrompt.slice(0, 450);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=${dims.width}&height=${dims.height}&seed=${seed}&nologo=true&model=flux`;

    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MarcFlow-AI-Studio/1.0",
        },
        signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) {
        throw new Error(`Servidor de renderização retornou status ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
}

// GET: List generated media & check API Key status
export async function GET(
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

        const ai = new GoogleGenAI({ apiKey });

        // 2. Otimizar Prompt + Gerar Legenda para WhatsApp
        if (action === "enhance-prompt") {
            const rawPrompt = (body.prompt || "").trim();
            const mediaType = body.mediaType === "video" ? "vídeo" : "imagem";
            const stylePreset = body.stylePreset || "";

            if (!rawPrompt) {
                return NextResponse.json({ status: false, message: "Digite uma ideia ou produto primeiro." }, { status: 400 });
            }

            const sysInstruction = `Você é um diretor criativo especialista em marketing visual, e-commerce (Mercado Livre, Shopee, Amazon) e vídeos virais para Status do WhatsApp e Reels (Google Flow / Veo / Nano Banana).
O usuário vai fornecer uma descrição curta de um produto, oferta ou cena para gerar um(a) ${mediaType}${stylePreset ? ` no estilo "${stylePreset}"` : ""}.
Retorne APENAS um JSON válido (sem markdown) no formato:
{
  "enhancedPrompt": "Prompt visual detalhado em português, rico em iluminação de estúdio, textura realista e composição fotográfica/cinematográfica",
  "caption": "Legenda persuasiva pronta para postar no Status/Grupo do WhatsApp com emojis e chamada para ação (CTA)"
}`;

            const rawText = await generateTextWithGeminiFallback(ai, rawPrompt, {
                systemInstruction: sysInstruction,
                responseMimeType: "application/json",
            });

            let parsed: { enhancedPrompt?: string; caption?: string } = {};
            try {
                parsed = JSON.parse(rawText || "{}");
            } catch {
                parsed = { enhancedPrompt: rawText || rawPrompt, caption: "" };
            }

            return NextResponse.json({
                status: true,
                data: {
                    enhancedPrompt: parsed.enhancedPrompt || rawPrompt,
                    caption: parsed.caption || "",
                },
            });
        }

        // 3. Gerar Imagem (Gemini Nano Banana 2.1 / 3.1 Flash Image / 2.5 Flash Image + Fallback Híbrido Gratuito)
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

            const fullPrompt = stylePreset
                ? `${prompt}. Estilo visual: ${stylePreset}. ${ratioHint}`
                : `${prompt}. ${ratioHint}`;

            let imageBuffer: Buffer | null = null;
            let usedModel = requestedModel;

            // Método 1: Gemini Native Image via generateContent (Nano Banana / Gemini 2.5 & 3.1 Flash Image)
            const tryGeminiNativeImage = async (modelName: string) => {
                const contents: any[] = [];
                if (referenceImageBase64) {
                    contents.push({
                        inlineData: {
                            data: referenceImageBase64.replace(/^data:[^;]+;base64,/, ""),
                            mimeType: referenceImageMimeType,
                        },
                    });
                }
                contents.push({ text: `Generate a high-quality commercial image: ${fullPrompt}` });

                const response = await ai.models.generateContent({
                    model: modelName,
                    contents,
                    config: {
                        responseModalities: ["TEXT", "IMAGE"],
                    },
                });

                const parts = response.candidates?.[0]?.content?.parts || [];
                for (const part of parts) {
                    if (part.inlineData?.data) {
                        usedModel = modelName;
                        return Buffer.from(part.inlineData.data, "base64");
                    }
                }
                throw new Error(`O modelo ${modelName} não retornou bytes de imagem.`);
            };

            // Ordem de tentativa nos modelos oficiais Nano Banana da Gemini API
            const geminiImageModels =
                requestedModel && requestedModel !== "auto" && !requestedModel.startsWith("imagen-")
                    ? [requestedModel, "gemini-2.5-flash-image", "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image"]
                    : ["gemini-2.5-flash-image", "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image", "gemini-nano-banana-2.1"];

            for (const mName of Array.from(new Set(geminiImageModels))) {
                try {
                    imageBuffer = await tryGeminiNativeImage(mName);
                    if (imageBuffer) break;
                } catch (err: any) {
                    logger.warn("AiStudio", `Modelo Gemini Image ${mName} indisponível na chave atual (${err?.message?.slice(0, 120)}), tentando próximo...`);
                }
            }

            // Fallback Automático Híbrido (caso a GEMINI_API_KEY esteja no plano Gratuito sem faturamento para Nano Banana)
            if (!imageBuffer) {
                logger.info("AiStudio", "Usando motor híbrido Gemini Prompt Director + Flux HD (compatível com GEMINI_API_KEY gratuita)...");
                const englishPrompt = await buildEnglishVisualPromptWithGemini(
                    ai,
                    prompt,
                    stylePreset,
                    referenceImageBase64,
                    referenceImageMimeType
                );
                imageBuffer = await fetchFluxImageFallback(englishPrompt, aspectRatio);
                usedModel = "gemini-2.5-flash + flux-hd";
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
                url: `/api/ai-studio/${safeSession}/file/${filename}`,
                localPath: `public/ai-studio/${safeSession}/${filename}`,
                createdAt: new Date().toISOString(),
            };

            const existing = await readGalleryIndex(sessionId);
            await writeGalleryIndex(sessionId, [item, ...existing]);

            logger.success("AiStudio", `Imagem gerada com sucesso (${usedModel}): ${filename}`);
            return NextResponse.json({
                status: true,
                message: "Imagem gerada com sucesso!",
                data: item,
            });
        }

        // 4. Gerar Vídeo (Google Veo / Gemini Omni Flash + Fallback Motion Studio MP4 para chaves gratuitas)
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

            const videoModels = Array.from(
                new Set([
                    requestedModel,
                    "veo-3.1-fast-generate-001",
                    "veo-3.1-generate-001",
                    "veo-2.0-generate-001",
                ])
            );

            let videoBuffer: Buffer | null = null;
            let usedModel = videoModels[0];

            for (const m of videoModels) {
                try {
                    usedModel = m;
                    let operation = await ai.models.generateVideos({
                        model: m,
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
                            break;
                        } else if (videoUri) {
                            const separator = videoUri.includes("?") ? "&" : "?";
                            const downloadUrl = `${videoUri}${separator}key=${encodeURIComponent(apiKey)}`;
                            const videoRes = await fetch(downloadUrl, {
                                headers: { "x-goog-api-key": apiKey },
                            });
                            if (videoRes.ok) {
                                videoBuffer = Buffer.from(await videoRes.arrayBuffer());
                                break;
                            }
                        }
                    }
                } catch (err: any) {
                    logger.warn("AiStudio", `Modelo de vídeo ${m} indisponível na chave atual (${err?.message?.slice(0, 120)}), tentando próximo...`);
                }
            }

            // Fallback Automático de Vídeo (Renderiza quadro base em alta definição + Animação Cinematográfica MP4 com FFmpeg)
            if (!videoBuffer) {
                logger.info("AiStudio", "Gerando vídeo MP4 com motor híbrido (Gemini + Motion Render FFmpeg)...");
                const dir = getStudioDir(sessionId);
                await fs.mkdir(dir, { recursive: true });

                let baseFrameBuffer: Buffer;
                if (imageInput?.imageBytes) {
                    baseFrameBuffer = Buffer.from(imageInput.imageBytes, "base64");
                } else {
                    const englishPrompt = await buildEnglishVisualPromptWithGemini(
                        ai,
                        prompt,
                        stylePreset,
                        referenceImageBase64,
                        referenceImageMimeType
                    );
                    baseFrameBuffer = await fetchFluxImageFallback(englishPrompt, aspectRatio);
                }

                const tempId = `tmp_${Date.now()}`;
                const tempImgPath = path.join(dir, `${tempId}.jpg`);
                const tempMp4Path = path.join(dir, `${tempId}.mp4`);
                await fs.writeFile(tempImgPath, baseFrameBuffer);

                const outW = aspectRatio === "16:9" ? 1280 : 720;
                const outH = aspectRatio === "16:9" ? 720 : 1280;

                try {
                    // Cria movimento cinematográfico suave de 6 segundos (25fps = 150 frames) em H.264 compatível com WhatsApp Status e Reels
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
                    usedModel = "gemini-flow-motion-mp4";
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
                url: `/api/ai-studio/${safeSession}/file/${filename}`,
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
