import { prisma } from "@/lib/prisma";
import { waManager } from "./manager";
import { logger } from "@/lib/logger";
import { CronExpressionParser } from "cron-parser";
import moment from "moment-timezone";
import path from "path";
import fs from "fs/promises";
import { startRun } from "@/modules/flows/engine";
import {
    generateWAMessage,
    generateMessageIDV2,
    encodeWAMessage,
    encodeSignedDeviceIdentity,
    jidDecode,
    isHostedLidUser,
    isHostedPnUser,
} from "@whiskeysockets/baileys";

async function getSystemTimezone(): Promise<string> {
    try {
        const cfg = await prisma.systemConfig.findUnique({ where: { id: "default" }, select: { timezone: true } });
        return cfg?.timezone || process.env.TZ || "America/Sao_Paulo";
    } catch {
        return "America/Sao_Paulo";
    }
}

async function loadMediaBuffer(mediaUrl: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
        const res = await fetch(mediaUrl);
        if (!res.ok) throw new Error(`Falha ao baixar mídia: ${res.status} ${res.statusText}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const fileName = mediaUrl.split("/").pop()?.split("?")[0] || "arquivo";
        const mimeType = res.headers.get("content-type") || "application/octet-stream";
        return { buffer, fileName, mimeType };
    }

    let localPath = mediaUrl;
    if (localPath.startsWith("/")) localPath = localPath.substring(1);
    const fullPath = path.isAbsolute(mediaUrl) ? mediaUrl : path.join(process.cwd(), localPath);
    const buffer = await fs.readFile(fullPath);
    const fileName = path.basename(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType =
        ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
        : ext === ".png" ? "image/png"
        : ext === ".webp" ? "image/webp"
        : ext === ".mp4" ? "video/mp4"
        : ext === ".mp3" ? "audio/mpeg"
        : ext === ".ogg" || ext === ".opus" ? "audio/ogg; codecs=opus"
        : ext === ".pdf" ? "application/pdf"
        : "application/octet-stream";

    return { buffer, fileName, mimeType };
}

async function resolveMessageVariables(text: string, dbSessionId: string, jid: string, tz: string): Promise<string> {
    if (!text) return "";
    try {
        const contact = await prisma.contact.findFirst({
            where: {
                sessionId: dbSessionId,
                jid,
            },
            select: { name: true, notify: true },
        });

        const now = moment().tz(tz);
        const fullName = contact?.name || contact?.notify || "";
        const firstName = fullName.split(/\s+/)[0] || "";
        const phone = jid.split("@")[0].split(":")[0];
        const days = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

        const vars: Record<string, string> = {
            "nome": fullName,
            "nome-completo": fullName,
            "primeiro-nome": firstName,
            "telefone": phone,
            "data": now.format("DD/MM/YYYY"),
            "hora": now.format("HH:mm"),
            "dia-semana": days[now.day()],
        };

        return text.replace(/\{([\w\-.À-ÿ]+)\}/g, (_, k) => vars[k] ?? "");
    } catch {
        return text;
    }
}

function sanitizeJid(rawJid: string): string {
    const trimmed = (rawJid || "").trim();
    if (trimmed === "status@broadcast" || trimmed.endsWith("@g.us") || trimmed.endsWith("@newsletter")) {
        return trimmed;
    }
    const cleanNumber = trimmed.split("@")[0].replace(/\D/g, "");
    return `${cleanNumber}@s.whatsapp.net`;
}

async function checkAndSendManagerNotification(
    instance: any,
    msg: any,
    success: boolean,
    errorMessage?: string,
    tz: string = "America/Sao_Paulo"
) {
    try {
        let metaData: any = {};
        try {
            if (msg.recurrenceRule) metaData = JSON.parse(msg.recurrenceRule);
        } catch {}

        const notifyJid = msg.notifyJid || metaData.notifyJid;
        if (!notifyJid) return;

        const cleanNotifyJid = sanitizeJid(notifyJid);
        const groupId = msg.groupId || metaData.groupId;

        if (groupId) {
            // Conta quantas mensagens deste lote ainda estão PENDING (excluindo a atual)
            const remainingCount = await prisma.scheduledMessage.count({
                where: {
                    sessionId: msg.sessionId,
                    OR: [
                        { groupId },
                        { recurrenceRule: { contains: groupId } }
                    ],
                    status: "PENDING",
                    id: { not: msg.id }
                }
            });

            // Se for a última mensagem do grupo, envia o relatório consolidado
            if (remainingCount === 0) {
                const allGroupMessages = await prisma.scheduledMessage.findMany({
                    where: {
                        sessionId: msg.sessionId,
                        OR: [
                            { groupId },
                            { recurrenceRule: { contains: groupId } }
                        ]
                    },
                    orderBy: { sendAt: "asc" }
                });

                const total = allGroupMessages.length;
                const sentList = allGroupMessages.filter(m => m.id === msg.id ? success : m.status === "SENT");
                const failedList = allGroupMessages.filter(m => m.id === msg.id ? !success : m.status === "FAILED");

                const jids = allGroupMessages.map(m => sanitizeJid(m.jid));
                const contacts = await prisma.contact.findMany({
                    where: {
                        sessionId: msg.sessionId,
                        jid: { in: jids }
                    },
                    select: { jid: true, name: true, notify: true }
                });

                const getContactName = (target: string) => {
                    const c = contacts.find(item => item.jid === target || item.jid.startsWith(target.split('@')[0]));
                    return c?.name || c?.notify || target.split('@')[0];
                };

                const lines = allGroupMessages.map((m, idx) => {
                    const clean = sanitizeJid(m.jid);
                    const name = getContactName(clean);
                    const phone = clean.split('@')[0];
                    const isOk = m.id === msg.id ? success : m.status === "SENT";
                    const icon = isOk ? "✅" : "❌";
                    return `${idx + 1}. 👤 ${name} (${phone}) ➔ ${icon} ${isOk ? "Enviado" : "Falhou"}`;
                });

                const nowFormatted = moment().tz(tz).format("DD/MM/YYYY [às] HH:mm");
                const previewContent = msg.content ? `\n\n📝 *Mensagem:* "${msg.content.slice(0, 150)}${msg.content.length > 150 ? '...' : ''}"` : '';

                const reportText = `📋 *RELATÓRIO DE GESTÃO - MARCFLOW*\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `Olá! O disparo agendado para o grupo de contatos foi finalizado.\n\n` +
                    `📊 *Resumo do Envio:*\n` +
                    `• Total de destinatários: *${total}*\n` +
                    `• ✅ Enviados com sucesso: *${sentList.length}*\n` +
                    `• ❌ Falhas: *${failedList.length}*\n\n` +
                    `👥 *Destinatários:*\n` +
                    `${lines.join('\n')}\n\n` +
                    `⏰ *Conclusão:* ${nowFormatted}` +
                    previewContent +
                    `\n━━━━━━━━━━━━━━━━━━━━━━━━━`;

                await instance.socket.sendMessage(cleanNotifyJid, { text: reportText });
                logger.success("Scheduler", `Relatório de gestão do grupo ${groupId} enviado com sucesso para ${cleanNotifyJid}`);
            }
        } else {
            // Disparo individual com notificação
            const nowFormatted = moment().tz(tz).format("DD/MM/YYYY [às] HH:mm");
            const phone = sanitizeJid(msg.jid).split('@')[0];
            const statusIcon = success ? "✅ *Enviada com sucesso*" : `❌ *Falha no envio* (${errorMessage || "Erro desconhecido"})`;

            const noticeText = `🔔 *AVISO DE GESTÃO - MARCFLOW*\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `O agendamento para o contato *${phone}* foi processado.\n\n` +
                `📌 *Status:* ${statusIcon}\n` +
                `⏰ *Horário:* ${nowFormatted}\n` +
                (msg.content ? `📝 *Mensagem:* "${msg.content.slice(0, 150)}"\n` : '') +
                `━━━━━━━━━━━━━━━━━━━━━━━━━`;

            await instance.socket.sendMessage(cleanNotifyJid, { text: noticeText });
            logger.info("Scheduler", `Aviso individual de agendamento enviado para o gestor ${cleanNotifyJid}`);
        }
    } catch (notifyErr) {
        logger.error("Scheduler", "Erro ao enviar notificação de gestão para o gestor:", notifyErr);
    }
}

const gScheduler = globalThis as unknown as {
    __activeSendingMessageIds?: Set<string>;
    __schedulerInterval?: NodeJS.Timeout;
    __checkScheduledMessages?: () => Promise<void>;
};
const activeSendingMessageIds = (gScheduler.__activeSendingMessageIds ??= new Set<string>());

export async function executeScheduledMessage(msg: any, tz: string): Promise<boolean> {
    if (activeSendingMessageIds.has(msg.id)) {
        logger.info("Scheduler", `Agendamento ${msg.id} já está em envio ativo, ignorando execução concorrente.`);
        return true;
    }
    activeSendingMessageIds.add(msg.id);

    const sessionKey = msg.session?.sessionId || msg.sessionId;
    const instance = waManager.getInstance(sessionKey) || waManager.getInstance(msg.sessionId);

    if (!instance?.socket) {
        activeSendingMessageIds.delete(msg.id);
        logger.warn("Scheduler", `Sessão ${sessionKey} não conectada para mensagem ${msg.id}`);
        return false;
    }

    const targetJid = sanitizeJid(msg.jid);

    try {
        let metaRule: any = {};
        try {
            if (msg.recurrenceRule) metaRule = typeof msg.recurrenceRule === "string" ? JSON.parse(msg.recurrenceRule) : msg.recurrenceRule;
        } catch {}

        // Verificação inteligente antes do envio (ex.: se o condutor do PG já lançou o relatório de presença hoje)
        if (metaRule.verificarUrlAntesDeEnviar) {
            try {
                const checkRes = await fetch(String(metaRule.verificarUrlAntesDeEnviar), {
                    signal: AbortSignal.timeout(8000),
                });
                const checkJson = await checkRes.json().catch(() => null);
                if (checkRes.ok && checkJson?.jaLancouHoje === true) {
                    if (msg.cronExpression) {
                        const interval = CronExpressionParser.parse(msg.cronExpression, { currentDate: new Date(), tz });
                        const nextDate = interval.next().toDate();
                        await prisma.scheduledMessage.update({
                            where: { id: msg.id },
                            data: { sendAt: nextDate, status: "PENDING" },
                        });
                        logger.info("Scheduler", `PG já lançou relatório hoje. Agendamento ${msg.id} pulado e reagendado para ${nextDate.toISOString()}`);
                    } else {
                        await prisma.scheduledMessage.update({
                            where: { id: msg.id },
                            data: { status: "SENT" },
                        });
                    }
                    return true;
                }
            } catch (checkErr) {
                logger.warn("Scheduler", "Falha ao consultar verificarUrlAntesDeEnviar, prosseguindo com o envio:", checkErr);
            }
        }

        if (metaRule.flowId) {
            const flow = await prisma.flow.findUnique({
                where: { id: metaRule.flowId }
            });
            if (!flow || !flow.publishedGraph) {
                throw new Error(`Fluxo "${metaRule.flowName || metaRule.flowId}" não foi encontrado ou ainda não foi publicado no Flow Builder.`);
            }
            const dbSessionId = msg.session?.id || msg.sessionId;
            await startRun({
                flowId: flow.id,
                graph: flow.publishedGraph as any,
                dbSessionId,
                sessionId: sessionKey,
                jid: targetJid,
                text: ""
            });
            logger.success("Scheduler", `Fluxo "${flow.name}" iniciado com sucesso para ${targetJid}`);
        } else if (targetJid === "status@broadcast") {
            const formattedContent = await resolveMessageVariables(msg.content || "", msg.sessionId, targetJid, tz);
            let payload: any = {};

            if (msg.mediaUrl) {
                const { buffer, fileName, mimeType } = await loadMediaBuffer(msg.mediaUrl);
                const type = (msg.mediaType || "image").toLowerCase();

                if (type === "video") {
                    payload = { video: buffer, ...(formattedContent ? { caption: formattedContent } : {}), mimetype: mimeType };
                } else if (type === "audio") {
                    payload = { audio: buffer, mimetype: mimeType.startsWith("audio/") ? mimeType : "audio/mpeg", ptt: true };
                } else {
                    payload = { image: buffer, ...(formattedContent ? { caption: formattedContent } : {}), mimetype: mimeType };
                }
            } else {
                payload = { text: formattedContent };
            }

            // Buscar contatos da sessão para enviar o status (requisito do WhatsApp/Baileys: statusJidList)
            const dbSessionId = msg.session?.id || msg.sessionId;
            const sock = instance.socket as any;
            const { authState, signalRepository, waUploadToServer, getUSyncDevices, assertSessions, createParticipantNodes, sendNode, waitForMessage } = sock;

            const meId: string = authState.creds.me.id;
            const meLid: string | undefined = authState.creds.me?.lid;
            const myDecodedPn = jidDecode(meId);
            const myDecodedLid = meLid ? jidDecode(meLid) : undefined;
            const myDevice = myDecodedPn?.device;

            const cleanOwnPhone = meId.split("@")[0].split(":")[0].replace(/\D/g, "");
            const cleanOwnLid = meLid ? meLid.split("@")[0].split(":")[0] : "";

            const contacts = await prisma.contact.findMany({
                where: { sessionId: dbSessionId },
                select: { jid: true, lid: true }
            });

            // Separar listas por domínio (LID vs PN) - WhatsApp rejeita stanzas que misturam @lid e @s.whatsapp.net
            const lidTargets = new Set<string>();
            const pnTargets = new Set<string>();

            if (cleanOwnLid) lidTargets.add(`${cleanOwnLid}@lid`);
            if (cleanOwnPhone) pnTargets.add(`${cleanOwnPhone}@s.whatsapp.net`);

            for (const c of contacts) {
                if (c.lid && c.lid.endsWith("@lid")) {
                    const cl = c.lid.split("@")[0].split(":")[0];
                    if (cl) lidTargets.add(`${cl}@lid`);
                } else if (!meLid && c.jid && !c.jid.endsWith("@g.us") && !c.jid.endsWith("@newsletter") && c.jid !== "status@broadcast") {
                    pnTargets.add(sanitizeJid(c.jid));
                }
            }

            logger.info("Scheduler", `Preparando Status: ${lidTargets.size} LIDs, ${pnTargets.size} PNs (meId=${meId}, meLid=${meLid})`);

            // Buscar devices via USync (separadamente para evitar mistura de domínios)
            const rawPnDevices = pnTargets.size > 0 ? await getUSyncDevices(Array.from(pnTargets), true, false) : [];
            const rawLidDevices = lidTargets.size > 0 ? await getUSyncDevices(Array.from(lidTargets), true, false) : [];

            const filterValidDevices = (rawList: any[], domainSuffix: string) => {
                const seen = new Set<string>();
                const out: string[] = [];
                for (const d of rawList || []) {
                    if (!d || !d.jid) continue;
                    if (!d.jid.endsWith(domainSuffix)) continue;
                    if (d.jid === meId || (meLid && d.jid === meLid)) continue;
                    const dec = jidDecode(d.jid);
                    if (!dec) continue;
                    // Excluir este exato dispositivo web (ex: device 28), mas MANTER o celular principal (device 0)!
                    if ((dec.user === myDecodedPn?.user || (myDecodedLid?.user && dec.user === myDecodedLid.user)) && dec.device === myDevice) {
                        continue;
                    }
                    if (isHostedLidUser(d.jid) || isHostedPnUser(d.jid) || d.device === 99) continue;
                    if (!seen.has(d.jid)) {
                        seen.add(d.jid);
                        out.push(d.jid);
                    }
                }
                return out;
            };

            const lidDeviceJids = filterValidDevices(rawLidDevices, "@lid");
            const pnDeviceJids = filterValidDevices(rawPnDevices, "@s.whatsapp.net");

            logger.info("Scheduler", `Devices resolvidos para Status: ${lidDeviceJids.length} devices @lid (${lidDeviceJids.slice(0, 5).join(", ")}), ${pnDeviceJids.length} devices @s.whatsapp.net (${pnDeviceJids.slice(0, 5).join(", ")})`);

            // Preparar mensagem (upload de mídia uma única vez)
            const baseMsgId = generateMessageIDV2(meId);
            const fullMsg = await generateWAMessage(targetJid, payload, {
                logger: sock.logger,
                userJid: meId,
                upload: waUploadToServer,
                mediaCache: sock.config?.mediaCache,
                options: sock.config?.options,
                messageId: baseMsgId,
                backgroundColor: "#315575",
                font: 1,
            });

            const messageContent = fullMsg.message!;
            const mediaType = messageContent.imageMessage ? "image"
                : messageContent.videoMessage ? (messageContent.videoMessage.gifPlayback ? "gif" : "video")
                : messageContent.audioMessage ? (messageContent.audioMessage.ptt ? "ptt" : "audio")
                : "";
            const extraAttrs: Record<string, string> = {};
            if (mediaType) extraAttrs["mediatype"] = mediaType;
            const msgType = mediaType ? "media" : "text";
            const bytes = encodeWAMessage(messageContent);

            const trySendStatusStanza = async (
                label: string,
                recipientJids: string[],
                senderIdentity: string,
                additionalAttrs: Record<string, string>
            ) => {
                const msgId = generateMessageIDV2(meId);
                let ackNode: any = null;
                await authState.keys.transaction(async () => {
                    const { ciphertext, senderKeyDistributionMessage } = await signalRepository.encryptGroupMessage({
                        group: targetJid,
                        data: bytes,
                        meId: senderIdentity,
                    });
                    const senderKeyMsg = {
                        senderKeyDistributionMessage: {
                            axolotlSenderKeyDistributionMessage: senderKeyDistributionMessage,
                            groupId: targetJid,
                        },
                    };
                    await assertSessions(recipientJids);
                    const { nodes, shouldIncludeDeviceIdentity } = await createParticipantNodes(recipientJids, senderKeyMsg, extraAttrs);
                    const binaryNodeContent: any[] = [];
                    if (nodes.length > 0) {
                        binaryNodeContent.push({
                            tag: "participants",
                            attrs: {},
                            content: nodes,
                        });
                    }
                    binaryNodeContent.push({
                        tag: "enc",
                        attrs: { v: "2", type: "skmsg", ...extraAttrs },
                        content: ciphertext,
                    });
                    if (shouldIncludeDeviceIdentity) {
                        binaryNodeContent.push({
                            tag: "device-identity",
                            attrs: {},
                            content: encodeSignedDeviceIdentity(authState.creds.account, true),
                        });
                    }
                    const stanza = {
                        tag: "message",
                        attrs: {
                            id: msgId,
                            to: targetJid,
                            type: msgType,
                            ...additionalAttrs,
                        },
                        content: binaryNodeContent,
                    };
                    const ackPromise = waitForMessage(msgId, 60000);
                    await sendNode(stanza);
                    ackNode = await ackPromise;
                }, meId);

                logger.info("Scheduler", `[Status ${label}] msgId=${msgId} recipients=${recipientJids.length} ack=${JSON.stringify(ackNode?.attrs || null)}`);
                return { msgId, ack: ackNode?.attrs || null };
            };

            const results: any[] = [];
            if (lidDeviceJids.length > 0 && meLid) {
                const rLid = await trySendStatusStanza("LID", lidDeviceJids, meLid, {});
                results.push({ mode: "LID", ...rLid });
            }
            if (pnDeviceJids.length > 0) {
                const rPn = await trySendStatusStanza("PN", pnDeviceJids, meId, {});
                results.push({ mode: "PN", ...rPn });
            }

            const winning = results.find(d => d.ack && !d.ack.error);
            if (!winning) {
                throw new Error(`Servidor do WhatsApp rejeitou o Status: ${JSON.stringify(results)}`);
            }

            logger.success("Scheduler", `Status do WhatsApp ACEITO pelo servidor para a sessão ${sessionKey}! Modo=${winning.mode} ID=${winning.msgId} ACK=${JSON.stringify(winning.ack)}`);
        } else {
            const formattedContent = await resolveMessageVariables(msg.content || "", msg.sessionId, targetJid, tz);
            let payload: any = {};

            if (msg.mediaUrl) {
                const { buffer, fileName, mimeType } = await loadMediaBuffer(msg.mediaUrl);
                const type = (msg.mediaType || "image").toLowerCase();

                if (type === "video") {
                    payload = { video: buffer, caption: formattedContent, mimetype: mimeType };
                } else if (type === "audio") {
                    payload = { audio: buffer, mimetype: mimeType.startsWith("audio/") ? mimeType : "audio/mpeg", ptt: true };
                } else if (type === "document") {
                    payload = { document: buffer, caption: formattedContent, fileName, mimetype: mimeType };
                } else {
                    payload = { image: buffer, caption: formattedContent, mimetype: mimeType };
                }
            } else {
                payload = { text: formattedContent };
            }

            await instance.socket.sendMessage(targetJid, payload);
        }

        // Se o jid gravado no banco tinha caracteres extras (como +), atualiza para o formato limpo
        if (targetJid !== msg.jid) {
            await prisma.scheduledMessage.update({
                where: { id: msg.id },
                data: { jid: targetJid }
            }).catch(() => {});
        }

        // Recurrence logic with cron-parser
        if (msg.cronExpression) {
            try {
                const interval = CronExpressionParser.parse(msg.cronExpression, { currentDate: new Date(), tz });
                const nextDate = interval.next().toDate();
                const nextStatus = msg.status === "PAUSED" ? "PAUSED" : "PENDING";
                await prisma.scheduledMessage.update({
                    where: { id: msg.id },
                    data: {
                        sendAt: nextDate,
                        status: nextStatus,
                    },
                });
                logger.info("Scheduler", `Mensagem recorrente ${msg.id} enviada e reagendada para ${nextDate.toISOString()}`);
            } catch (cronErr) {
                logger.error("Scheduler", `Erro ao calcular próxima data da mensagem recorrente ${msg.id}:`, cronErr);
                await prisma.scheduledMessage.update({
                    where: { id: msg.id },
                    data: { status: "SENT" },
                });
            }
        } else {
            await prisma.scheduledMessage.update({
                where: { id: msg.id },
                data: { status: "SENT" },
            });
            logger.success("Scheduler", `Mensagem única ${msg.id} enviada com sucesso para ${msg.jid}`);
        }

        // Notificação de gestão para o gestor/supervisor caso configurada
        await checkAndSendManagerNotification(instance, msg, true, undefined, tz);

        return true;
    } catch (err: any) {
        logger.error("Scheduler", `Falha ao enviar mensagem agendada ${msg.id}:`, err);
        await prisma.scheduledMessage.update({
            where: { id: msg.id },
            data: { status: "FAILED" },
        });

        // Notificação de gestão informando a falha
        await checkAndSendManagerNotification(instance, msg, false, err?.message, tz);

        return false;
    } finally {
        activeSendingMessageIds.delete(msg.id);
    }
}

export async function sendScheduledMessage(scheduleId: string): Promise<{ success: boolean; error?: string }> {
    const tz = await getSystemTimezone();
    const msg = await prisma.scheduledMessage.findUnique({
        where: { id: scheduleId },
        include: { session: true },
    });

    if (!msg) return { success: false, error: "Agendamento não encontrado" };

    const ok = await executeScheduledMessage(msg, tz);
    return { success: ok, error: ok ? undefined : "Falha ao enviar mensagem (verifique se a sessão do WhatsApp está conectada)" };
}

const checkScheduledMessages = async () => {
    try {
        const now = new Date();
        const tz = await getSystemTimezone();

        const pendingMessages = await prisma.scheduledMessage.findMany({
            where: {
                status: "PENDING",
                sendAt: { lte: now },
            },
            include: { session: true },
        });

        if (pendingMessages.length > 0) {
            logger.info("Scheduler", `Encontradas ${pendingMessages.length} mensagens para envio imediato.`);
        }

        for (const msg of pendingMessages) {
            await executeScheduledMessage(msg, tz);
        }
    } catch (e) {
        logger.error("Scheduler", "Erro no loop de agendamento:", e);
    }
};

function clearLegacySchedulerIntervals() {
    try {
        if (gScheduler.__schedulerInterval) {
            clearInterval(gScheduler.__schedulerInterval);
            gScheduler.__schedulerInterval = undefined;
        }
        const probe: any = setInterval(() => {}, 30 * 1000);
        const toClear: any[] = [];
        let cur = probe._idleNext;
        while (cur && cur !== probe) {
            const fnName = cur._onTimeout?.name || "";
            const fnStr = typeof cur._onTimeout === "function" ? Function.prototype.toString.call(cur._onTimeout) : "";
            if (fnName === "checkScheduledMessages" || fnStr.includes("checkScheduledMessages") || fnStr.includes("Encontradas")) {
                toClear.push(cur);
            }
            cur = cur._idleNext;
        }
        clearInterval(probe);
        for (const t of toClear) {
            clearInterval(t);
        }
    } catch {}
}

gScheduler.__checkScheduledMessages = checkScheduledMessages;

export function startScheduler() {
    clearLegacySchedulerIntervals();
    gScheduler.__checkScheduledMessages = checkScheduledMessages;
    logger.info("Scheduler", "Starting Message Scheduler with cron recurrence & variable support...");
    gScheduler.__checkScheduledMessages();
    gScheduler.__schedulerInterval = setInterval(() => {
        gScheduler.__checkScheduledMessages?.();
    }, 30 * 1000);
}

// Garante que em hot-reload qualquer timer antigo de 30s seja substituído pela versão atualizada
startScheduler();
