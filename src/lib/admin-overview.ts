import { prisma } from "@/lib/prisma";
import { computeEffectiveSubscriptionStatus, ensureDefaultPlans } from "@/lib/subscription";

export type SubscriptionStatusValue = "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED" | "NONE";

export interface ClientSessionSummary {
    id: string;
    name: string;
    sessionId: string;
    status: string;
}

export interface ClientTeamMemberSummary {
    id: string;
    name: string | null;
    email: string;
    createdAt: string;
}

export interface ClientInstagramSummary {
    id: string;
    username: string;
    accountType: string | null;
}

export interface SuperAdminClientRow {
    id: string;
    name: string | null;
    email: string;
    role: string;
    createdAt: string;
    subscription: {
        id: string;
        planId: string;
        planName: string;
        planSlug: string;
        priceCents: number;
        status: string;
        effectiveStatus: SubscriptionStatusValue;
        trialDaysLeft: number;
        trialEndsAt: string | null;
        currentPeriodEnd: string | null;
        externalRef: string | null;
    } | null;
    limits: {
        maxSessions: number;
        maxUsers: number;
        maxBroadcastDaily: number;
        hasAiStudio: boolean;
        hasCrm: boolean;
    };
    usage: {
        sessions: number;
        connectedSessions: number;
        users: number;
        staff: number;
        broadcastDaily: number;
        deals: number;
        instagramAccounts: number;
        instagramPostsPending: number;
        instagramPostsPublished: number;
    };
    details: {
        sessions: ClientSessionSummary[];
        teamMembers: ClientTeamMemberSummary[];
        instagramAccounts: ClientInstagramSummary[];
    };
}

export interface SuperAdminPlanSummary {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    priceCents: number;
    maxSessions: number;
    maxUsers: number;
    maxBroadcastDaily: number;
    hasAiStudio: boolean;
    hasCrm: boolean;
    isActive: boolean;
    subscribersCount: number;
    activeSubscribersCount: number;
    mrrCents: number;
}

