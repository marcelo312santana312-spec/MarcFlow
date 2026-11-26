import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, hasRole, isAdmin } from "@/lib/api-auth";
import { attachPreviewUrls, publishScheduledPostById } from "@/modules/instagram/scheduler";

export async function POST(
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

    if (existing.status === "PUBLISHED") {
        return NextResponse.json({ status: false, error: "Esta publicação já foi enviada ao Instagram." }, { status: 400 });
    }

    const result = await publishScheduledPostById(id);
    if (!result) {
        return NextResponse.json({ status: false, error: "Publicação não encontrada." }, { status: 404 });
    }

    return NextResponse.json({
        status: result.status === "PUBLISHED",
        data: {
            ...result,
            mediaItems: attachPreviewUrls(result.mediaItems),
        },
        error: result.status === "FAILED" ? result.errorMessage || "Erro ao publicar." : undefined,
    });
}
