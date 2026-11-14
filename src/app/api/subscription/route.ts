import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { ensureDefaultPlans, getUserSubscriptionWithLimits } from "@/lib/subscription";

export const dynamic = "force-dynamic";

const updateSubscriptionSchema = z.object({
    planId: z.string().optional(),
    planSlug: z.string().optional(),
    action: z.enum(["change", "activate", "renew"]).default("change"),
});

export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Não autorizado", error: "Unauthorized" }, { status: 401 });
        }

        const data = await getUserSubscriptionWithLimits(user.id);
        return NextResponse.json({
            status: true,
            message: "Assinatura carregada com sucesso",
            data,
        });
    } catch (error) {
        console.error("Get subscription error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao carregar assinatura", error: "Erro ao carregar assinatura" },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Não autorizado", error: "Unauthorized" }, { status: 401 });
        }

        if (user.role === "STAFF") {
            return NextResponse.json(
                {
                    status: false,
                    message: "Apenas o proprietário da conta pode alterar ou renovar o plano.",
                    error: "Forbidden",
                },
                { status: 403 }
            );
        }

        const body = await request.json();
        const parsed = updateSubscriptionSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { status: false, message: "Dados inválidos", error: parsed.error.flatten() },
                { status: 400 }
            );
        }

        await ensureDefaultPlans();

        const { planId, planSlug } = parsed.data;
        let targetPlan = null;

        if (planId) {
            targetPlan = await prisma.plan.findFirst({ where: { id: planId, isActive: true } });
        } else if (planSlug) {
            targetPlan = await prisma.plan.findFirst({ where: { slug: planSlug.toLowerCase(), isActive: true } });
        } else {
            const current = await getUserSubscriptionWithLimits(user.id);
            targetPlan = current.plan;
        }

        if (!targetPlan) {
            return NextResponse.json(
                { status: false, message: "Plano não encontrado ou inativo.", error: "Plan not found" },
                { status: 404 }
            );
        }

        const nextPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await prisma.subscription.upsert({
            where: { userId: user.id },
            update: {
                planId: targetPlan.id,
                status: "ACTIVE",
                trialEndsAt: null,
                currentPeriodEnd: nextPeriodEnd,
            },
            create: {
                userId: user.id,
                planId: targetPlan.id,
                status: "ACTIVE",
                trialEndsAt: null,
                currentPeriodEnd: nextPeriodEnd,
            },
        });

        const updated = await getUserSubscriptionWithLimits(user.id);

        return NextResponse.json({
            status: true,
            message: `Plano ${targetPlan.name} ativado com sucesso!`,
            data: updated,
        });
    } catch (error) {
        console.error("Update subscription error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao atualizar assinatura", error: "Erro ao atualizar assinatura" },
            { status: 500 }
        );
    }
}
