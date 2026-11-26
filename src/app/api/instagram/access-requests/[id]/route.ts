import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";

const patchRequestSchema = z.object({
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "COMPLETED"]),
    adminNote: z.string().max(500).optional().nullable(),
});

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const admin = await getAuthenticatedUser(request);
    if (!admin) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!isAdmin(admin.role)) {
        return NextResponse.json(
            { status: false, error: "Somente SuperAdmin pode liberar ou recusar solicitações." },
            { status: 403 }
        );
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const parsed = patchRequestSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { status: false, error: "Dados inválidos.", details: parsed.error.flatten() },
            { status: 400 }
        );
    }

    const existing = await prisma.instagramAccessRequest.findUnique({ where: { id } });
    if (!existing) {
        return NextResponse.json({ status: false, error: "Solicitação não encontrada." }, { status: 404 });
    }

    const nextStatus = parsed.data.status;
    const now = new Date();

    const updated = await prisma.instagramAccessRequest.update({
        where: { id },
        data: {
            status: nextStatus,
            adminNote: parsed.data.adminNote !== undefined ? parsed.data.adminNote?.trim() || null : existing.adminNote,
            approvedById: nextStatus === "APPROVED" ? admin.id : existing.approvedById,
            approvedAt: nextStatus === "APPROVED" ? now : nextStatus === "PENDING" ? null : existing.approvedAt,
            completedAt: nextStatus === "COMPLETED" ? now : existing.completedAt,
        },
        include: {
            user: { select: { id: true, name: true, email: true } },
        },
    });

    const io = (global as any).io;
    if (nextStatus === "APPROVED" || nextStatus === "REJECTED") {
        const isApproved = nextStatus === "APPROVED";
        const title = isApproved
            ? `Instagram @${updated.igUsername} liberado!`
            : `Solicitação @${updated.igUsername} recusada`;
        const message = isApproved
            ? `O administrador adicionou @${updated.igUsername}. Acesse a aba Instagram para aceitar o convite e concluir a conexão.`
            : updated.adminNote || `Sua solicitação para @${updated.igUsername} foi recusada. Verifique se a conta é Profissional.`;
        const href = "/dashboard/instagram";
        const type = isApproved ? "SUCCESS" : "WARNING";

        const notif = await prisma.notification.create({
            data: {
                userId: updated.userId,
                title,
                message,
                type,
                href,
            },
        });

        if (io) {
            io.to(`user:${updated.userId}`).emit("notification:new", {
                id: notif.id,
                userId: updated.userId,
                title,
                message,
                type,
                href,
                createdAt: notif.createdAt,
            });
        }
    }

    return NextResponse.json({
        status: true,
        message:
            nextStatus === "APPROVED"
                ? `@${updated.igUsername} liberado! O cliente já pode seguir os passos de conexão.`
                : "Solicitação atualizada.",
        data: updated,
    });
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
    const existing = await prisma.instagramAccessRequest.findUnique({ where: { id } });
    if (!existing) {
        return NextResponse.json({ status: false, error: "Solicitação não encontrada." }, { status: 404 });
    }

    if (existing.userId !== user.id && !isAdmin(user.role)) {
        return NextResponse.json({ status: false, error: "Sem permissão." }, { status: 403 });
    }

    await prisma.instagramAccessRequest.delete({ where: { id } });
    return NextResponse.json({ status: true, message: "Solicitação removida." });
}
