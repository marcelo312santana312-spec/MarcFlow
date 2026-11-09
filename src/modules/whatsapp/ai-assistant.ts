import { GoogleGenAI } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface AiReplyOptions {
    sessionId: string;       // Session.id (DB cuid)
    remoteJid: string;
    senderName?: string | null;
    incomingText: string;
    apiKey: string;
    model?: string;
    systemPrompt?: string | null;
    contextLimit?: number;
}

const DEFAULT_SYSTEM_PROMPT = `Você é um assistente virtual de atendimento no WhatsApp educado, prestativo e objetivo.
Responda sempre em Português do Brasil de forma natural e clara, formatando mensagens curtas e fáceis de ler no WhatsApp.`;

export async function generateAiReply(opts: AiReplyOptions): Promise<string | null> {
    const apiKey = (opts.apiKey || process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
        logger.warn("AIAssistant", "Gemini API key is not configured.");
        return null;
    }

    const modelName = (opts.model || "gemini-3.8-flash").trim();
    const limit = Math.max(1, Math.min(30, opts.contextLimit || 10));

    try {
        // Fetch recent conversation history for context
        const recentMessages = await prisma.message.findMany({
            where: {
                sessionId: opts.sessionId,
                remoteJid: opts.remoteJid,
                content: { not: null },
            },
            orderBy: { timestamp: "desc" },
            take: limit,
            select: {
                fromMe: true,
                content: true,
                pushName: true,
            },
        });

        const history = recentMessages
            .reverse()
            .filter((m) => m.content && m.content.trim().length > 0);

        const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

        for (const msg of history) {
            const role = msg.fromMe ? "model" : "user";
            const text = msg.content!.trim();
            // Avoid duplicating the very last incoming message if it was already saved to DB
            if (
                contents.length === history.length - 1 &&
                !msg.fromMe &&
                text === opts.incomingText.trim()
            ) {
                continue;
            }
            // Merge consecutive messages of the same role to satisfy Gemini turn ordering
            const prev = contents[contents.length - 1];
            if (prev && prev.role === role) {
                prev.parts[0].text += `\n${text}`;
            } else {
                contents.push({ role, parts: [{ text }] });
            }
        }

        const userLabel = opts.senderName ? `[Cliente: ${opts.senderName}]\n` : "";
        const currentInput = `${userLabel}${opts.incomingText.trim()}`;

        const lastTurn = contents[contents.length - 1];
        if (lastTurn && lastTurn.role === "user") {
            lastTurn.parts[0].text += `\n${currentInput}`;
        } else {
            contents.push({
                role: "user",
                parts: [{ text: currentInput }],
            });
        }

        // Ensure first turn is "user"
        while (contents.length > 0 && contents[0].role !== "user") {
            contents.shift();
        }

        const ai = new GoogleGenAI({ apiKey });
        const isOngoingConversation = history.length > 1;
        const ongoingDirective = isOngoingConversation
            ? "\n\n[REGRA CRÍTICA DE DIÁLOGO]: A conversa com este contato JÁ ESTÁ EM ANDAMENTO. NUNCA inicie sua resposta com saudações repetitivas como 'Olá', 'Oi', 'Olá [Nome]', 'Tudo bem?', 'Como vai?', etc. Responda DIRETAMENTE ao que o usuário acabou de perguntar ou falar, de forma natural e contínua como em um bate-papo de WhatsApp."
            : "";
        const systemInstruction = ((opts.systemPrompt || "").trim() || DEFAULT_SYSTEM_PROMPT) + ongoingDirective;

        const response = await ai.models.generateContent({
            model: modelName,
            contents,
            config: {
                systemInstruction,
            },
        });

        const replyText = response.text?.trim();
        return replyText || null;
    } catch (error: any) {
        logger.error("AIAssistant", `Gemini API error (${modelName}): ${error?.message || error}`);
        return null;
    }
}
