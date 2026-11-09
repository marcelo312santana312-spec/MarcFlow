import { prisma } from "@/lib/prisma";
import type { WASocket } from "@whiskeysockets/baileys";
import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { logger } from "@/lib/logger";
import { shouldSuppressAutoReply } from "@/modules/flows/engine";
import { generateAiReply } from "@/modules/whatsapp/ai-assistant";
import {
    getPlatformIntegrationStatus,
    hasCandidateUrlsInText,
    processIncomingAffiliateMessage,
    resolveAffiliateEnv,
    StoredAffiliateSettings,
} from "@/modules/affiliate";

// Helper for permission check (Deduplicate from command-handler if possible, but keep simple here)
function canAutoReply(config: any, fromMe: boolean, senderJid: string): boolean {
    if (!config || !config.enabled) return false;

    // Auto Reply Specific Mode
    const mode = config.autoReplyMode || 'ALL';

    if (fromMe) {
        if (mode === 'OWNER') return true;
        if (mode === 'ALL') return false; // Standard auto-reply ignores self
        return false;
    } else {
        // Incoming message from others
        if (mode === 'OWNER') return false; // Owner only acts on Owner messages
        if (mode === 'ALL') return true;

        if (mode === 'SPECIFIC') {
            const allowedJids = config.autoReplyAllowedJids || [];
            if (Array.isArray(allowedJids)) {
                return allowedJids.some((jid: string) => senderJid.includes(jid));
            }
        }

        if (mode === 'BLACKLIST') {
            const blockedJids = config.autoReplyBlockedJids || [];
            if (Array.isArray(blockedJids)) {
                const isBlocked = blockedJids.some((jid: string) => senderJid.includes(jid));
                return !isBlocked; // Return true if NOT blocked
            }
            return true; // If blacklist empty, allow all
        }
    }

    return false;
}

export function ensureAffiliateSocketBound(sock: WASocket, sessionId: string) {
    try {
        const { waManager } = require("../manager");
        const inst = waManager?.getInstance?.(sessionId);
        if (inst && !inst.__affiliateInitWrapped) {
            inst.__affiliateInitWrapped = true;
            const origInit = inst.init.bind(inst);
            inst.init = async function (...args: any[]) {
                const res = await origInit(...args);
                if (this.socket) {
                    ensureAffiliateSocketBound(this.socket, sessionId);
                }
                return res;
            };
        }
    } catch {}

    // Se o autoReply principal já está ativo no socket, ele já coordena os afiliados
    if ((sock as any).__autoReplyBound || (sock as any).__affiliateAutoReplyBound) return;
    (sock as any).__affiliateAutoReplyBound = true;

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        let affiliateSettings: StoredAffiliateSettings | null = null;
        try {
            const s = await prisma.session.findUnique({
                where: { sessionId },
                select: { config: true },
            });
            affiliateSettings = ((s?.config as any)?.affiliate as StoredAffiliateSettings) || null;
        } catch {}

        const effectiveEnv = resolveAffiliateEnv(affiliateSettings, process.env);
        const affiliateAutoReplyEnabled =
            affiliateSettings?.enabled !== undefined
                ? affiliateSettings.enabled
                : effectiveEnv.AFFILIATE_AUTO_REPLY_ENABLED === "true" ||
                  (effectiveEnv.AFFILIATE_AUTO_REPLY_ENABLED !== "false" &&
                      (getPlatformIntegrationStatus("mercadolivre", effectiveEnv).configured ||
                          getPlatformIntegrationStatus("shopee", effectiveEnv).configured));

        if (!affiliateAutoReplyEnabled) return;

        for (const msg of messages) {
            try {
                const fromMe = msg.key.fromMe || false;
                const remoteJid = msg.key.remoteJid;
                if (!remoteJid || fromMe) continue;

                const isGroup = remoteJid.endsWith("@g.us");
                if (isGroup || remoteJid === "status@broadcast" || remoteJid.endsWith("@newsletter")) continue;

                const content = normalizeMessageContent(msg.message);
                const text =
                    content?.conversation ||
                    content?.extendedTextMessage?.text ||
                    content?.imageMessage?.caption ||
                    content?.videoMessage?.caption ||
                    "";

                if (!text || !hasCandidateUrlsInText(text)) continue;

                const remoteJidAlt = msg.key.remoteJidAlt;
                const effectiveRemoteJid =
                    !isGroup && remoteJid.endsWith("@lid") && remoteJidAlt
                        ? remoteJidAlt
                        : remoteJid;

                await processIncomingAffiliateMessage(
                    {
                        sessionId,
                        messageId: msg.key.id || `${Date.now()}`,
                        remoteJid: effectiveRemoteJid,
                        fromMe,
                        isGroup,
                        text,
                    },
                    {
                        settings: affiliateSettings,
                        sendText: async (_recipientJid, replyText) => {
                            await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
                        },
                    }
                );
            } catch (err) {
                logger.error("Affiliate", "Erro ao processar mensagem de afiliado em tempo real", err);
            }
        }
    });
    logger.info("Affiliate", `Listener de afiliados vinculado na sessão ${sessionId}`);
}

