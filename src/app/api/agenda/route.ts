import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getAuthenticatedUser,
  getAccessibleSessions,
  canAccessSession,
  isAdmin,
} from "@/lib/api-auth";

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

async function resolveSessionByIdOrSlug(sessionIdOrSlug: string) {
  return prisma.session.findFirst({
    where: {
      OR: [{ id: sessionIdOrSlug }, { sessionId: sessionIdOrSlug }],
    },
    select: { id: true, sessionId: true, name: true, userId: true },
  });
}

// GET /api/agenda?startDate=...&endDate=...&status=...&sessionId=...&search=...
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { status: false, message: "Não autorizado", error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");
    const statusParam = searchParams.get("status");
    const sessionIdParam = searchParams.get("sessionId");
    const searchParam = searchParams.get("search")?.trim();

    const where: any = {};

    // Escopo de sessões acessíveis
    if (sessionIdParam && sessionIdParam !== "all") {
      const dbSession = await resolveSessionByIdOrSlug(sessionIdParam);
      if (!dbSession) {
        return NextResponse.json({ status: true, data: [] });
      }
      const allowed = await canAccessSession(user.id, user.role, dbSession.id);
      if (!allowed) {
        return NextResponse.json(
          { status: false, message: "Sem permissão para esta sessão" },
          { status: 403 }
        );
      }
      where.sessionId = dbSession.id;
    } else if (!isAdmin(user.role)) {
      const accessible = await getAccessibleSessions(user.id, user.role);
      const accessibleIds = accessible.map((s) => s.id);
      if (accessibleIds.length === 0) {
        return NextResponse.json({ status: true, data: [] });
      }
      where.sessionId = { in: accessibleIds };
    }

    if (statusParam && statusParam !== "ALL" && ALLOWED_STATUSES.has(statusParam)) {
      where.status = statusParam;
    }

    if (startDateParam || endDateParam) {
      where.scheduledAt = {};
      if (startDateParam) {
        const start = new Date(startDateParam);
        if (!isNaN(start.getTime())) {
          where.scheduledAt.gte = start;
        }
      }
      if (endDateParam) {
        const end = new Date(endDateParam);
        if (!isNaN(end.getTime())) {
          where.scheduledAt.lte = end;
        }
      }
    }

    if (searchParam) {
      where.OR = [
        { title: { contains: searchParam, mode: "insensitive" } },
        { contactName: { contains: searchParam, mode: "insensitive" } },
        { contactJid: { contains: searchParam, mode: "insensitive" } },
        { notes: { contains: searchParam, mode: "insensitive" } },
      ];
    }

    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: { scheduledAt: "asc" },
      include: {
        session: {
          select: { id: true, sessionId: true, name: true },
        },
      },
    });

    return NextResponse.json({ status: true, data: appointments });
  } catch (error) {
    console.error("GET /api/agenda error:", error);
    return NextResponse.json(
      { status: false, message: "Erro ao carregar agendamentos" },
      { status: 500 }
    );
  }
}

// POST /api/agenda
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json(
        { status: false, message: "Não autorizado", error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      sessionId,
      contactJid,
      contactName,
      title,
      notes,
      scheduledAt,
      durationMin,
      status,
    } = body;

    if (!sessionId || !contactJid || !title || !scheduledAt) {
      return NextResponse.json(
        {
          status: false,
          message: "Sessão, contato, título e data/hora são obrigatórios.",
        },
        { status: 400 }
      );
    }

    const dbSession = await resolveSessionByIdOrSlug(String(sessionId));
    if (!dbSession) {
      return NextResponse.json(
        { status: false, message: "Sessão de WhatsApp não encontrada." },
        { status: 404 }
      );
    }

    const allowed = await canAccessSession(user.id, user.role, dbSession.id);
    if (!allowed) {
      return NextResponse.json(
        { status: false, message: "Sem permissão para agendar nesta sessão." },
        { status: 403 }
      );
    }

    const parsedDate = new Date(scheduledAt);
    if (isNaN(parsedDate.getTime())) {
      return NextResponse.json(
        { status: false, message: "Data e hora inválidas." },
        { status: 400 }
      );
    }

    const normalizedJid = normalizeContactJid(String(contactJid));
    const safeStatus =
      status && ALLOWED_STATUSES.has(String(status)) ? String(status) : "SCHEDULED";
    const parsedDuration = Number(durationMin);
    const safeDuration =
      Number.isFinite(parsedDuration) && parsedDuration > 0
        ? Math.min(parsedDuration, 1440)
        : 60;

    const appointment = await prisma.appointment.create({
      data: {
        userId: user.id,
        sessionId: dbSession.id,
        contactJid: normalizedJid,
        contactName: contactName ? String(contactName).trim() : null,
        title: String(title).trim(),
        notes: notes ? String(notes).trim() : null,
        scheduledAt: parsedDate,
        durationMin: safeDuration,
        status: safeStatus,
      },
      include: {
        session: {
          select: { id: true, sessionId: true, name: true },
        },
      },
    });

    return NextResponse.json({
      status: true,
      message: "Agendamento criado com sucesso",
      data: appointment,
    });
  } catch (error) {
    console.error("POST /api/agenda error:", error);
    return NextResponse.json(
      { status: false, message: "Erro ao criar agendamento" },
      { status: 500 }
    );
  }
}
