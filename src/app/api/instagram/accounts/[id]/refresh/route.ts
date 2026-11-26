import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, hasRole, isAdmin } from "@/lib/api-auth";
import { decryptToken, encryptToken } from "@/modules/instagram/crypto";
import { refreshLongLivedToken } from "@/modules/instagram/client";

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
    const account = await prisma.instagramAccount.findUnique({ where: { id } });
    if (!account) {
        return NextResponse.json({ status: false, error: "Conta não encontrada." }, { status: 404 });
    }
    if (!isAdmin(user.role) && account.userId !== user.id) {
        return NextResponse.json({ status: false, error: "Acesso negado." }, { status: 403 });
    }

    try {
        const plainToken = decryptToken(account.accessToken);
        const refreshed = await refreshLongLivedToken(plainToken);
        const tokenExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);

        const updated = await prisma.instagramAccount.update({
            where: { id },
            data: {
                accessToken: encryptToken(refreshed.accessToken),
                tokenExpiresAt,
                status: "CONNECTED",
                lastError: null,
            },
            select: {
                id: true,
                username: true,
                tokenExpiresAt: true,
                status: true,
            },
        });

        return NextResponse.json({ status: true, data: updated });
    } catch (err: any) {
        await prisma.instagramAccount
            .update({
                where: { id },
                data: { status: "EXPIRED", lastError: err?.message || "Erro ao renovar token." },
            })
            .catch(() => {});

        return NextResponse.json(
            { status: false, error: err?.message || "Falha ao renovar token do Instagram." },
            { status: 400 }
        );
    }
}
