import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeEffectiveSubscriptionStatus } from "../subscription";
import {
    buildSuperAdminKpis,
    computeSubscriptionUpdateDates,
    SuperAdminClientRow,
} from "../admin-overview";

describe("SuperAdmin Overview & Subscription Helpers", () => {
    it("marks expired trials as EXPIRED and overdue active plans as PAST_DUE", () => {
        const now = new Date("2026-11-26T12:00:00Z");

        const expiredTrial = computeEffectiveSubscriptionStatus(
            { status: "TRIAL", trialEndsAt: new Date("2026-11-25T00:00:00Z"), currentPeriodEnd: null },
            now
        );
        assert.equal(expiredTrial.effectiveStatus, "EXPIRED");
        assert.equal(expiredTrial.shouldMarkExpired, true);
        assert.equal(expiredTrial.trialDaysLeft, 0);

        const activeTrial = computeEffectiveSubscriptionStatus(
            { status: "TRIAL", trialEndsAt: new Date("2026-11-29T12:00:00Z"), currentPeriodEnd: null },
            now
        );
        assert.equal(activeTrial.effectiveStatus, "TRIAL");
        assert.equal(activeTrial.shouldMarkExpired, false);
        assert.equal(activeTrial.trialDaysLeft, 3);

        const pastDue = computeEffectiveSubscriptionStatus(
            { status: "ACTIVE", trialEndsAt: null, currentPeriodEnd: new Date("2026-11-20T00:00:00Z") },
            now
        );
        assert.equal(pastDue.effectiveStatus, "PAST_DUE");
        assert.equal(pastDue.shouldMarkExpired, false);
    });

    it("computes MRR, potential MRR, and usage totals across clients", () => {
        const baseClient = (overrides: Partial<SuperAdminClientRow>): SuperAdminClientRow => ({
            id: "u1",
            name: "Cliente",
            email: "c@example.com",
            role: "OWNER",
            createdAt: "2026-11-01T00:00:00Z",
            subscription: null,
            limits: { maxSessions: 3, maxUsers: 5, maxBroadcastDaily: 1000, hasAiStudio: true, hasCrm: true },
            usage: {
                sessions: 1,
                connectedSessions: 1,
                users: 2,
                staff: 1,
                broadcastDaily: 50,
                deals: 10,
                instagramAccounts: 1,
                instagramPostsPending: 2,
                instagramPostsPublished: 4,
            },
            details: { sessions: [], teamMembers: [], instagramAccounts: [] },
            ...overrides,
        });

        const clients: SuperAdminClientRow[] = [
            baseClient({
                id: "c1",
                subscription: {
                    id: "s1",
                    planId: "p-pro",
                    planName: "Pro",
                    planSlug: "pro",
                    priceCents: 19700,
                    status: "ACTIVE",
                    effectiveStatus: "ACTIVE",
                    trialDaysLeft: 0,
                    trialEndsAt: null,
                    currentPeriodEnd: "2026-12-20T00:00:00Z",
                    externalRef: null,
                },
            }),
            baseClient({
                id: "c2",
                subscription: {
                    id: "s2",
                    planId: "p-ent",
                    planName: "Enterprise",
                    planSlug: "enterprise",
                    priceCents: 39700,
                    status: "TRIAL",
                    effectiveStatus: "TRIAL",
                    trialDaysLeft: 5,
                    trialEndsAt: "2026-12-01T00:00:00Z",
                    currentPeriodEnd: null,
                    externalRef: null,
                },
            }),
            baseClient({
                id: "c3",
                subscription: null,
            }),
        ];

        const kpis = buildSuperAdminKpis(clients);
        assert.equal(kpis.totalClients, 3);
        assert.equal(kpis.totalTeamMembers, 3);
        assert.equal(kpis.activeSubscriptions, 1);
        assert.equal(kpis.trialSubscriptions, 1);
        assert.equal(kpis.withoutSubscription, 1);
        assert.equal(kpis.mrrCents, 19700);
        assert.equal(kpis.potentialMrrCents, 19700 + 39700);
        assert.equal(kpis.connectedSessions, 3);
        assert.equal(kpis.totalInstagramPostsPending, 6);
    });

    it("extends expiration date from existing future period or now", () => {
        const now = new Date("2026-11-26T00:00:00Z");
        const future = new Date("2026-12-06T00:00:00Z");

        const extended = computeSubscriptionUpdateDates({
            status: "ACTIVE",
            extendDays: 30,
            existingPeriodEnd: future,
            now,
        });
        assert.equal(extended.trialEndsAt, null);
        assert.equal(extended.currentPeriodEnd?.toISOString().slice(0, 10), "2027-01-05");

        const freshTrial = computeSubscriptionUpdateDates({
            status: "TRIAL",
            extendDays: 7,
            existingTrialEndsAt: null,
            now,
        });
        assert.equal(freshTrial.trialEndsAt?.toISOString().slice(0, 10), "2026-12-03");
    });
});
