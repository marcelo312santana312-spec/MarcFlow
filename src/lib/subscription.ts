import { prisma } from "@/lib/prisma";

export type PlanResource = "sessions" | "users" | "broadcast";

export const DEFAULT_PLANS = [
    {
        slug: "starter",
        name: "Starter",
        description: "Ideal para autônomos e pequenos negócios que estão começando a vender pelo WhatsApp.",
        priceCents: 9700,
        maxSessions: 1,
        maxUsers: 2,
        maxBroadcastDaily: 200,
        hasAiStudio: false,
        hasCrm: true,
        isActive: true,
    },
    {
        slug: "pro",
        name: "Pro",
        description: "Para empresas em crescimento com equipe de atendimento, funil de vendas CRM e automação com IA.",
        priceCents: 19700,
        maxSessions: 3,
        maxUsers: 5,
        maxBroadcastDaily: 1000,
        hasAiStudio: true,
        hasCrm: true,
        isActive: true,
    },
    {
        slug: "enterprise",
        name: "Enterprise",
        description: "Escala máxima com múltiplos números WhatsApp, equipe completa, IA ilimitada e alta volumetria.",
        priceCents: 39700,
        maxSessions: 10,
        maxUsers: 20,
        maxBroadcastDaily: 10000,
        hasAiStudio: true,
        hasCrm: true,
        isActive: true,
    },
] as const;

let seedPromise: Promise<void> | null = null;

/**
 * Ensures the 3 default SaaS plans (Starter, Pro, Enterprise) exist in the database.
 */
export async function ensureDefaultPlans() {
    if (!seedPromise) {
        seedPromise = (async () => {
            try {
                for (const plan of DEFAULT_PLANS) {
                    await prisma.plan.upsert({
                        where: { slug: plan.slug },
                        update: {},
                        create: { ...plan },
                    });
                }
            } finally {
                seedPromise = null;
            }
        })();
    }
    await seedPromise;
    return prisma.plan.findMany({
        where: { isActive: true },
        orderBy: { priceCents: "asc" },
    });
}

/**
 * Resolves the billing owner ID for a user (STAFF inherits their OWNER's subscription).
 */
export async function resolveBillingOwnerId(userId: string): Promise<{ ownerId: string; role: string }> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, ownerId: true },
    });

    if (!user) {
        throw new Error("Usuário não encontrado.");
    }

    const ownerId = user.role === "STAFF" && user.ownerId ? user.ownerId : user.id;
    return { ownerId, role: user.role };
}

/**
 * Returns the user's active/trial subscription, plan limits, and current resource usage.
 * Automatically creates a 7-day Pro Trial if the owner has no subscription yet.
 */
