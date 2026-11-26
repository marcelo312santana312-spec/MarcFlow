import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { normalizeDaysOfWeek, normalizeScheduleTimes } from "@/modules/autopilot/scheduler";

const patchRuleSchema = z.object({
    name: z.string().min(2).max(120).optional(),
    isActive: z.boolean().optional(),
    whatsappSessionId: z.string().optional().nullable(),
    postWhatsappStatus: z.boolean().optional(),
    whatsappGroupJids: z.array(z.string()).optional(),
    instagramAccountIds: z.array(z.string()).optional(),
    instagramPostTypes: z.array(z.enum(["STORY", "FEED", "REELS"])).optional(),
    scheduleTimes: z.array(z.string()).optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    maxPostsPerDay: z.number().int().min(1).max(20).optional(),
    recycleOld: z.boolean().optional(),
    convertAffiliateLinks: z.boolean().optional(),
    resellerLink: z.string().max(500).optional().nullable(),
    resellerWhatsapp: z.string().max(80).optional().nullable(),
    resellerCoupon: z.string().max(40).optional().nullable(),
    captionTemplate: z.string().max(2200).optional().nullable(),
});

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const existing = await prisma.autoPostRule.findUnique({ where: { id } });
    if (!existing) {
        return NextResponse.json({ status: false, error: "Regra não encontrada." }, { status: 404 });
    }
    if (existing.userId !== user.id && !isAdmin(user.role)) {
        return NextResponse.json({ status: false, error: "Sem permissão." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = patchRuleSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ status: false, error: "Dados inválidos." }, { status: 400 });
    }

    const d = parsed.data;
    const updated = await prisma.autoPostRule.update({
        where: { id },
        data: {
            name: d.name?.trim() ?? existing.name,
            isActive: d.isActive ?? existing.isActive,
            whatsappSessionId: d.whatsappSessionId !== undefined ? d.whatsappSessionId : existing.whatsappSessionId,
            postWhatsappStatus: d.postWhatsappStatus ?? existing.postWhatsappStatus,
            whatsappGroupJids: d.whatsappGroupJids ?? (existing.whatsappGroupJids as any),
            instagramAccountIds: d.instagramAccountIds ?? (existing.instagramAccountIds as any),
            instagramPostTypes: d.instagramPostTypes ?? (existing.instagramPostTypes as any),
            scheduleTimes: d.scheduleTimes ? normalizeScheduleTimes(d.scheduleTimes) : (existing.scheduleTimes as any),
            daysOfWeek: d.daysOfWeek ? normalizeDaysOfWeek(d.daysOfWeek) : (existing.daysOfWeek as any),
            maxPostsPerDay: d.maxPostsPerDay ?? existing.maxPostsPerDay,
            recycleOld: d.recycleOld ?? existing.recycleOld,
            convertAffiliateLinks: d.convertAffiliateLinks ?? existing.convertAffiliateLinks,
            resellerLink: d.resellerLink !== undefined ? d.resellerLink?.trim() || null : existing.resellerLink,
            resellerWhatsapp: d.resellerWhatsapp !== undefined ? d.resellerWhatsapp?.trim() || null : existing.resellerWhatsapp,
            resellerCoupon: d.resellerCoupon !== undefined ? d.resellerCoupon?.trim().toUpperCase() || null : existing.resellerCoupon,
            captionTemplate: d.captionTemplate !== undefined ? d.captionTemplate?.trim() || null : existing.captionTemplate,
        },
    });

    return NextResponse.json({ status: true, message: "Regra atualizada.", data: updated });
}

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const existing = await prisma.autoPostRule.findUnique({ where: { id } });
    if (!existing) {
        return NextResponse.json({ status: false, error: "Regra não encontrada." }, { status: 404 });
    }
    if (existing.userId !== user.id && !isAdmin(user.role)) {
        return NextResponse.json({ status: false, error: "Sem permissão." }, { status: 403 });
    }

    await prisma.autoPostRule.delete({ where: { id } });
    return NextResponse.json({ status: true, message: "Regra removida." });
}
