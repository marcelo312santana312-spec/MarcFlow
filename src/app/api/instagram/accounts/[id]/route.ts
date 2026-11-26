import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, hasRole, isAdmin } from "@/lib/api-auth";

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
    const account = await prisma.instagramAccount.findUnique({ where: { id } });
    if (!account) {
        return NextResponse.json({ status: false, error: "Conta não encontrada." }, { status: 404 });
    }
    if (!isAdmin(user.role) && account.userId !== user.id) {
        return NextResponse.json({ status: false, error: "Acesso negado." }, { status: 403 });
    }

    await prisma.instagramAccount.delete({ where: { id } });
    return NextResponse.json({ status: true, message: "Conta desconectada com sucesso." });
}
