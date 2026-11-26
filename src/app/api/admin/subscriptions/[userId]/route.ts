import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { computeSubscriptionUpdateDates } from "@/lib/admin-overview";

export const dynamic = "force-dynamic";

const adminUpdateSubscriptionSchema = z.object({
    planId: z.string().min(1, "Selecione um plano"),
    status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"]),
    extendDays: z.number().int().min(1).max(3650).optional(),
    currentPeriodEnd: z.string().optional().nullable(),
    trialEndsAt: z.string().optional().nullable(),
    externalRef: z.string().max(191).optional().nullable(),
});

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ userId: string }> }
) {
    try {
        const admin = await getAuthenticatedUser(request);
        if (!admin) {
            return NextResponse.json(
                { status: false, message: "Não autorizado", error: "Unauthorized" },
                { status: 401 }
            );
        }

        if (!isAdmin(admin.role)) {
            return NextResponse.json(
                { status: false, message: "Apenas SuperAdmin pode alterar assinaturas de clientes.", error: "Forbidden" },
                { status: 403 }
            );
        }

        const { userId } = await context.params;
        const body = await request.json();
        const parsed = adminUpdateSubscriptionSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { status: false, message: "Dados de assinatura inválidos", error: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const [targetUser, targetPlan, existingSub] = await Promise.all([
            prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, email: true } }),
            prisma.plan.findUnique({ where: { id: parsed.data.planId } }),
            prisma.subscription.findUnique({ where: { userId } }),
        ]);

        if (!targetUser) {
            return NextResponse.json(
                { status: false, message: "Cliente não encontrado.", error: "User not found" },
                { status: 404 }
            );
        }

        if (!targetPlan) {
            return NextResponse.json(
                { status: false, message: "Plano não encontrado.", error: "Plan not found" },
                { status: 404 }
            );
        }

        const { trialEndsAt, currentPeriodEnd } = computeSubscriptionUpdateDates({
            status: parsed.data.status,
            extendDays: parsed.data.extendDays,
            currentPeriodEnd: parsed.data.currentPeriodEnd,
            trialEndsAt: parsed.data.trialEndsAt,
            existingPeriodEnd: existingSub?.currentPeriodEnd ?? null,
            existingTrialEndsAt: existingSub?.trialEndsAt ?? null,
        });

        const updated = await prisma.subscription.upsert({
            where: { userId },
            update: {
                planId: targetPlan.id,
                status: parsed.data.status,
                trialEndsAt,
                currentPeriodEnd,
                externalRef:
                    parsed.data.externalRef !== undefined
                        ? parsed.data.externalRef?.trim() || null
                        : existingSub?.externalRef ?? null,
            },
            create: {
                userId,
                planId: targetPlan.id,
                status: parsed.data.status,
                trialEndsAt,
                currentPeriodEnd,
                externalRef: parsed.data.externalRef?.trim() || null,
            },
            include: { plan: true },
        });

        return NextResponse.json({
            status: true,
            message: `Assinatura de ${targetUser.email} atualizada para ${targetPlan.name} (${parsed.data.status}).`,
            data: updated,
        });
    } catch (error) {
        console.error("Admin subscription update error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao atualizar assinatura", error: "Failed to update subscription" },
            { status: 500 }
        );
    }
}
