import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, hasRole, isAdmin } from "@/lib/api-auth";
import { attachPreviewUrls, publishScheduledPostById } from "@/modules/instagram/scheduler";
import { validateInstagramPostInput } from "@/modules/instagram/validation";

export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!hasRole(user.role, "OWNER")) {
        return NextResponse.json({ status: false, error: "Permissão insuficiente." }, { status: 403 });
    }

    const statusParam = request.nextUrl.searchParams.get("status");
    const accountIdParam = request.nextUrl.searchParams.get("accountId");

    const where: Record<string, any> = {};
    if (!isAdmin(user.role)) {
        where.userId = user.id;
    }
    if (statusParam && statusParam !== "ALL") {
        where.status = statusParam;
    }
    if (accountIdParam && accountIdParam !== "ALL") {
        where.accountId = accountIdParam;
    }

    const posts = await prisma.instagramPost.findMany({
        where,
        orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
        take: 100,
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

    const formatted = posts.map((post) => ({
        ...post,
        mediaItems: attachPreviewUrls(post.mediaItems),
    }));

    return NextResponse.json({ status: true, data: formatted });
}

export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!hasRole(user.role, "OWNER")) {
        return NextResponse.json({ status: false, error: "Permissão insuficiente." }, { status: 403 });
    }

    try {
        const body = await request.json();
        const validation = validateInstagramPostInput(body);
        if (!validation.ok) {
            return NextResponse.json({ status: false, error: validation.error }, { status: 400 });
        }

        const data = validation.data;
        const account = await prisma.instagramAccount.findUnique({ where: { id: data.accountId } });
        if (!account) {
            return NextResponse.json({ status: false, error: "Conta do Instagram não encontrada." }, { status: 404 });
        }
        if (!isAdmin(user.role) && account.userId !== user.id) {
            return NextResponse.json({ status: false, error: "Acesso negado à conta selecionada." }, { status: 403 });
        }

        const sanitizedItems = data.mediaItems.map((item) => ({
            ...(item.filename ? { filename: item.filename } : {}),
            ...(item.url && !item.filename ? { url: item.url } : {}),
            mediaType: item.mediaType,
            ...(item.mimeType ? { mimeType: item.mimeType } : {}),
        }));

        const created = await prisma.instagramPost.create({
            data: {
                userId: account.userId,
                accountId: account.id,
                type: data.type,
                caption: data.caption || null,
                mediaItems: sanitizedItems,
                shareToFeed: data.shareToFeed ?? true,
                scheduledAt: data.scheduledAtDate,
                status: "PENDING",
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

        if (data.publishNow) {
            const published = await publishScheduledPostById(created.id);
            const resultPost = published || created;
            return NextResponse.json({
                status: resultPost.status === "PUBLISHED",
                data: {
                    ...resultPost,
                    mediaItems: attachPreviewUrls(resultPost.mediaItems),
                },
                error: resultPost.status === "FAILED" ? resultPost.errorMessage : undefined,
            });
        }

        return NextResponse.json({
            status: true,
            data: {
                ...created,
                mediaItems: attachPreviewUrls(created.mediaItems),
            },
        });
    } catch (err: any) {
        return NextResponse.json(
            { status: false, error: err?.message || "Erro ao criar agendamento do Instagram." },
            { status: 500 }
        );
    }
}
