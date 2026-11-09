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

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; scheduleId: string }> }
) {
    try {
        const { sessionId, scheduleId } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const body = await request.json();
        const { jid, content, sendAt, mediaUrl, mediaType, cronExpression, recurrenceRule } = body;

        if (!jid || (!content && !mediaUrl) || !sendAt) {
            return NextResponse.json({ status: false, message: "Missing required fields (JID, Content/Media, SendAt)", error: "Missing required fields" }, { status: 400 });
        }

        // Fetch system timezone
        // @ts-ignore
        const systemConfig = await prisma.systemConfig.findUnique({ where: { id: "default" } });
        const timezone = systemConfig?.timezone || "America/Sao_Paulo";

        let utcDate = moment.tz(sendAt, timezone).toDate();
        if (cronExpression) {
            try {
                const interval = CronExpressionParser.parse(cronExpression, { currentDate: new Date(), tz: timezone });
                utcDate = interval.next().toDate();
            } catch (e) {
                console.warn("[Scheduler:PUT] Could not calculate next cron date, using sendAt:", e);
            }
        }
        console.log(`[Scheduler:PUT] Resolved UTC Date: ${utcDate.toISOString()} using timezone: ${timezone}`);

        const msg = await prisma.scheduledMessage.findUnique({
            where: { id: scheduleId },
            include: { session: true }
        });

        if (!msg) {
            return NextResponse.json({ status: false, message: "Message not found", error: "Message not found" }, { status: 404 });
        }

        // Verify the schedule belongs to this session
        if (msg.session.sessionId !== sessionId) {
            return NextResponse.json({ status: false, message: "Schedule not found in this session", error: "Schedule not found in this session" }, { status: 404 });
        }

        const cleanJid = sanitizeJid(jid);

        const url = new URL(request.url);
        const updateWholeGroup = url.searchParams.get("updateWholeGroup") === "true" || body.updateWholeGroup === true;

        let targetGroupId = msg.groupId;
        if (!targetGroupId && msg.recurrenceRule) {
            try {
                const parsed = JSON.parse(msg.recurrenceRule);
                if (parsed.groupId) targetGroupId = parsed.groupId;
            } catch {}
        }

        if (updateWholeGroup && targetGroupId) {
            const groupMessages = await prisma.scheduledMessage.findMany({
                where: {
                    sessionId: msg.sessionId,
                    OR: [
                        { groupId: targetGroupId },
                        { recurrenceRule: { contains: targetGroupId } }
                    ]
                },
                orderBy: { sendAt: 'asc' }
            });

            const updatedItems = [];
            for (let i = 0; i < groupMessages.length; i++) {
                const member = groupMessages[i];
                const memberSendAt = moment(utcDate).add(i * 15, "seconds").toDate();

                let memberRule: any = {};
                try {
                    if (member.recurrenceRule) memberRule = JSON.parse(member.recurrenceRule);
                } catch {}

                if (body.groupName) {
                    memberRule.groupName = body.groupName;
                }

                if (recurrenceRule) {
                    try {
                        const parsedNew = typeof recurrenceRule === "string" ? JSON.parse(recurrenceRule) : recurrenceRule;
                        memberRule = { ...memberRule, ...parsedNew };
                    } catch {}
                }

                const up = await prisma.scheduledMessage.update({
                    where: { id: member.id },
                    data: {
                        content: content !== undefined ? content : member.content,
                        mediaUrl: mediaUrl !== undefined ? mediaUrl : member.mediaUrl,
                        mediaType: mediaType !== undefined ? mediaType : member.mediaType,
                        cronExpression: cronExpression !== undefined ? cronExpression : member.cronExpression,
                        recurrenceRule: JSON.stringify(memberRule),
                        sendAt: memberSendAt
                    }
                });
                updatedItems.push(up);
            }
            return NextResponse.json({ status: true, message: "Grupo atualizado com sucesso", count: updatedItems.length, data: updatedItems });
        }

        const updated = await prisma.scheduledMessage.update({
            where: { id: scheduleId },
            data: {
                jid: cleanJid,
                content,
                sendAt: utcDate,
                mediaUrl: mediaUrl || null,
                mediaType: mediaType || null,
                cronExpression: cronExpression !== undefined ? cronExpression : msg.cronExpression,
                recurrenceRule: recurrenceRule !== undefined ? recurrenceRule : msg.recurrenceRule
            }
        });

        return NextResponse.json(updated);
    } catch (error) {
        console.error("Update schedule error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; scheduleId: string }> }
) {
    try {
        const { sessionId, scheduleId } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const msg = await prisma.scheduledMessage.findUnique({
            where: { id: scheduleId },
            include: { session: true }
        });

        if (!msg || msg.session.sessionId !== sessionId) {
            return NextResponse.json({ status: false, message: "Agendamento não encontrado", error: "Schedule not found" }, { status: 404 });
        }

        const body = await request.json();
        const active = Boolean(body.active);
        const toggleWholeGroup = Boolean(body.toggleWholeGroup);
        const newStatus = active ? "PENDING" : "PAUSED";

        // @ts-ignore
        const systemConfig = await prisma.systemConfig.findUnique({ where: { id: "default" } });
        const timezone = systemConfig?.timezone || "America/Sao_Paulo";
        const now = new Date();

        const computeNextSendAt = (item: { sendAt: Date; cronExpression: string | null }, offsetSeconds = 0): Date => {
            if (!active) return item.sendAt;
            if (item.cronExpression && new Date(item.sendAt) <= now) {
                try {
                    const interval = CronExpressionParser.parse(item.cronExpression, { currentDate: now, tz: timezone });
                    const base = interval.next().toDate();
                    return offsetSeconds > 0 ? moment(base).add(offsetSeconds, "seconds").toDate() : base;
                } catch {}
            }
            return item.sendAt;
        };

        let targetGroupId = msg.groupId;
        if (!targetGroupId && msg.recurrenceRule) {
            try {
                const parsed = JSON.parse(msg.recurrenceRule);
                if (parsed.groupId) targetGroupId = parsed.groupId;
            } catch {}
        }

        if (toggleWholeGroup && targetGroupId) {
            const groupMessages = await prisma.scheduledMessage.findMany({
                where: {
                    sessionId: msg.sessionId,
                    status: { in: ["PENDING", "PAUSED"] },
                    OR: [
                        { groupId: targetGroupId },
                        { recurrenceRule: { contains: targetGroupId } }
                    ]
                },
                orderBy: { sendAt: "asc" }
            });

            const updatedItems = [];
            for (let i = 0; i < groupMessages.length; i++) {
                const member = groupMessages[i];
                const nextDate = computeNextSendAt(member, i * 15);
                const up = await prisma.scheduledMessage.update({
                    where: { id: member.id },
                    data: {
                        status: newStatus,
                        sendAt: nextDate
                    }
                });
                updatedItems.push(up);
            }

            return NextResponse.json({
                status: true,
                message: active ? "Grupo de agendamentos ativado!" : "Grupo de agendamentos pausado!",
                data: updatedItems
            });
        }

        const updated = await prisma.scheduledMessage.update({
            where: { id: scheduleId },
            data: {
                status: newStatus,
                sendAt: computeNextSendAt(msg, 0)
            }
        });

        return NextResponse.json({
            status: true,
            message: active ? "Agendamento ativado!" : "Agendamento desativado/pausado!",
            data: updated
        });
    } catch (error) {
        console.error("Toggle schedule active error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; scheduleId: string }> }
) {
    try {
        const { sessionId, scheduleId } = await params;

        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const msg = await prisma.scheduledMessage.findUnique({
            where: { id: scheduleId },
            include: { session: true }
        });

        if (!msg) {
            return NextResponse.json({ status: false, message: "Message not found", error: "Message not found" }, { status: 404 });
        }

        // Verify the schedule belongs to this session
        if (msg.session.sessionId !== sessionId) {
            return NextResponse.json({ status: false, message: "Schedule not found in this session", error: "Schedule not found in this session" }, { status: 404 });
        }

        const url = new URL(request.url);
        const deleteWholeGroup = url.searchParams.get("deleteWholeGroup") === "true";

        let targetGroupId = msg.groupId;
        if (!targetGroupId && msg.recurrenceRule) {
            try {
                const parsed = JSON.parse(msg.recurrenceRule);
                if (parsed.groupId) targetGroupId = parsed.groupId;
            } catch {}
        }

        if (deleteWholeGroup && targetGroupId) {
            await prisma.scheduledMessage.deleteMany({
                where: {
                    sessionId: msg.sessionId,
                    OR: [
                        { groupId: targetGroupId },
                        { recurrenceRule: { contains: targetGroupId } }
                    ]
                }
            });
            return NextResponse.json({ status: true, message: "Group schedules deleted successfully" });
        }

        await prisma.scheduledMessage.delete({ where: { id: scheduleId } });
        return NextResponse.json({ status: true, message: "Operation successful" });

    } catch (error) {
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}
