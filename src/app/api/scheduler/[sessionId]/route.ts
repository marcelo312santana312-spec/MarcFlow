import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import moment from "moment-timezone";
import { CronExpressionParser } from "cron-parser";

function sanitizeJid(rawJid: string): string {
    const trimmed = (rawJid || "").trim();
    if (trimmed === "status@broadcast" || trimmed.endsWith("@g.us") || trimmed.endsWith("@newsletter")) {
        return trimmed;
    }
    const cleanNumber = trimmed.split("@")[0].replace(/\D/g, "");
    return `${cleanNumber}@s.whatsapp.net`;
}

// GET: List Scheduled Messages
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;

        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const url = new URL(request.url);
        const tab = url.searchParams.get("tab") || "pending";
        
        const whereClause: any = { sessionId: session.id };
        let orderByClause: any = { sendAt: 'asc' };
        
        if (tab === "history") {
            whereClause.status = { in: ["SENT", "FAILED"] };
            orderByClause = { sendAt: 'desc' };
        } else {
            whereClause.status = { in: ["PENDING", "PAUSED"] };
        }

        const messages = await prisma.scheduledMessage.findMany({
            where: whereClause,
            include: { session: true },
            orderBy: orderByClause
        });

        return NextResponse.json({ status: true, message: "Scheduled messages retrieved successfully", data: messages });

    } catch (error) {
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}

