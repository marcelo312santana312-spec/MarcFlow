import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { ensureAffiliateSocketBound } from "@/modules/whatsapp/store/autoreply";
import {
    processIncomingAffiliateMessage,
    verifyWebhookHmacSignature,
} from "@/modules/affiliate";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;
        const rawBody = await request.text();

        if (!rawBody || rawBody.length > 64 * 1024) {
            return NextResponse.json(
                { status: false, message: "Payload inválido ou excede o limite permitido." },
                { status: 400 }
            );
        }

        const signature =
            request.headers.get("x-webhook-signature") ||
            request.headers.get("x-hub-signature-256");

        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true, sessionId: true },
        });

        if (!session) {
            return NextResponse.json(
                { status: false, message: "Sessão não encontrada." },
                { status: 404 }
            );
        }

        // Busca segredos de webhook ativos da sessão ou fallback para WEBHOOK_SECRET / AUTH_SECRET
        const activeWebhooks = await prisma.webhook.findMany({
            where: { sessionId: session.id, isActive: true },
            select: { secret: true },
        });

        const candidateSecrets = [
            ...activeWebhooks.map((w) => w.secret).filter((s): s is string => !!s),
            process.env.WEBHOOK_SECRET,
            process.env.AUTH_SECRET,
        ].filter((s): s is string => typeof s === "string" && s.length > 0);

        const isSignatureValid = candidateSecrets.some((sec) =>
            verifyWebhookHmacSignature(rawBody, signature, sec)
        );

        if (!isSignatureValid) {
            return NextResponse.json(
                { status: false, message: "Assinatura de webhook inválida ou ausente." },
                { status: 401 }
            );
        }

        let payload: any;
        try {
            payload = JSON.parse(rawBody);
        } catch {
            return NextResponse.json(
                { status: false, message: "JSON malformado." },
                { status: 400 }
            );
        }

        const instance = waManager.getInstance(sessionId);
        if (instance?.socket) {
            ensureAffiliateSocketBound(instance.socket, sessionId);
        }

        if (payload?.event && payload.event !== "message.received") {
            return NextResponse.json({
                status: true,
                action: "ignored_event_type",
            });
        }

        const data = payload?.data || payload;
        const messageId = String(data?.key?.id || data?.messageId || "").trim();
        const remoteJid = String(data?.from || data?.key?.remoteJid || "").trim();
        const fromMe = Boolean(data?.key?.fromMe ?? data?.fromMe ?? false);
        const isGroup = Boolean(data?.isGroup ?? remoteJid.endsWith("@g.us"));
        const text = String(data?.content ?? data?.caption ?? data?.text ?? "");

        const result = await processIncomingAffiliateMessage(
            {
                sessionId,
                messageId,
                remoteJid,
                fromMe,
                isGroup,
                text,
            },
            {
                sendText: async (recipientJid, replyText) => {
                    if (!instance?.socket) {
                        throw new Error("Sessão do WhatsApp desconectada.");
                    }
                    await instance.socket.sendMessage(recipientJid, { text: replyText });
                },
            }
        );

        return NextResponse.json({
            status: result.action !== "reply_failed",
            action: result.action,
        });
    } catch {
        return NextResponse.json(
            { status: false, message: "Erro interno ao processar webhook." },
            { status: 500 }
        );
    }
}
