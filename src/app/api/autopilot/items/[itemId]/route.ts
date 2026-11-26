import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { AUTOPILOT_MEDIA_DIR } from "@/modules/autopilot/scheduler";

export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ itemId: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }

    const { itemId } = await context.params;
    const item = await prisma.contentItem.findUnique({
        where: { id: itemId },
        include: { library: { select: { userId: true } } },
    });
    if (!item) {
        return NextResponse.json({ status: false, error: "Item não encontrado." }, { status: 404 });
    }
    if (item.library.userId !== user.id && !isAdmin(user.role)) {
        return NextResponse.json({ status: false, error: "Sem permissão." }, { status: 403 });
    }

    await prisma.contentItem.delete({ where: { id: itemId } });
    await fs.unlink(path.join(AUTOPILOT_MEDIA_DIR, path.basename(item.filename))).catch(() => {});

    return NextResponse.json({ status: true, message: "Item removido da biblioteca." });
}