// POST: Create Scheduled Message
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;

        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const {
            jid,
            jids,
            content,
            sendAt,
            mediaUrl,
            mediaType,
            cronExpression,
            recurrenceRule,
            notifyJid,
            groupName,
            groupId: incomingGroupId,
            delayBetweenSeconds = 15,
            scheduleType,
            flowId,
            flowName
        } = body;

        const isFlowSchedule = scheduleType === "flow" || !!flowId;
        const targetList: string[] = Array.isArray(jids) && jids.length > 0 ? jids : (jid ? [jid] : []);

        if (targetList.length === 0 || (!content && !mediaUrl && !isFlowSchedule) || !sendAt) {
            return NextResponse.json({ status: false, message: "Campos obrigatórios ausentes (Destinatários, Mensagem/Fluxo, Data/Hora)", error: "Missing required fields" }, { status: 400 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        // Fetch system timezone
        // @ts-ignore
        const systemConfig = await prisma.systemConfig.findUnique({ where: { id: "default" } });
        const timezone = systemConfig?.timezone || "America/Sao_Paulo";

        let utcDate = moment.tz(sendAt, timezone).toDate();
        if (isNaN(utcDate.getTime())) {
            // Tenta parse direto ISO
            utcDate = new Date(sendAt);
        }
        if (isNaN(utcDate.getTime())) {
            return NextResponse.json({ status: false, message: "Data e horário de envio inválidos. Por favor, selecione novamente.", error: "Invalid date format" }, { status: 400 });
        }

        if (cronExpression) {
            try {
                const interval = CronExpressionParser.parse(cronExpression, { currentDate: new Date(), tz: timezone });
                utcDate = interval.next().toDate();
            } catch (e) {
                console.warn("[Scheduler:POST] Could not calculate next cron date, using sendAt:", e);
            }
        }
        console.log(`[Scheduler:POST] Resolved UTC Date: ${utcDate.toISOString()} using timezone: ${timezone}`);

        const cleanNotifyJid = notifyJid ? sanitizeJid(notifyJid) : null;
        const isGroupBatch = !!incomingGroupId || targetList.length > 1 || !!groupName || Array.isArray(jids);
        const groupId = incomingGroupId || (isGroupBatch ? `batch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}` : null);

        let existingCount = 0;
        if (groupId && incomingGroupId) {
            existingCount = await prisma.scheduledMessage.count({
                where: {
                    sessionId: session.id,
                    OR: [
                        { groupId: groupId },
                        { recurrenceRule: { contains: groupId } }
                    ]
                }
            });
        }

        const createdItems = [];

        for (let i = 0; i < targetList.length; i++) {
            const raw = targetList[i];
            const cleanJid = sanitizeJid(raw);

            // Calcula o horário com intervalo anti-bloqueio para envios em grupo
            const memberSendAt = isGroupBatch
                ? moment(utcDate).add((existingCount + i) * Math.max(delayBetweenSeconds, 5), "seconds").toDate()
                : utcDate;

            let metaRule: any = {};
            try {
                if (recurrenceRule) metaRule = typeof recurrenceRule === "string" ? JSON.parse(recurrenceRule) : recurrenceRule;
            } catch {}

            if (isFlowSchedule && flowId) {
                metaRule.scheduleType = "flow";
                metaRule.flowId = flowId;
                metaRule.flowName = flowName || "Fluxo Automação";
            }

            if (groupId) {
                metaRule.groupId = groupId;
                metaRule.groupName = groupName || `Grupo ${existingCount + targetList.length} pessoas`;
                metaRule.groupTotal = existingCount + targetList.length;
                metaRule.groupIndex = existingCount + i + 1;
            }
            if (cleanNotifyJid) {
                metaRule.notifyJid = cleanNotifyJid;
            }

            const effectiveContent = (isFlowSchedule && flowId)
                ? (content || `⚡ Iniciar Fluxo: "${flowName || "Fluxo Automação"}"`)
                : (content || null);

            let scheduled;
            try {
                scheduled = await prisma.scheduledMessage.create({
                    data: {
                        sessionId: session.id,
                        jid: cleanJid,
                        content: effectiveContent,
                        mediaUrl: mediaUrl || null,
                        mediaType: mediaType || null,
                        cronExpression: cronExpression || null,
                        recurrenceRule: JSON.stringify(metaRule),
                        groupId: groupId || null,
                        notifyJid: cleanNotifyJid || null,
                        sendAt: memberSendAt,
                        status: "PENDING"
                    }
                });
            } catch (createErr: any) {
                console.warn("[Scheduler:POST] Tentando fallback para salvar campos em recurrenceRule:", createErr?.message);
                scheduled = await prisma.scheduledMessage.create({
                    data: {
                        sessionId: session.id,
                        jid: cleanJid,
                        content: effectiveContent,
                        mediaUrl: mediaUrl || null,
                        mediaType: mediaType || null,
                        cronExpression: cronExpression || null,
                        recurrenceRule: JSON.stringify(metaRule),
                        sendAt: memberSendAt,
                        status: "PENDING"
                    }
                });
            }

            createdItems.push(scheduled);
        }

        if (incomingGroupId && existingCount > 0) {
            const newTotal = existingCount + targetList.length;
            const existingMsgs = await prisma.scheduledMessage.findMany({
                where: {
                    sessionId: session.id,
                    OR: [
                        { groupId: incomingGroupId },
                        { recurrenceRule: { contains: incomingGroupId } }
                    ]
                }
            });
            for (const ex of existingMsgs) {
                try {
                    if (ex.recurrenceRule) {
                        const parsed = JSON.parse(ex.recurrenceRule);
                        parsed.groupTotal = newTotal;
                        await prisma.scheduledMessage.update({
                            where: { id: ex.id },
                            data: { recurrenceRule: JSON.stringify(parsed) }
                        });
                    }
                } catch {}
            }
        }

        const successMessage = isGroupBatch
            ? (incomingGroupId
                ? `${targetList.length} contato(s) adicionado(s) ao grupo com sucesso!`
                : `Agendamento criado com sucesso para o grupo de ${targetList.length} pessoas!`)
            : "Mensagem agendada com sucesso!";

        return NextResponse.json({
            status: true,
            message: successMessage,
            data: isGroupBatch ? createdItems : createdItems[0],
            count: createdItems.length,
            groupId
        });

    } catch (error: any) {
        console.error("Schedule error:", error);
        return NextResponse.json({
            status: false,
            message: error?.message || "Ocorreu um erro interno ao salvar o agendamento.",
            error: String(error)
        }, { status: 500 });
    }
}
