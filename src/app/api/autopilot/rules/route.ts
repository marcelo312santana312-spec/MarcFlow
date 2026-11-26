import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, hasRole, isAdmin } from "@/lib/api-auth";
import { normalizeDaysOfWeek, normalizeScheduleTimes, runAutoPostRule } from "@/modules/autopilot/scheduler";

export const dynamic = "force-dynamic";

const createRuleSchema = z.object({
    libraryId: z.string().min(1),
    name: z.string().min(2).max(120),
    isActive: z.boolean().default(true),
    whatsappSessionId: z.string().optional().nullable(),
    postWhatsappStatus: z.boolean().default(false),
    whatsappGroupJids: z.array(z.string()).default([]),
    instagramAccountIds: z.array(z.string()).default([]),
    instagramPostTypes: z.array(z.enum(["STORY", "FEED", "REELS"])).default(["STORY", "FEED", "REELS"]),
    scheduleTimes: z.array(z.string()).min(1).default(["09:00", "12:30", "18:30"]),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).default([0, 1, 2, 3, 4, 5, 6]),
    maxPostsPerDay: z.number().int().min(1).max(20).default(3),
    recycleOld: z.boolean().default(true),
    convertAffiliateLinks: z.boolean().default(true),
    resellerLink: z.string().max(500).optional().nullable(),
    resellerWhatsapp: z.string().max(80).optional().nullable(),
    resellerCoupon: z.string().max(40).optional().nullable(),
    captionTemplate: z.string().max(2200).optional().nullable(),
    runNow: z.boolean().default(false),
});

export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!hasRole(user.role, "OWNER")) {
        return NextResponse.json({ status: false, error: "Permissão insuficiente." }, { status: 403 });
    }

    const rules = await prisma.autoPostRule.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        include: {
            library: {
                select: {
                    id: true,
                    name: true,
                    sourceType: true,
                    shareCode: true,
                    isShared: true,
                    _count: { select: { items: true } },
                },
            },
            dispatches: {
                orderBy: { createdAt: "desc" },
                take: 15,
                include: {
                    item: { select: { id: true, title: true, mediaType: true, filename: true } },
                },
            },
        },
    });

    return NextResponse.json({ status: true, data: rules });
}

export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!hasRole(user.role, "OWNER")) {
        return NextResponse.json({ status: false, error: "Permissão insuficiente." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = createRuleSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { status: false, error: "Dados inválidos para a regra automática.", details: parsed.error.flatten() },
            { status: 400 }
        );
    }

    const data = parsed.data;
    const library = await prisma.contentLibrary.findUnique({ where: { id: data.libraryId } });
    if (!library) {
        return NextResponse.json({ status: false, error: "Biblioteca não encontrada." }, { status: 404 });
    }

    const canAccessLibrary = library.userId === user.id || library.isShared || isAdmin(user.role);
    if (!canAccessLibrary) {
        return NextResponse.json(
            { status: false, error: "Você não tem acesso a esta biblioteca." },
            { status: 403 }
        );
    }

    const hasWaDestination = Boolean(data.whatsappSessionId && (data.postWhatsappStatus || data.whatsappGroupJids.length > 0));
    const hasIgDestination = Boolean(data.instagramAccountIds.length > 0 && data.instagramPostTypes.length > 0);
    if (!hasWaDestination && !hasIgDestination) {
        return NextResponse.json(
            { status: false, error: "Escolha pelo menos um destino (Status/Grupos do WhatsApp ou conta do Instagram)." },
            { status: 400 }
        );
    }

    const created = await prisma.autoPostRule.create({
        data: {
            userId: user.id,
            libraryId: library.id,
            name: data.name.trim(),
            isActive: data.isActive,
            whatsappSessionId: data.whatsappSessionId || null,
            postWhatsappStatus: data.postWhatsappStatus,
            whatsappGroupJids: data.whatsappGroupJids,
            instagramAccountIds: data.instagramAccountIds,
            instagramPostTypes: data.instagramPostTypes,
            scheduleTimes: normalizeScheduleTimes(data.scheduleTimes),
            daysOfWeek: normalizeDaysOfWeek(data.daysOfWeek),
            maxPostsPerDay: data.maxPostsPerDay,
            recycleOld: data.recycleOld,
            convertAffiliateLinks: data.convertAffiliateLinks,
            resellerLink: data.resellerLink?.trim() || null,
            resellerWhatsapp: data.resellerWhatsapp?.trim() || null,
            resellerCoupon: data.resellerCoupon?.trim().toUpperCase() || null,
            captionTemplate: data.captionTemplate?.trim() || null,
        },
    });

    let runResult: { scheduledDispatches: number; slotsFilled: number } | null = null;
    if (data.runNow && data.isActive) {
        runResult = await runAutoPostRule(created.id).catch(() => null);
    }

    return NextResponse.json(
        {
            status: true,
            message: runResult
                ? `Automação criada e ${runResult.scheduledDispatches} postagem(ns) agendada(s)!`
                : "Automação de postagens criada com sucesso!",
            data: { rule: created, runResult },
        },
        { status: 201 }
    );
}
