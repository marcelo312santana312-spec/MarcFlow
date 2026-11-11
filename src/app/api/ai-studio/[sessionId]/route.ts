import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { GoogleGenAI } from "@google/genai";
import { sendScheduledMessage } from "@/modules/whatsapp/scheduler";
import { logger } from "@/lib/logger";
import fs from "fs/promises";
import path from "path";
import moment from "moment-timezone";

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

            const sysInstruction = `Você é um diretor criativo especialista em marketing visual, e-commerce (Mercado Livre, Shopee, Amazon) e vídeos virais para Status do WhatsApp e Reels (Google Flow / Veo / Imagen).
O usuário vai fornecer uma descrição curta de um produto, oferta ou cena para gerar um(a) ${mediaType}${stylePreset ? ` no estilo "${stylePreset}"` : ""}.
Retorne APENAS um JSON válido (sem markdown) no formato:
{
  "enhancedPrompt": "Prompt visual detalhado, rico em iluminação de estúdio, textura realista, composição fotográfica/cinematográfica (em português ou inglês otimizado para geração de ${mediaType})",
  "caption": "Legenda persuasiva pronta para postar no Status/Grupo do WhatsApp com emojis e chamada para ação (CTA)"
}`;

            const res = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: rawPrompt,
                config: {
                    systemInstruction: sysInstruction,
                    responseMimeType: "application/json",
                },
            });

            let parsed: { enhancedPrompt?: string; caption?: string } = {};
            try {
                parsed = JSON.parse(res.text || "{}");
            } catch {
                parsed = { enhancedPrompt: res.text || rawPrompt, caption: "" };
            }

            return NextResponse.json({
                status: true,
                data: {
                    enhancedPrompt: parsed.enhancedPrompt || rawPrompt,
                    caption: parsed.caption || "",
                },
            });
        }

        // 3. Gerar Imagem (Imagen 3/4 + Fallback automático para Gemini Flash Image Multimodal)
        if (action === "generate-image") {
            const prompt = (body.prompt || "").trim();
            const aspectRatio: "1:1" | "9:16" | "16:9" | "4:3" | "3:4" = body.aspectRatio || "9:16";
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
            let lastError: any = null;

            // Se houver imagem de referência (ex.: foto real do produto para trocar cenário) ou modelo gemini-flash-image selecionado, usa generateContent multimodal
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
                contents.push({ text: `Generate a high-quality image: ${fullPrompt}` });

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

            const tryImagenModel = async (modelName: string) => {
                const response = await ai.models.generateImages({
                    model: modelName,
                    prompt: fullPrompt,
                    config: {
                        numberOfImages: 1,
                        aspectRatio,
                        outputMimeType: "image/png",
                    },
                });
                const b64 = response.generatedImages?.[0]?.image?.imageBytes;
                if (!b64) {
                    throw new Error(`O modelo ${modelName} não retornou imagem.`);
                }
                usedModel = modelName;
                return Buffer.from(b64, "base64");
            };

            // Ordem de tentativa inteligente para máxima compatibilidade com qualquer chave Gemini API
            const candidateRunners: Array<() => Promise<Buffer>> = [];

            if (referenceImageBase64) {
                candidateRunners.push(
                    () => tryGeminiNativeImage("gemini-2.5-flash-image"),
                    () => tryGeminiNativeImage("gemini-2.0-flash-exp-image-generation")
                );
            } else if (requestedModel === "imagen-4.0-generate-001") {
                candidateRunners.push(
                    () => tryImagenModel("imagen-4.0-generate-001"),
                    () => tryImagenModel("imagen-3.0-generate-002"),
                    () => tryGeminiNativeImage("gemini-2.5-flash-image"),
                    () => tryGeminiNativeImage("gemini-2.0-flash-exp-image-generation")
                );
            } else if (requestedModel === "imagen-3.0-generate-002") {
                candidateRunners.push(
                    () => tryImagenModel("imagen-3.0-generate-002"),
                    () => tryGeminiNativeImage("gemini-2.5-flash-image"),
                    () => tryGeminiNativeImage("gemini-2.0-flash-exp-image-generation")
                );
            } else if (requestedModel === "gemini-2.5-flash-image") {
                candidateRunners.push(
                    () => tryGeminiNativeImage("gemini-2.5-flash-image"),
                    () => tryGeminiNativeImage("gemini-2.0-flash-exp-image-generation"),
                    () => tryImagenModel("imagen-3.0-generate-002")
                );
            } else {
                // "auto": tenta Imagen 3, Imagen 4, Gemini 2.5 Flash Image e Gemini 2.0 Flash Image
                candidateRunners.push(
                    () => tryImagenModel("imagen-3.0-generate-002"),
                    () => tryGeminiNativeImage("gemini-2.5-flash-image"),
                    () => tryGeminiNativeImage("gemini-2.0-flash-exp-image-generation"),
                    () => tryImagenModel("imagen-4.0-generate-001")
                );
            }

            for (const runner of candidateRunners) {
                try {
                    imageBuffer = await runner();
                    if (imageBuffer) break;
                } catch (err: any) {
                    lastError = err;
                    logger.warn("AiStudio", `Tentativa de modelo de imagem falhou (${err?.message}), tentando próximo fallback...`);
                }
            }

            if (!imageBuffer) {
                throw new Error(
                    lastError?.message ||
                        "Não foi possível gerar a imagem com sua chave de API atual. Verifique as permissões da sua GEMINI_API_KEY no Google AI Studio."
                );
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

        // 4. Gerar Vídeo (Google Veo / Flow - Text-to-Video & Image-to-Video)
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

            // Se o usuário escolheu animar uma imagem existente da galeria ou enviou uma foto
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

            const videoModels =
                requestedModel === "veo-3.0-generate-preview"
                    ? ["veo-3.0-generate-preview", "veo-2.0-generate-001"]
                    : ["veo-2.0-generate-001", "veo-3.0-generate-preview"];

            let operation: any = null;
            let usedModel = videoModels[0];
            let startErr: any = null;

            for (const m of videoModels) {
                try {
                    usedModel = m;
                    operation = await ai.models.generateVideos({
                        model: m,
                        prompt: fullPrompt,
                        ...(imageInput ? { image: imageInput } : {}),
                        config: {
                            numberOfVideos: 1,
                            aspectRatio,
                        },
                    });
                    if (operation) break;
                } catch (err: any) {
                    startErr = err;
                    logger.warn("AiStudio", `Tentativa de iniciar vídeo no modelo ${m} falhou: ${err?.message}`);
                }
            }

            if (!operation) {
                throw new Error(
                    startErr?.message ||
                        "Não foi possível iniciar a geração de vídeo (Veo). Verifique se o faturamento/acesso ao Veo está ativo na sua chave do Google AI Studio."
                );
            }

            // Polling até o vídeo ficar pronto (máx ~3.5 minutos)
            const maxAttempts = 42;
            let attempts = 0;
            while (!operation.done && attempts < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, 5000));
                operation = await ai.operations.getVideosOperation({ operation });
                attempts++;
            }

            if (!operation.done) {
                throw new Error("A geração do vídeo excedeu o tempo limite. Tente novamente com um prompt mais simples.");
            }

            if (operation.error) {
                throw new Error(operation.error.message || JSON.stringify(operation.error));
            }

            const videoObj = operation.response?.generatedVideos?.[0]?.video;
            const videoUri = videoObj?.uri;
            const inlineVideoBytes = videoObj?.videoBytes;

            let videoBuffer: Buffer;
            if (inlineVideoBytes) {
                videoBuffer = Buffer.from(inlineVideoBytes, "base64");
            } else if (videoUri) {
                const separator = videoUri.includes("?") ? "&" : "?";
                const downloadUrl = `${videoUri}${separator}key=${encodeURIComponent(apiKey)}`;
                const videoRes = await fetch(downloadUrl, {
                    headers: { "x-goog-api-key": apiKey },
                });
                if (!videoRes.ok) {
                    throw new Error(`Falha ao baixar o vídeo gerado do servidor Google (${videoRes.status})`);
                }
                videoBuffer = Buffer.from(await videoRes.arrayBuffer());
            } else {
                throw new Error("O vídeo foi processado, mas nenhuma URI ou arquivo foi retornado pela API (verifique se o prompt acionou filtros de segurança).");
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

            logger.success("AiStudio", `Vídeo Veo/Flow gerado com sucesso (${usedModel}): ${filename}`);
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
