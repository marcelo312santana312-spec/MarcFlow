import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { runAutoPostRule } from "@/modules/autopilot/scheduler";

export async function POST(
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

    const res = await runAutoPostRule(id);
    return NextResponse.json({
        status: true,
        message:
            res.scheduledDispatches > 0
                ? `${res.scheduledDispatches} postagem(ns) programada(s) em ${res.slotsFilled} horário(s)!`
                : "Todos os horários de hoje e amanhã já estão preenchidos (ou a biblioteca está vazia).",
        data: res,
    });
}
