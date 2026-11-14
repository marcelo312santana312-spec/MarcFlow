import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession, isAdmin } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set([
  "SCHEDULED",
  "CONFIRMED",
  "COMPLETED",
  "CANCELED",
  "NO_SHOW",
]);

function normalizeContactJid(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return trimmed;
  return `${digits}@s.whatsapp.net`;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { status: false, message: "Não autorizado" },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    const existing = await prisma.appointment.findUnique({ where: { id } });

    if (!existing) {
      return NextResponse.json(
        { status: false, message: "Agendamento não encontrado" },
        { status: 404 }
      );
    }

    const allowed =
      isAdmin(user.role) ||
      existing.userId === user.id ||
      (await canAccessSession(user.id, user.role, existing.sessionId));

    if (!allowed) {
      return NextResponse.json(
        { status: false, message: "Sem permissão para editar este agendamento" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const updateData: any = {};

    if (body.title !== undefined) updateData.title = String(body.title).trim();
    if (body.notes !== undefined)
      updateData.notes = body.notes ? String(body.notes).trim() : null;
    if (body.contactName !== undefined)
      updateData.contactName = body.contactName
        ? String(body.contactName).trim()
        : null;
    if (body.contactJid !== undefined)
      updateData.contactJid = normalizeContactJid(String(body.contactJid));

    if (body.durationMin !== undefined) {
      const parsedDuration = Number(body.durationMin);
      if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
        updateData.durationMin = Math.min(parsedDuration, 1440);
      }
    }

    if (body.status !== undefined) {
      if (!ALLOWED_STATUSES.has(String(body.status))) {
        return NextResponse.json(
          { status: false, message: "Status de agendamento inválido" },
          { status: 400 }
        );
      }
      updateData.status = String(body.status);
    }

    if (body.scheduledAt !== undefined) {
      const parsedDate = new Date(body.scheduledAt);
      if (isNaN(parsedDate.getTime())) {
        return NextResponse.json(
          { status: false, message: "Data e hora inválidas" },
          { status: 400 }
        );
      }
      updateData.scheduledAt = parsedDate;
      // Se reagendado para nova data, reseta flags de lembretes se a data mudou
      if (parsedDate.getTime() !== existing.scheduledAt.getTime()) {
        updateData.reminder24hSent = false;
        updateData.reminder2hSent = false;
      }
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: updateData,
      include: {
        session: {
          select: { id: true, sessionId: true, name: true },
        },
      },
    });

    return NextResponse.json({
      status: true,
      message: "Agendamento atualizado com sucesso",
      data: updated,
    });
  } catch (error) {
    console.error("PATCH /api/agenda/[id] error:", error);
    return NextResponse.json(
      { status: false, message: "Erro ao atualizar agendamento" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { status: false, message: "Não autorizado" },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    const existing = await prisma.appointment.findUnique({ where: { id } });

    if (!existing) {
      return NextResponse.json(
        { status: false, message: "Agendamento não encontrado" },
        { status: 404 }
      );
    }

    const allowed =
      isAdmin(user.role) ||
      existing.userId === user.id ||
      (await canAccessSession(user.id, user.role, existing.sessionId));

    if (!allowed) {
      return NextResponse.json(
        { status: false, message: "Sem permissão para excluir este agendamento" },
        { status: 403 }
      );
    }

    await prisma.appointment.delete({ where: { id } });

    return NextResponse.json({
      status: true,
      message: "Agendamento removido com sucesso",
    });
  } catch (error) {
    console.error("DELETE /api/agenda/[id] error:", error);
    return NextResponse.json(
      { status: false, message: "Erro ao excluir agendamento" },
      { status: 500 }
    );
  }
}
