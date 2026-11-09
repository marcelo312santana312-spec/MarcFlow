import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { sendScheduledMessage } from "@/modules/whatsapp/scheduler";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; scheduleId: string }> }
) {
    try {
        const { sessionId, scheduleId } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const msg = await prisma.scheduledMessage.findUnique({
            where: { id: scheduleId },
            include: { session: true },
        });

        if (!msg) {
            return NextResponse.json({ status: false, message: "Agendamento não encontrado", error: "Agendamento não encontrado" }, { status: 404 });
        }

        const result = await sendScheduledMessage(scheduleId);
        if (!result.success) {
            return NextResponse.json({ status: false, message: result.error || "Falha ao enviar", error: result.error }, { status: 500 });
        }

        return NextResponse.json({ status: true, message: "Mensagem enviada com sucesso agora!" });
    } catch (error: any) {
        return NextResponse.json({ status: false, message: "Internal Server Error", error: error?.message || "Internal Server Error" }, { status: 500 });
    }
}