export interface SuperAdminInstagramRequestItem {
    id: string;
    userId: string;
    userName: string | null;
    userEmail: string;
    igUsername: string;
    status: "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";
    adminNote: string | null;
    approvedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface SuperAdminKpis {
    totalClients: number;
    totalTeamMembers: number;
    activeSubscriptions: number;
    trialSubscriptions: number;
    pastDueSubscriptions: number;
    expiredOrCanceled: number;
    withoutSubscription: number;
    mrrCents: number;
    potentialMrrCents: number;
    totalSessions: number;
    connectedSessions: number;
    totalInstagramAccounts: number;
    totalInstagramPostsPending: number;
    totalBroadcastDaily: number;
    totalDeals: number;
}

/**
 * Aggregates KPI metrics from prepared client rows.
 */
export function buildSuperAdminKpis(clients: SuperAdminClientRow[]): SuperAdminKpis {
    const kpis: SuperAdminKpis = {
        totalClients: clients.length,
        totalTeamMembers: 0,
        activeSubscriptions: 0,
        trialSubscriptions: 0,
        pastDueSubscriptions: 0,
        expiredOrCanceled: 0,
        withoutSubscription: 0,
        mrrCents: 0,
        potentialMrrCents: 0,
        totalSessions: 0,
        connectedSessions: 0,
        totalInstagramAccounts: 0,
        totalInstagramPostsPending: 0,
        totalBroadcastDaily: 0,
        totalDeals: 0,
    };

    for (const c of clients) {
        kpis.totalTeamMembers += c.usage.staff;
        kpis.totalSessions += c.usage.sessions;
        kpis.connectedSessions += c.usage.connectedSessions;
        kpis.totalInstagramAccounts += c.usage.instagramAccounts;
        kpis.totalInstagramPostsPending += c.usage.instagramPostsPending;
        kpis.totalBroadcastDaily += c.usage.broadcastDaily;
        kpis.totalDeals += c.usage.deals;

        const st = c.subscription?.effectiveStatus || "NONE";
        const price = c.subscription?.priceCents || 0;

        if (st === "ACTIVE") {
            kpis.activeSubscriptions += 1;
            kpis.mrrCents += price;
            kpis.potentialMrrCents += price;
        } else if (st === "TRIAL") {
            kpis.trialSubscriptions += 1;
            kpis.potentialMrrCents += price;
        } else if (st === "PAST_DUE") {
            kpis.pastDueSubscriptions += 1;
            kpis.potentialMrrCents += price;
        } else if (st === "EXPIRED" || st === "CANCELED") {
            kpis.expiredOrCanceled += 1;
        } else {
            kpis.withoutSubscription += 1;
        }
    }

    return kpis;
}

/**
 * Computes new trialEndsAt and currentPeriodEnd when a SuperAdmin updates a client's subscription.
 */
export function computeSubscriptionUpdateDates(params: {
    status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";
    extendDays?: number;
    currentPeriodEnd?: string | null;
    trialEndsAt?: string | null;
    existingPeriodEnd?: Date | null;
    existingTrialEndsAt?: Date | null;
    now?: Date;
}): { trialEndsAt: Date | null; currentPeriodEnd: Date | null } {
    const now = params.now || new Date();

    if (params.currentPeriodEnd !== undefined || params.trialEndsAt !== undefined) {
        const parsedPeriod = params.currentPeriodEnd ? new Date(params.currentPeriodEnd) : null;
        const parsedTrial = params.trialEndsAt ? new Date(params.trialEndsAt) : null;
        return {
            currentPeriodEnd: parsedPeriod,
            trialEndsAt: params.status === "TRIAL" ? parsedTrial || parsedPeriod : parsedTrial,
        };
    }

    if (typeof params.extendDays === "number" && params.extendDays > 0) {
        const ms = params.extendDays * 24 * 60 * 60 * 1000;
        const basePeriod =
            params.existingPeriodEnd && params.existingPeriodEnd > now ? params.existingPeriodEnd : now;
        const newPeriod = new Date(basePeriod.getTime() + ms);

        if (params.status === "TRIAL") {
            const baseTrial =
                params.existingTrialEndsAt && params.existingTrialEndsAt > now ? params.existingTrialEndsAt : now;
            const newTrial = new Date(baseTrial.getTime() + ms);
            return { trialEndsAt: newTrial, currentPeriodEnd: newTrial };
        }
        return { trialEndsAt: null, currentPeriodEnd: newPeriod };
    }

    if (params.status === "ACTIVE") {
        return {
            trialEndsAt: null,
            currentPeriodEnd:
                params.existingPeriodEnd && params.existingPeriodEnd > now
                    ? params.existingPeriodEnd
                    : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        };
    }

    if (params.status === "TRIAL") {
        const fallbackTrial =
            params.existingTrialEndsAt && params.existingTrialEndsAt > now
                ? params.existingTrialEndsAt
                : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        return {
            trialEndsAt: fallbackTrial,
            currentPeriodEnd: fallbackTrial,
        };
    }

    return {
        trialEndsAt: params.existingTrialEndsAt ?? null,
        currentPeriodEnd: params.existingPeriodEnd ?? null,
    };
}

/**
 * Fetches full SaaS overview data (clients, subscriptions, plans and usage metrics)
 * using batched queries to avoid N+1 database calls.
 */
export async function getSuperAdminOverviewData() {
    await ensureDefaultPlans();

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const [
        allPlans,
        owners,
        staffUsers,
        allSessions,
        allInstagramAccounts,
        instagramPostGroups,
        dealsPerSession,
        broadcastsTodayPerSession,
        instagramRequestsRaw,
    ] = await Promise.all([
        prisma.plan.findMany({ orderBy: { priceCents: "asc" } }),
        prisma.user.findMany({
            where: { role: "OWNER" },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                createdAt: true,
                subscription: {
                    include: { plan: true },
                },
            },
        }),
        prisma.user.findMany({
            where: { role: "STAFF", ownerId: { not: null } },
            select: {
                id: true,
                name: true,
                email: true,
                ownerId: true,
                createdAt: true,
            },
        }),
        prisma.session.findMany({
            select: {
                id: true,
                userId: true,
                name: true,
                sessionId: true,
                status: true,
            },
        }),
        prisma.instagramAccount.findMany({
            select: {
                id: true,
                userId: true,
                username: true,
                accountType: true,
            },
        }),
        prisma.instagramPost.groupBy({
            by: ["userId", "status"],
            _count: { _all: true },
        }),
        prisma.deal.groupBy({
            by: ["sessionId"],
            _count: { _all: true },
        }),
        prisma.scheduledMessage.groupBy({
            by: ["sessionId"],
            where: { createdAt: { gte: startOfDay } },
            _count: { _all: true },
        }),
        prisma.instagramAccessRequest.findMany({
            orderBy: { createdAt: "desc" },
            include: {
                user: { select: { name: true, email: true } },
            },
        }),
    ]);

