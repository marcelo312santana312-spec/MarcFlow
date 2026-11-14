import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { ensureDefaultPlans } from "@/lib/subscription";

export const dynamic = "force-dynamic";

const planSchema = z.object({
    slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/i, "Slug deve conter apenas letras, números e hífen"),
    name: z.string().min(2).max(100),
    description: z.string().max(500).optional().nullable(),
    priceCents: z.number().int().min(0),
    maxSessions: z.number().int().min(1),
    maxUsers: z.number().int().min(1),
    maxBroadcastDaily: z.number().int().min(0),
    hasAiStudio: z.boolean().default(false),
    hasCrm: z.boolean().default(true),
    isActive: z.boolean().default(true),
});

export async function GET(request: NextRequest) {
    try {
        await ensureDefaultPlans();

        const includeAll = request.nextUrl.searchParams.get("all") === "true";
        let showAll = false;

        if (includeAll) {
            const user = await getAuthenticatedUser(request);
            if (user && isAdmin(user.role)) {
                showAll = true;
            }
        }

        const plans = await prisma.plan.findMany({
            where: showAll ? undefined : { isActive: true },
            orderBy: { priceCents: "asc" },
        });

        return NextResponse.json({
            status: true,
            message: "Planos carregados com sucesso",
            data: plans,
        });
    } catch (error) {
        console.error("Get plans error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao carregar planos", error: "Erro ao carregar planos" },
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

        if (!isAdmin(user.role)) {
            return NextResponse.json(
                { status: false, message: "Apenas SUPERADMIN pode gerenciar planos", error: "Forbidden" },
                { status: 403 }
            );
        }

        const body = await request.json();
        const parsed = planSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { status: false, message: "Dados do plano inválidos", error: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const data = parsed.data;
        const normalizedSlug = data.slug.toLowerCase();

        const plan = await prisma.plan.upsert({
            where: { slug: normalizedSlug },
            update: {
                name: data.name,
                description: data.description ?? null,
                priceCents: data.priceCents,
                maxSessions: data.maxSessions,
                maxUsers: data.maxUsers,
                maxBroadcastDaily: data.maxBroadcastDaily,
                hasAiStudio: data.hasAiStudio,
                hasCrm: data.hasCrm,
                isActive: data.isActive,
            },
            create: {
                slug: normalizedSlug,
                name: data.name,
                description: data.description ?? null,
                priceCents: data.priceCents,
                maxSessions: data.maxSessions,
                maxUsers: data.maxUsers,
                maxBroadcastDaily: data.maxBroadcastDaily,
                hasAiStudio: data.hasAiStudio,
                hasCrm: data.hasCrm,
                isActive: data.isActive,
            },
        });

        return NextResponse.json({
            status: true,
            message: "Plano salvo com sucesso",
            data: plan,
        });
    } catch (error) {
        console.error("Save plan error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao salvar plano", error: "Erro ao salvar plano" },
            { status: 500 }
        );
    }
}
