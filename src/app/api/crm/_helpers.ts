import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/api-auth";

export async function resolveSession(sessionIdOrSlug: string) {
    if (!sessionIdOrSlug) return null;
    return prisma.session.findFirst({
        where: {
            OR: [{ id: sessionIdOrSlug }, { sessionId: sessionIdOrSlug }],
        },
        select: { id: true, sessionId: true, name: true, userId: true },
    });
}

export async function getUserAccessibleSessionIds(userId: string, userRole: string): Promise<string[]> {
    if (isAdmin(userRole)) {
        const all = await prisma.session.findMany({ select: { id: true } });
        return all.map((s) => s.id);
    }

    const [owned, shared] = await Promise.all([
        prisma.session.findMany({ where: { userId }, select: { id: true } }),
        prisma.sessionAccess.findMany({ where: { userId }, select: { sessionId: true } }),
    ]);

    const ids = new Set<string>();
    for (const s of owned) ids.add(s.id);
    for (const a of shared) ids.add(a.sessionId);
    return Array.from(ids);
}

export async function getTeamOwnerId(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, ownerId: true },
    });
    return user?.ownerId || userId;
}

export const DEFAULT_PIPELINE_STAGES = [
    { name: "Novo Lead", color: "#3B82F6", order: 0, isWon: false, isLost: false },
    { name: "Em Atendimento", color: "#F59E0B", order: 1, isWon: false, isLost: false },
    { name: "Proposta Enviada", color: "#8B5CF6", order: 2, isWon: false, isLost: false },
    { name: "Fechado (Ganho)", color: "#10B981", order: 3, isWon: true, isLost: false },
    { name: "Perdido", color: "#EF4444", order: 4, isWon: false, isLost: true },
];

export async function ensureDefaultPipeline(ownerId: string) {
    const existing = await prisma.pipeline.findMany({
        where: { userId: ownerId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        include: {
            stages: { orderBy: { order: "asc" } },
        },
    });

    if (existing.length > 0) {
        return existing;
    }

    const created = await prisma.pipeline.create({
        data: {
            userId: ownerId,
            name: "Funil de Vendas",
            isDefault: true,
            stages: {
                create: DEFAULT_PIPELINE_STAGES,
            },
        },
        include: {
            stages: { orderBy: { order: "asc" } },
        },
    });

    return [created];
}

export function cleanPhoneFromJid(jid: string): string {
    return jid.split("@")[0] || jid;
}