    const staffByOwner = new Map<string, ClientTeamMemberSummary[]>();
    for (const s of staffUsers) {
        if (!s.ownerId) continue;
        const list = staffByOwner.get(s.ownerId) || [];
        list.push({
            id: s.id,
            name: s.name,
            email: s.email,
            createdAt: s.createdAt.toISOString(),
        });
        staffByOwner.set(s.ownerId, list);
    }

    const sessionsByOwner = new Map<string, ClientSessionSummary[]>();
    const sessionIdToOwner = new Map<string, string>();
    const sessionCuidToOwner = new Map<string, string>();
    for (const sess of allSessions) {
        const list = sessionsByOwner.get(sess.userId) || [];
        list.push({
            id: sess.id,
            name: sess.name,
            sessionId: sess.sessionId,
            status: sess.status,
        });
        sessionsByOwner.set(sess.userId, list);
        sessionIdToOwner.set(sess.sessionId, sess.userId);
        sessionCuidToOwner.set(sess.id, sess.userId);
    }

    const igAccountsByOwner = new Map<string, ClientInstagramSummary[]>();
    for (const acc of allInstagramAccounts) {
        const list = igAccountsByOwner.get(acc.userId) || [];
        list.push({
            id: acc.id,
            username: acc.username,
            accountType: acc.accountType,
        });
        igAccountsByOwner.set(acc.userId, list);
    }

    const igPostsByOwner = new Map<string, { pending: number; published: number }>();
    for (const row of instagramPostGroups) {
        const cur = igPostsByOwner.get(row.userId) || { pending: 0, published: 0 };
        if (row.status === "PENDING" || row.status === "PUBLISHING") {
            cur.pending += row._count._all;
        } else if (row.status === "PUBLISHED") {
            cur.published += row._count._all;
        }
        igPostsByOwner.set(row.userId, cur);
    }

    const dealsByOwner = new Map<string, number>();
    for (const row of dealsPerSession) {
        const ownerId = sessionCuidToOwner.get(row.sessionId) || sessionIdToOwner.get(row.sessionId);
        if (!ownerId) continue;
        dealsByOwner.set(ownerId, (dealsByOwner.get(ownerId) || 0) + row._count._all);
    }

    const broadcastsByOwner = new Map<string, number>();
    for (const row of broadcastsTodayPerSession) {
        const ownerId = sessionIdToOwner.get(row.sessionId) || sessionCuidToOwner.get(row.sessionId);
        if (!ownerId) continue;
        broadcastsByOwner.set(ownerId, (broadcastsByOwner.get(ownerId) || 0) + row._count._all);
    }

    const planSubscriberCounts = new Map<string, { total: number; active: number; mrrCents: number }>();

