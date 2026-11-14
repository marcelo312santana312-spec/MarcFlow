import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessSession, getAuthenticatedUser } from "@/lib/api-auth";
import { z } from "zod";
import {
    getTeamOwnerId,
    getUserAccessibleSessionIds,
    resolveSession,
} from "../_helpers";

const ticketStatusEnum = z.enum([
    "OPEN",
    "IN_PROGRESS",
    "WAITING_CUSTOMER",
    "RESOLVED",
]);
const ticketPriorityEnum = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);

const upsertTicketSchema = z.object({
    id: z.string().optional(),
    sessionId: z.string().optional(),
    contactJid: z.string().optional(),
    contactName: z.string().nullable().optional(),
    assignedUserId: z.string().nullable().optional(),
    status: ticketStatusEnum.optional(),
    priority: ticketPriorityEnum.optional(),
    botPausedUntil: z.string().datetime().nullable().optional(),
    slaDueAt: z.string().datetime().nullable().optional(),
});

async function getAssignableAgents(userId: string, sessionIds: string[]) {
    const ownerId = await getTeamOwnerId(userId);
    const [teamUsers, sharedUsers] = await Promise.all([
        prisma.user.findMany({
            where: {
                OR: [{ id: userId }, { id: ownerId }, { ownerId }],
            },
            select: { id: true, name: true, email: true, role: true },
        }),
        sessionIds.length > 0
            ? prisma.sessionAccess.findMany({
                  where: { sessionId: { in: sessionIds } },
                  select: {
                      user: {
                          select: { id: true, name: true, email: true, role: true },
                      },
                  },
              })
            : Promise.resolve([]),
    ]);

    const map = new Map<
        string,
        { id: string; name: string | null; email: string; role: string }
    >();
    for (const u of teamUsers) map.set(u.id, u);
    for (const s of sharedUsers) map.set(s.user.id, s.user);
    return Array.from(map.values());
}

export async function GET(req: NextRequest) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return NextResponse.json(
                { status: false, message: "Não autorizado" },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(req.url);
        const sessionParam = searchParams.get("sessionId");
        const status = searchParams.get("status");
        const assignedUserId = searchParams.get("assignedUserId");
        const contactJid = searchParams.get("contactJid");
        const priority = searchParams.get("priority");

        let sessionIds = await getUserAccessibleSessionIds(user.id, user.role);

        if (sessionParam) {
            const resolved = await resolveSession(sessionParam);
            if (!resolved) {
                return NextResponse.json({
                    status: true,
                    data: [],
                    agents: await getAssignableAgents(user.id, sessionIds),
                });
            }
            const canAccess = await canAccessSession(
                user.id,
                user.role,
                resolved.id
            );
            if (!canAccess) {
                return NextResponse.json(
                    { status: false, message: "Sem permissão para esta sessão" },
                    { status: 403 }
                );
            }
            sessionIds = [resolved.id];
        }

        const agents = await getAssignableAgents(user.id, sessionIds);

        if (sessionIds.length === 0) {
            return NextResponse.json({ status: true, data: [], agents });
        }

        const where: Record<string, unknown> = {
            sessionId: { in: sessionIds },
        };

        if (status && status !== "ALL") where.status = status;
        if (priority && priority !== "ALL") where.priority = priority;
        if (contactJid) where.contactJid = contactJid;
        if (assignedUserId === "UNASSIGNED") {
            where.assignedUserId = null;
        } else if (assignedUserId && assignedUserId !== "ALL") {
            where.assignedUserId = assignedUserId;
        }

        const tickets = await prisma.conversationTicket.findMany({
            where,
            orderBy: [{ lastMessageAt: "desc" }],
            include: {
                assignedUser: {
                    select: { id: true, name: true, email: true, role: true },
                },
                session: {
                    select: { id: true, sessionId: true, name: true },
                },
            },
        });

        return NextResponse.json({
            status: true,
            data: tickets,
            agents,
        });
    } catch (error) {
        console.error("GET /api/crm/tickets error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao listar tickets" },
            { status: 500 }
        );
    }
}