export async function bindAutoReply(sock: WASocket, sessionId: string) {
    ensureAffiliateSocketBound(sock, sessionId);
    // connection.open fires on every reconnect; bind once per socket or replies get duplicated
    if ((sock as any).__autoReplyBound) return;
    (sock as any).__autoReplyBound = true;
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        // Fetch session ID and Bot Config once per batch (optimization)
        const session = await prisma.session.findUnique({
            where: { sessionId },
            // @ts-ignore
            include: { botConfig: true }
        });

        if (!session) return;

        // @ts-ignore
        let config = (session as any).botConfig;

        if (!config) {
            logger.warn("AutoReply", "No config found, creating default...");
            config = await prisma.botConfig.create({
                data: {
                    sessionId: session.id,
                    enabled: true,
                    botMode: 'OWNER',
                    autoReplyMode: 'ALL'
                }
            });
        }

        logger.debug("AutoReply", `Processing for ${sessionId}. Config: ${config ? "Found" : "Missing"}, ${config?.enabled ? "Enabled" : "Disabled"}`);

        if (!config || !config.enabled) return;

        for (const msg of messages) {
            const fromMe = msg.key.fromMe || false;
            const remoteJid = msg.key.remoteJid;

            // Standardized Sender Logic
            const isGroup = remoteJid?.endsWith("@g.us") || false;
            const remoteJidAlt = msg.key.remoteJidAlt;
            let senderJid = (isGroup ? (msg.key.participant || msg.participant) : remoteJid);

            if (!isGroup && remoteJidAlt) {
                senderJid = remoteJidAlt;
            }

            if (!remoteJid || !senderJid) continue;

            // Check Permissions
            if (!canAutoReply(config, fromMe, senderJid)) continue;

            const content = normalizeMessageContent(msg.message);
            const text =
                content?.conversation ||
                content?.extendedTextMessage?.text ||
                content?.imageMessage?.caption ||
                content?.videoMessage?.caption ||
                "";

            if (!text) continue;

            // Skip if starts with bot command prefix
            const prefix = config.prefix || "#";
            if (text.trim().startsWith(prefix)) continue;

            if (await shouldSuppressAutoReply(sessionId, [remoteJid, remoteJidAlt, senderJid], text).catch(() => false)) continue;

            try {
                // Fetch rules for this session
                const rules = await prisma.autoReply.findMany({
                    where: {
                        session: {
                            sessionId: sessionId
                        }
                    }
                });

                let matchedRule = false;

                for (const rule of rules) {
                    let match = false;
                    const keyword = rule.keyword.toLowerCase();
                    const incoming = text.toLowerCase();

                    switch (rule.matchType) {
                        case 'EXACT':
                            match = incoming === keyword;
                            break;
                        case 'CONTAINS':
                            match = incoming.includes(keyword);
                            break;
                        case 'REGEX':
                            try {
                                const regex = new RegExp(rule.keyword, 'i');
                                match = regex.test(text); // Use original case for regex
                            } catch (e) {
                                logger.error("AutoReply", "Invalid regex in auto-reply", rule.keyword);
                            }
                            break;
                    }

                    if (match) {
                        // Check trigger context (GROUP, PRIVATE, or ALL)
                        const triggerType = (rule as any).triggerType || 'ALL';

                        if (triggerType === 'GROUP' && !isGroup) continue;
                        if (triggerType === 'PRIVATE' && isGroup) continue;

                        logger.info("AutoReply", `Match: ${rule.keyword} -> ${remoteJid}`);
                        matchedRule = true;

                        if (rule.isMedia && rule.mediaUrl) {
                            const url = rule.mediaUrl;
                            const type = (rule as any).mediaType || "document";
                            
                            let payload: any = {};
                            if (rule.response) {
                                payload.caption = rule.response;
                            }

                            if (type === "image") {
                                payload.image = { url };
                            } else if (type === "video") {
                                payload.video = { url };
                            } else if (type === "audio") {
                                payload = { audio: { url } };
                            } else {
                                payload.document = { url };
                                payload.mimetype = 'application/octet-stream';
                                payload.fileName = url.split('/').pop() || 'document';
                            }
                            
                            try {
                                await sock.sendMessage(remoteJid, payload, { quoted: msg });
                            } catch (err: any) {
                                logger.error("AutoReply", `Failed to send media auto-reply from URL: ${err.message}. Falling back to text if response exists.`);
                                if (rule.response) {
                                    await sock.sendMessage(remoteJid, { text: rule.response }, { quoted: msg });
                                }
                            }
                        } else if (rule.response) {
                            await sock.sendMessage(remoteJid, { text: rule.response }, { quoted: msg });
                        }

                        break;
                    }
                }

                // Conversão automática de links de afiliado (Mercado Livre / Shopee) em chat direto (DM)
                const affiliateSettings = ((session as any)?.config?.affiliate as StoredAffiliateSettings) || null;
                const effectiveEnv = resolveAffiliateEnv(affiliateSettings, process.env);
                const affiliateAutoReplyEnabled =
                    affiliateSettings?.enabled !== undefined
                        ? affiliateSettings.enabled
                        : effectiveEnv.AFFILIATE_AUTO_REPLY_ENABLED === "true" ||
                          (effectiveEnv.AFFILIATE_AUTO_REPLY_ENABLED !== "false" &&
                              (getPlatformIntegrationStatus("mercadolivre", effectiveEnv).configured ||
                                  getPlatformIntegrationStatus("shopee", effectiveEnv).configured));

                let isAffiliateCandidate = false;

                if (!matchedRule && !fromMe && !isGroup && affiliateAutoReplyEnabled && hasCandidateUrlsInText(text)) {
                    isAffiliateCandidate = true;
                    const effectiveRemoteJid =
                        !isGroup && remoteJid.endsWith("@lid") && remoteJidAlt
                            ? remoteJidAlt
                            : remoteJid;
                    const affResult = await processIncomingAffiliateMessage(
                        {
                            sessionId,
                            messageId: msg.key.id || `${Date.now()}`,
                            remoteJid: effectiveRemoteJid,
                            fromMe,
                            isGroup,
                            text,
                        },
                        {
                            settings: affiliateSettings,
                            sendText: async (_recipientJid, replyText) => {
                                await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
                            },
                        }
                    );
                    if (affResult.action === "replied") {
                        matchedRule = true;
                    }
                }

                // Fallback to Google Gemini AI Assistant if enabled and no keyword rule matched and NOT an affiliate candidate message
                if (!matchedRule && !fromMe && config.aiEnabled && !isAffiliateCandidate) {
                    const aiTriggerType = config.aiTriggerType || 'ALL';
                    if (aiTriggerType === 'GROUP' && !isGroup) continue;
                    if (aiTriggerType === 'PRIVATE' && isGroup) continue;

                    await sock.sendPresenceUpdate('composing', remoteJid).catch(() => {});

                    const aiReply = await generateAiReply({
                        sessionId: session.id,
                        remoteJid,
                        senderName: msg.pushName,
                        incomingText: text,
                        apiKey: config.aiApiKey || "",
                        model: config.aiModel || "gemini-3.8-flash",
                        systemPrompt: config.aiSystemPrompt,
                        contextLimit: config.aiContextLimit || 10,
                    });

                    await sock.sendPresenceUpdate('paused', remoteJid).catch(() => {});

                    if (aiReply) {
                        logger.info("AIAssistant", `Replied to ${remoteJid} via ${config.aiModel || "gemini-3.8-flash"}`);
                        await sock.sendMessage(remoteJid, { text: aiReply }, { quoted: msg });
                    }
                }

            } catch (e) {
                logger.error("AutoReply", "Error executing auto-reply", e);
            }
        }
    });
}