    const clients: SuperAdminClientRow[] = owners.map((owner) => {
        const ownerSessions = sessionsByOwner.get(owner.id) || [];
        const ownerStaff = staffByOwner.get(owner.id) || [];
        const ownerIg = igAccountsByOwner.get(owner.id) || [];
        const igStats = igPostsByOwner.get(owner.id) || { pending: 0, published: 0 };
        const sub = owner.subscription;

        let formattedSub: SuperAdminClientRow["subscription"] = null;
        let limits: SuperAdminClientRow["limits"] = {
            maxSessions: 0,
            maxUsers: 1,
            maxBroadcastDaily: 0,
            hasAiStudio: false,
            hasCrm: false,
        };

        if (sub) {
            const { effectiveStatus, trialDaysLeft } = computeEffectiveSubscriptionStatus(sub, now);
            formattedSub = {
                id: sub.id,
                planId: sub.planId,
                planName: sub.plan.name,
                planSlug: sub.plan.slug,
                priceCents: sub.plan.priceCents,
                status: sub.status,
                effectiveStatus: effectiveStatus as SubscriptionStatusValue,
                trialDaysLeft,
                trialEndsAt: sub.trialEndsAt ? sub.trialEndsAt.toISOString() : null,
                currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
                externalRef: sub.externalRef,
            };
            limits = {
                maxSessions: sub.plan.maxSessions,
                maxUsers: sub.plan.maxUsers,
                maxBroadcastDaily: sub.plan.maxBroadcastDaily,
                hasAiStudio: sub.plan.hasAiStudio,
                hasCrm: sub.plan.hasCrm,
            };

            const planStats = planSubscriberCounts.get(sub.planId) || { total: 0, active: 0, mrrCents: 0 };
            planStats.total += 1;
            if (effectiveStatus === "ACTIVE") {
                planStats.active += 1;
                planStats.mrrCents += sub.plan.priceCents;
            }
            planSubscriberCounts.set(sub.planId, planStats);
        }

        return {
            id: owner.id,
            name: owner.name,
            email: owner.email,
            role: owner.role,
            createdAt: owner.createdAt.toISOString(),
            subscription: formattedSub,
            limits,
            usage: {
                sessions: ownerSessions.length,
                connectedSessions: ownerSessions.filter((s) => s.status === "CONNECTED").length,
                users: 1 + ownerStaff.length,
                staff: ownerStaff.length,
                broadcastDaily: broadcastsByOwner.get(owner.id) || 0,
                deals: dealsByOwner.get(owner.id) || 0,
                instagramAccounts: ownerIg.length,
                instagramPostsPending: igStats.pending,
                instagramPostsPublished: igStats.published,
            },
            details: {
                sessions: ownerSessions,
                teamMembers: ownerStaff,
                instagramAccounts: ownerIg,
            },
        };
    });

    const plans: SuperAdminPlanSummary[] = allPlans.map((p) => {
        const stats = planSubscriberCounts.get(p.id) || { total: 0, active: 0, mrrCents: 0 };
        return {
            id: p.id,
            slug: p.slug,
            name: p.name,
            description: p.description,
            priceCents: p.priceCents,
            maxSessions: p.maxSessions,
            maxUsers: p.maxUsers,
            maxBroadcastDaily: p.maxBroadcastDaily,
            hasAiStudio: p.hasAiStudio,
            hasCrm: p.hasCrm,
            isActive: p.isActive,
            subscribersCount: stats.total,
            activeSubscribersCount: stats.active,
            mrrCents: stats.mrrCents,
        };
    });

    const kpis = buildSuperAdminKpis(clients);

    const instagramRequests: SuperAdminInstagramRequestItem[] = instagramRequestsRaw.map((req) => ({
        id: req.id,
        userId: req.userId,
        userName: req.user.name,
        userEmail: req.user.email,
        igUsername: req.igUsername,
        status: req.status,
        adminNote: req.adminNote,
        approvedAt: req.approvedAt ? req.approvedAt.toISOString() : null,
        completedAt: req.completedAt ? req.completedAt.toISOString() : null,
        createdAt: req.createdAt.toISOString(),
        updatedAt: req.updatedAt.toISOString(),
    }));

    return { kpis, plans, clients, instagramRequests };
}
