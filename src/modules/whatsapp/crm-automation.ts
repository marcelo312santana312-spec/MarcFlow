import moment from "moment-timezone";
import type { WASocket } from "@whiskeysockets/baileys";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { waManager } from "./manager";

let crmTickRunning = false;

function firstNameOf(name?: string | null): string {
    const clean = (name || "").trim();
    if (!clean) return "";
    return ` ${clean.split(/\s+/)[0]}`;
}

async function getSystemTz(): Promise<string> {
    try {
        const cfg = await prisma.systemConfig.findUnique({ where: { id: "default" }, select: { timezone: true } });
        return cfg?.timezone || process.env.TZ || "America/Sao_Paulo";
    } catch {
        return "America/Sao_Paulo";
    }
}

async function processDealFollowUps(now: Date) {
    const dueDeals = await prisma.deal.findMany({
        where: {
            status: "OPEN",
            followUpAt: { lte: now },
            followUpCount: { lt: 3 },
        },
        include: {
            session: { select: { sessionId: true } },
        },
        orderBy: { followUpAt: "asc" },
        take: 25,
    });

    for (const deal of dueDeals) {
        const inst = waManager.getInstance(deal.session.sessionId);
        if (!inst?.socket || inst.status !== "CONNECTED") continue;

        const optedOut = await prisma.broadcastOptOut.findUnique({
            where: { sessionId_jid: { sessionId: deal.session.sessionId, jid: deal.contactJid } },
        });
        if (optedOut) {
            await prisma.deal.update({ where: { id: deal.id }, data: { followUpAt: null } });
            continue;
        }

        const nome = firstNameOf(deal.contactName);
        const text =
            deal.followUpCount === 0
                ? `Olá${nome}! Passando para saber se ficou alguma dúvida sobre o orçamento *${deal.title}* 😊 Posso te ajudar a finalizar ou ajustar algo?`
                : deal.followUpCount === 1
                  ? `Oi${nome}, tudo bem? Ainda temos condições especiais para *${deal.title}*. Se quiser retomar de onde paramos, é só responder por aqui!`
                  : `Olá${nome}! Último lembrete amigável sobre *${deal.title}*. Caso prefira falar em outro momento, sem problemas — seguimos à disposição!`;

        try {
            await (inst.socket as WASocket).sendMessage(deal.contactJid, { text });
            const nextCount = deal.followUpCount + 1;
            const nextFollowUp =
                nextCount === 1
                    ? new Date(now.getTime() + 48 * 3600_000) // D+3 após D+1
                    : nextCount === 2
                      ? new Date(now.getTime() + 72 * 3600_000)
                      : null;

            await prisma.deal.update({
                where: { id: deal.id },
                data: {
                    followUpCount: nextCount,
                    followUpAt: nextFollowUp,
                    lastInteractionAt: now,
                },
            });
            logger.info("CrmAutomation", `Follow-up #${nextCount} enviado para deal ${deal.id} (${deal.contactJid})`);
        } catch (err) {
            logger.error("CrmAutomation", `Falha ao enviar follow-up do deal ${deal.id}`, err);
        }
    }
}

async function processAppointmentReminders(now: Date, tz: string) {
    const in24h = new Date(now.getTime() + 24 * 3600_000);
    const in2h = new Date(now.getTime() + 2 * 3600_000);

    const dueAppointments = await prisma.appointment.findMany({
        where: {
            status: { in: ["SCHEDULED", "CONFIRMED"] },
            scheduledAt: { gt: now, lte: in24h },
            OR: [
                { reminder24hSent: false },
                { AND: [{ scheduledAt: { lte: in2h } }, { reminder2hSent: false }] },
            ],
        },
        include: {
            session: { select: { sessionId: true } },
        },
        orderBy: { scheduledAt: "asc" },
        take: 25,
    });

    for (const appt of dueAppointments) {
        const inst = waManager.getInstance(appt.session.sessionId);
        if (!inst?.socket || inst.status !== "CONNECTED") continue;

        const nome = firstNameOf(appt.contactName);
        const dt = moment(appt.scheduledAt).tz(tz);
        const dataStr = dt.format("DD/MM");
        const horaStr = dt.format("HH:mm");
        const isWithin2h = appt.scheduledAt.getTime() <= in2h.getTime();

        try {
            if (isWithin2h && !appt.reminder2hSent) {
                const text = `Olá${nome}! ⏰ Lembrete: seu agendamento *${appt.title}* é daqui a pouco, hoje às *${horaStr}*.\n\nNos vemos em breve!`;
                await (inst.socket as WASocket).sendMessage(appt.contactJid, { text });
                await prisma.appointment.update({
                    where: { id: appt.id },
                    data: { reminder2hSent: true, reminder24hSent: true },
                });
                logger.info("CrmAutomation", `Lembrete 2h enviado para agendamento ${appt.id}`);
            } else if (!appt.reminder24hSent) {
                const text = `Olá${nome}! 📅 Confirmando seu agendamento *${appt.title}* para *${dataStr}* às *${horaStr}*.\n\nResponda *SIM* para confirmar ou nos avise se precisar reagendar!`;
                await (inst.socket as WASocket).sendMessage(appt.contactJid, { text });
                await prisma.appointment.update({
                    where: { id: appt.id },
                    data: { reminder24hSent: true },
                });
                logger.info("CrmAutomation", `Confirmação 24h enviada para agendamento ${appt.id}`);
            }
        } catch (err) {
            logger.error("CrmAutomation", `Falha ao enviar lembrete do agendamento ${appt.id}`, err);
        }
    }
}

export async function runCrmAutomationsTick(): Promise<void> {
    if (crmTickRunning) return;
    crmTickRunning = true;
    try {
        const now = new Date();
        const tz = await getSystemTz();
        await processDealFollowUps(now);
        await processAppointmentReminders(now, tz);
    } catch (err) {
        logger.error("CrmAutomation", "Erro no tick de automações de CRM", err);
    } finally {
        crmTickRunning = false;
    }
}