export async function getUserSubscriptionWithLimits(userId: string) {
    const { ownerId, role } = await resolveBillingOwnerId(userId);
    await ensureDefaultPlans();

    let subscription = await prisma.subscription.findUnique({
        where: { userId: ownerId },
        include: { plan: true },
    });

    if (!subscription) {
        const proPlan =
            (await prisma.plan.findUnique({ where: { slug: "pro" } })) ||
            (await prisma.plan.findFirst({ where: { isActive: true }, orderBy: { priceCents: "asc" } }));

        if (!proPlan) {
            throw new Error("Nenhum plano ativo encontrado no sistema.");
        }

        const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        subscription = await prisma.subscription.create({
            data: {
                userId: ownerId,
                planId: proPlan.id,
                status: "TRIAL",
                trialEndsAt: trialEnd,
                currentPeriodEnd: trialEnd,
            },
            include: { plan: true },
        });
    }

    const now = new Date();
    let effectiveStatus = subscription.status;

    if (effectiveStatus === "TRIAL" && subscription.trialEndsAt && subscription.trialEndsAt < now) {
        effectiveStatus = "EXPIRED";
        await prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: "EXPIRED" },
        });
        subscription = { ...subscription, status: "EXPIRED" };
    } else if (
        effectiveStatus === "ACTIVE" &&
        subscription.currentPeriodEnd &&
        subscription.currentPeriodEnd < now
    ) {
        effectiveStatus = "PAST_DUE";
    }

    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const [sessionsCount, staffCount, ownerSessions] = await Promise.all([
        prisma.session.count({ where: { userId: ownerId } }),
        prisma.user.count({ where: { ownerId, role: "STAFF" } }),
        prisma.session.findMany({
            where: { userId: ownerId },
            select: { sessionId: true },
        }),
    ]);

    const sessionIds = ownerSessions.map((s) => s.sessionId);
    let broadcastDailyCount = 0;
    if (sessionIds.length > 0) {
        broadcastDailyCount = await prisma.scheduledMessage.count({
            where: {
                sessionId: { in: sessionIds },
                createdAt: { gte: startOfDay },
            },
        });
    }

    const usersCount = 1 + staffCount;
    const isTrialActive = effectiveStatus === "TRIAL" && (!subscription.trialEndsAt || subscription.trialEndsAt >= now);
    const isExpired = effectiveStatus === "EXPIRED" || effectiveStatus === "CANCELED";

    const trialDaysLeft =
        subscription.trialEndsAt && subscription.trialEndsAt > now
            ? Math.max(0, Math.ceil((subscription.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
            : 0;

    return {
        ownerId,
        role,
        subscription,
        plan: subscription.plan,
        status: effectiveStatus,
        isTrialActive,
        isExpired,
        trialDaysLeft,
        usage: {
            sessions: sessionsCount,
            users: usersCount,
            staff: staffCount,
            broadcastDaily: broadcastDailyCount,
        },
        limits: {
            maxSessions: subscription.plan.maxSessions,
            maxUsers: subscription.plan.maxUsers,
            maxBroadcastDaily: subscription.plan.maxBroadcastDaily,
            hasAiStudio: subscription.plan.hasAiStudio,
            hasCrm: subscription.plan.hasCrm,
        },
    };
}

export interface PlanLimitCheckResult {
    allowed: boolean;
    reason?: string;
    current: number;
    limit: number;
    planName: string;
}

/**
 * Checks whether the user/owner can consume one more unit of a plan resource.
 * SUPERADMIN bypasses plan limits.
 */
export async function checkPlanLimit(userId: string, resource: PlanResource): Promise<PlanLimitCheckResult> {
    const info = await getUserSubscriptionWithLimits(userId);

    if (info.role === "SUPERADMIN") {
        return {
            allowed: true,
            current: 0,
            limit: 999999,
            planName: info.plan.name,
        };
    }

    if (info.isExpired) {
        return {
            allowed: false,
            reason: "Seu período de teste ou assinatura expirou. Escolha um plano em Planos & Assinatura para continuar.",
            current: 0,
            limit: 0,
            planName: info.plan.name,
        };
    }

    if (resource === "sessions") {
        const current = info.usage.sessions;
        const limit = info.limits.maxSessions;
        if (current >= limit) {
            return {
                allowed: false,
                reason: `Limite de conexões WhatsApp atingido (${current}/${limit}) no plano ${info.plan.name}. Faça upgrade para conectar mais números.`,
                current,
                limit,
                planName: info.plan.name,
            };
        }
        return { allowed: true, current, limit, planName: info.plan.name };
    }

    if (resource === "users") {
        const current = info.usage.users;
        const limit = info.limits.maxUsers;
        if (current >= limit) {
            return {
                allowed: false,
                reason: `Limite de usuários da equipe atingido (${current}/${limit}) no plano ${info.plan.name}. Faça upgrade para adicionar mais atendentes.`,
                current,
                limit,
                planName: info.plan.name,
            };
        }
        return { allowed: true, current, limit, planName: info.plan.name };
    }

    const current = info.usage.broadcastDaily;
    const limit = info.limits.maxBroadcastDaily;
    if (current >= limit) {
        return {
            allowed: false,
            reason: `Limite diário de disparos atingido (${current}/${limit}) no plano ${info.plan.name}. Faça upgrade para ampliar seu envio diário.`,
            current,
            limit,
            planName: info.plan.name,
        };
    }

    return { allowed: true, current, limit, planName: info.plan.name };
}
