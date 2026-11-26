import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { syncLibraryFromDrive } from "@/modules/autopilot/scheduler";

export async function POST(
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

    try {
        const result = await syncLibraryFromDrive(id);
        return NextResponse.json({
            status: true,
            message: `Sincronização concluída: ${result.added} arquivo(s) novo(s), ${result.skipped} já existente(s).`,
            data: result,
        });
    } catch (err: any) {
        return NextResponse.json(
            {
                status: false,
                error: err?.message || "Falha ao sincronizar pasta do Google Drive.",
            },
            { status: 400 }
        );
    }
}
