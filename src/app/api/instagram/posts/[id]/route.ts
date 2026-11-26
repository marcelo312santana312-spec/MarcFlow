import { NextRequest, NextResponse } from "next/server";
import { unlink } from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, hasRole, isAdmin } from "@/lib/api-auth";
import { attachPreviewUrls, INSTAGRAM_MEDIA_DIR } from "@/modules/instagram/scheduler";
import { InstagramMediaItem, validateInstagramPostInput } from "@/modules/instagram/validation";

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!hasRole(user.role, "OWNER")) {
        return NextResponse.json({ status: false, error: "Permissão insuficiente." }, { status: 403 });
    }

    const { id } = await params;
    const existing = await prisma.instagramPost.findUnique({ where: { id } });
    if (!existing) {
        return NextResponse.json({ status: false, error: "Agendamento não encontrado." }, { status: 404 });
    }
    if (!isAdmin(user.role) && existing.userId !== user.id) {
        return NextResponse.json({ status: false, error: "Acesso negado." }, { status: 403 });
    }
    if (existing.status !== "PENDING" && existing.status !== "FAILED") {
        return NextResponse.json(
            { status: false, error: "Apenas agendamentos pendentes ou com erro podem ser editados." },
            { status: 400 }
        );
    }

    try {
        const body = await request.json();
        const merged = {
            accountId: body.accountId ?? existing.accountId,
            type: body.type ?? existing.type,
            caption: body.caption !== undefined ? body.caption : existing.caption,
            mediaItems: body.mediaItems ?? existing.mediaItems,
            shareToFeed: body.shareToFeed !== undefined ? body.shareToFeed : existing.shareToFeed,
            scheduledAt: body.scheduledAt ?? existing.scheduledAt,
            publishNow: false,
        };

        const validation = validateInstagramPostInput(merged);
        if (!validation.ok) {
            return NextResponse.json({ status: false, error: validation.error }, { status: 400 });
        }

        const v = validation.data;
        const sanitizedItems = v.mediaItems.map((item) => ({
            ...(item.filename ? { filename: item.filename } : {}),
            ...(item.url && !item.filename ? { url: item.url } : {}),
            mediaType: item.mediaType,
            ...(item.mimeType ? { mimeType: item.mimeType } : {}),
        }));

        const updated = await prisma.instagramPost.update({
            where: { id },
            data: {
                accountId: v.accountId,
                type: v.type,
                caption: v.caption || null,
                mediaItems: sanitizedItems,
                shareToFeed: v.shareToFeed ?? true,
                scheduledAt: v.scheduledAtDate,
                status: "PENDING",
                errorMessage: null,
            },
            include: {
                account: {
                    select: {
                        id: true,
                        username: true,
                        name: true,
                        profilePictureUrl: true,
                        status: true,
                    },
                },
            },
        });

        return NextResponse.json({
            status: true,
            data: {
                ...updated,
                mediaItems: attachPreviewUrls(updated.mediaItems),
            },
        });
    } catch (err: any) {
        return NextResponse.json(
            { status: false, error: err?.message || "Erro ao atualizar agendamento." },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!hasRole(user.role, "OWNER")) {
        return NextResponse.json({ status: false, error: "Permissão insuficiente." }, { status: 403 });
    }

    const { id } = await params;
    const existing = await prisma.instagramPost.findUnique({ where: { id } });
    if (!existing) {
        return NextResponse.json({ status: false, error: "Agendamento não encontrado." }, { status: 404 });
    }
    if (!isAdmin(user.role) && existing.userId !== user.id) {
        return NextResponse.json({ status: false, error: "Acesso negado." }, { status: 403 });
    }

    await prisma.instagramPost.delete({ where: { id } });

    // Remove local media files only if not referenced by any remaining post
    const items = Array.isArray(existing.mediaItems)
        ? (existing.mediaItems as unknown as InstagramMediaItem[])
        : [];
    const filenames = items
        .map((i) => i.filename)
        .filter((f): f is string => Boolean(f) && !f!.includes("..") && !f!.includes("/") && !f!.includes("\\"));

    if (filenames.length > 0) {
        const remaining = await prisma.instagramPost.findMany({
            where: { userId: existing.userId },
            select: { mediaItems: true },
        });
        const referenced = new Set<string>();
        for (const p of remaining) {
            if (Array.isArray(p.mediaItems)) {
                for (const m of p.mediaItems as unknown as InstagramMediaItem[]) {
                    if (m?.filename) referenced.add(m.filename);
                }
            }
        }
        for (const fname of filenames) {
            if (!referenced.has(fname)) {
                const filePath = path.join(INSTAGRAM_MEDIA_DIR, fname);
                if (existsSync(filePath)) {
                    await unlink(filePath).catch(() => {});
                }
            }
        }
    }

    return NextResponse.json({ status: true, message: "Agendamento removido." });
}
