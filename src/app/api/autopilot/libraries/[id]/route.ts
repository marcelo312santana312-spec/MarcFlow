import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { extractGoogleDriveFolderId } from "@/modules/autopilot/drive";
import { AUTOPILOT_MEDIA_DIR, generateShareCode } from "@/modules/autopilot/scheduler";

const patchLibrarySchema = z.object({
    name: z.string().min(2).max(120).optional(),
    description: z.string().max(1000).optional().nullable(),
    driveFolderUrl: z.string().max(500).optional().nullable(),
    syncEnabled: z.boolean().optional(),
    syncHour: z.number().int().min(0).max(23).optional(),
    isShared: z.boolean().optional(),
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
    const existing = await prisma.contentLibrary.findUnique({ where: { id } });
    if (!existing) {
        return NextResponse.json({ status: false, error: "Biblioteca não encontrada." }, { status: 404 });
    }
    if (existing.userId !== user.id && !isAdmin(user.role)) {
        return NextResponse.json({ status: false, error: "Sem permissão." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = patchLibrarySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ status: false, error: "Dados inválidos." }, { status: 400 });
    }

    const d = parsed.data;
    let nextFolderId = existing.driveFolderId;
    if (d.driveFolderUrl !== undefined) {
        if (!d.driveFolderUrl) {
            nextFolderId = null;
        } else {
            const extracted = extractGoogleDriveFolderId(d.driveFolderUrl);
            if (!extracted) {
                return NextResponse.json({ status: false, error: "Link da pasta do Drive inválido." }, { status: 400 });
            }
            nextFolderId = extracted;
        }
    }

    const updated = await prisma.contentLibrary.update({
        where: { id },
        data: {
            name: d.name?.trim() ?? existing.name,
            description: d.description !== undefined ? d.description?.trim() || null : existing.description,
            driveFolderUrl: d.driveFolderUrl !== undefined ? d.driveFolderUrl?.trim() || null : existing.driveFolderUrl,
            driveFolderId: nextFolderId,
            syncEnabled: d.syncEnabled ?? existing.syncEnabled,
            syncHour: d.syncHour ?? existing.syncHour,
            isShared: d.isShared ?? existing.isShared,
            shareCode: existing.shareCode || generateShareCode(d.name || existing.name),
        },
    });

    return NextResponse.json({ status: true, message: "Biblioteca atualizada.", data: updated });
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
    const existing = await prisma.contentLibrary.findUnique({
        where: { id },
        include: { items: { select: { filename: true } } },
    });
    if (!existing) {
        return NextResponse.json({ status: false, error: "Biblioteca não encontrada." }, { status: 404 });
    }
    if (existing.userId !== user.id && !isAdmin(user.role)) {
        return NextResponse.json({ status: false, error: "Sem permissão." }, { status: 403 });
    }

    await prisma.contentLibrary.delete({ where: { id } });

    await Promise.all(
        existing.items.map((item) =>
            fs.unlink(path.join(AUTOPILOT_MEDIA_DIR, path.basename(item.filename))).catch(() => {})
        )
    );

    return NextResponse.json({ status: true, message: "Biblioteca excluída." });
}