async function handleUpsert(req: NextRequest) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return NextResponse.json(
                { status: false, message: "Não autorizado" },
                { status: 401 }
            );
        }

        const body = await req.json();
        const parsed = upsertTicketSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                {
                    status: false,
                    message: "Dados inválidos",
                    error: parsed.error.flatten(),
                },
                { status: 400 }
            );
        }

        const input = parsed.data;

        if (input.id) {
            const existing = await prisma.conversationTicket.findUnique({
                where: { id: input.id },
            });
            if (!existing) {
                return NextResponse.json(
                    { status: false, message: "Ticket não encontrado" },
                    { status: 404 }
                );
            }
            const canAccess = await canAccessSession(
                user.id,
                user.role,
                existing.sessionId
            );
            if (!canAccess) {
                return NextResponse.json(
                    { status: false, message: "Sem permissão" },
                    { status: 403 }
                );
            }

            const updated = await prisma.conversationTicket.update({
                where: { id: input.id },
                data: {
                    ...(input.contactName !== undefined && {
                        contactName: input.contactName,
                    }),
                    ...(input.assignedUserId !== undefined && {
                        assignedUserId: input.assignedUserId,
                    }),
                    ...(input.status !== undefined && { status: input.status }),
                    ...(input.priority !== undefined && {
                        priority: input.priority,
                    }),
                    ...(input.botPausedUntil !== undefined && {
                        botPausedUntil: input.botPausedUntil
                            ? new Date(input.botPausedUntil)
                            : null,
                    }),
                    ...(input.slaDueAt !== undefined && {
                        slaDueAt: input.slaDueAt
                            ? new Date(input.slaDueAt)
                            : null,
                    }),
                },
                include: {
                    assignedUser: {
                        select: { id: true, name: true, email: true, role: true },
                    },
                    session: {
                        select: { id: true, sessionId: true, name: true },
                    },
                },
            });

            return NextResponse.json({
                status: true,
                message: "Ticket atualizado",
                data: updated,
            });
        }

        if (!input.sessionId || !input.contactJid) {
            return NextResponse.json(
                {
                    status: false,
                    message: "Informe id ou sessionId + contactJid",
                },
                { status: 400 }
            );
        }

        const resolvedSession = await resolveSession(input.sessionId);
        if (!resolvedSession) {
            return NextResponse.json(
                { status: false, message: "Sessão não encontrada" },
                { status: 404 }
            );
        }

        const canAccess = await canAccessSession(
            user.id,
            user.role,
            resolvedSession.id
        );
        if (!canAccess) {
            return NextResponse.json(
                { status: false, message: "Sem permissão" },
                { status: 403 }
            );
        }

        const defaultSla = new Date(Date.now() + 30 * 60 * 1000);

        const ticket = await prisma.conversationTicket.upsert({
            where: {
                sessionId_contactJid: {
                    sessionId: resolvedSession.id,
                    contactJid: input.contactJid,
                },
            },
            create: {
                sessionId: resolvedSession.id,
                contactJid: input.contactJid,
                contactName: input.contactName || null,
                assignedUserId: input.assignedUserId ?? null,
                status: input.status || "OPEN",
                priority: input.priority || "NORMAL",
                botPausedUntil: input.botPausedUntil
                    ? new Date(input.botPausedUntil)
                    : null,
                slaDueAt: input.slaDueAt ? new Date(input.slaDueAt) : defaultSla,
            },
            update: {
                ...(input.contactName !== undefined && {
                    contactName: input.contactName,
                }),
                ...(input.assignedUserId !== undefined && {
                    assignedUserId: input.assignedUserId,
                }),
                ...(input.status !== undefined && { status: input.status }),
                ...(input.priority !== undefined && {
                    priority: input.priority,
                }),
                ...(input.botPausedUntil !== undefined && {
                    botPausedUntil: input.botPausedUntil
                        ? new Date(input.botPausedUntil)
                        : null,
                }),
                ...(input.slaDueAt !== undefined && {
                    slaDueAt: input.slaDueAt ? new Date(input.slaDueAt) : null,
                }),
            },
            include: {
                assignedUser: {
                    select: { id: true, name: true, email: true, role: true },
                },
                session: {
                    select: { id: true, sessionId: true, name: true },
                },
            },
        });

        return NextResponse.json({
            status: true,
            message: "Ticket salvo",
            data: ticket,
        });
    } catch (error) {
        console.error("Upsert /api/crm/tickets error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao salvar ticket" },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    return handleUpsert(req);
}

export async function PATCH(req: NextRequest) {
    return handleUpsert(req);
}
