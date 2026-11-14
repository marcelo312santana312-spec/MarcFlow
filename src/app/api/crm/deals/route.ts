import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessSession, getAuthenticatedUser } from "@/lib/api-auth";
import { z } from "zod";
import {
    cleanPhoneFromJid,
    ensureDefaultPipeline,
    getTeamOwnerId,
    getUserAccessibleSessionIds,
    resolveSession,
} from "../_helpers";

const createDealSchema = z.object({
    sessionId: z.string().min(1),
    contactJid: z.string().min(1),
    contactName: z.string().optional().nullable(),
    contactPhone: z.string().optional().nullable(),
    title: z.string().min(1),
    valueCents: z.number().int().min(0).optional().default(0),
    pipelineId: z.string().optional(),
    stageId: z.string().optional(),
    followUpAt: z.string().datetime().optional().nullable(),
});

export async function GET(req: NextRequest) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return NextResponse.json(
                { status: false, message: "Não autorizado" },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(req.url);
        const sessionParam = searchParams.get("sessionId");
        const pipelineId = searchParams.get("pipelineId");
        const stageId = searchParams.get("stageId");
        const status = searchParams.get("status");
        const contactJid = searchParams.get("contactJid");
        const search = searchParams.get("search")?.trim();

        let sessionIds = await getUserAccessibleSessionIds(user.id, user.role);

        if (sessionParam) {
            const resolved = await resolveSession(sessionParam);
            if (!resolved) {
                return NextResponse.json({ status: true, data: [] });
            }
            const canAccess = await canAccessSession(
                user.id,
                user.role,
                resolved.id
            );
            if (!canAccess) {
                return NextResponse.json(
                    { status: false, message: "Sem permissão para esta sessão" },
                    { status: 403 }
                );
            }
            sessionIds = [resolved.id];
        }

        if (sessionIds.length === 0) {
            return NextResponse.json({ status: true, data: [] });
        }

        const where: Record<string, unknown> = {
            sessionId: { in: sessionIds },
        };

        if (pipelineId) where.pipelineId = pipelineId;
        if (stageId) where.stageId = stageId;
        if (status) where.status = status;
        if (contactJid) where.contactJid = contactJid;
        if (search) {
            where.OR = [
                { title: { contains: search } },
                { contactName: { contains: search } },
                { contactPhone: { contains: search } },
                { contactJid: { contains: search } },
            ];
        }

        const deals = await prisma.deal.findMany({
            where,
            orderBy: [{ updatedAt: "desc" }],
            include: {
                stage: true,
                session: {
                    select: { id: true, sessionId: true, name: true },
                },
                notes: {
                    orderBy: { createdAt: "desc" },
                },
            },
        });

        return NextResponse.json({
            status: true,
            data: deals,
        });
    } catch (error) {
        console.error("GET /api/crm/deals error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao buscar negócios" },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return NextResponse.json(
                { status: false, message: "Não autorizado" },
                { status: 401 }
            );
        }

        const body = await req.json();
        const parsed = createDealSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                {
                    status: false,
                    message: "Dados inválidos",
                    error: parsed.error.flatten(),
                },
                { status: 400 }
            );
        }

        const input = parsed.data;
        const resolvedSession = await resolveSession(input.sessionId);
        if (!resolvedSession) {
            return NextResponse.json(
                { status: false, message: "Sessão não encontrada" },
                { status: 404 }
            );
        }

        const canAccess = await canAccessSession(
            user.id,
            user.role,
            resolvedSession.id
        );
        if (!canAccess) {
            return NextResponse.json(
                { status: false, message: "Sem permissão para esta sessão" },
                { status: 403 }
            );
        }

        const ownerId = await getTeamOwnerId(user.id);
        let pipelineId = input.pipelineId;
        let stageId = input.stageId;

        if (!pipelineId || !stageId) {
            const pipelines = await ensureDefaultPipeline(ownerId);
            const targetPipeline =
                (pipelineId
                    ? pipelines.find((p) => p.id === pipelineId)
                    : pipelines[0]) || pipelines[0];
            pipelineId = targetPipeline.id;
            const targetStage =
                (stageId
                    ? targetPipeline.stages.find((s) => s.id === stageId)
                    : targetPipeline.stages[0]) || targetPipeline.stages[0];
            if (!targetStage) {
                return NextResponse.json(
                    { status: false, message: "Funil sem estágios configurados" },
                    { status: 400 }
                );
            }
            stageId = targetStage.id;
        }

        const stage = await prisma.pipelineStage.findFirst({
            where: { id: stageId, pipelineId },
        });
        if (!stage) {
            return NextResponse.json(
                { status: false, message: "Estágio inválido para este funil" },
                { status: 400 }
            );
        }

        const initialStatus = stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN";

        const deal = await prisma.deal.create({
            data: {
                pipelineId,
                stageId,
                sessionId: resolvedSession.id,
                contactJid: input.contactJid,
                contactName: input.contactName || null,
                contactPhone:
                    input.contactPhone || cleanPhoneFromJid(input.contactJid),
                title: input.title,
                valueCents: input.valueCents,
                status: initialStatus,
                followUpAt: input.followUpAt ? new Date(input.followUpAt) : null,
            },
            include: {
                stage: true,
                session: { select: { id: true, sessionId: true, name: true } },
                notes: { orderBy: { createdAt: "desc" } },
            },
        });

        return NextResponse.json(
            {
                status: true,
                message: "Negócio criado com sucesso",
                data: deal,
            },
            { status: 201 }
        );
    } catch (error) {
        console.error("POST /api/crm/deals error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao criar negócio" },
            { status: 500 }
        );
    }
}
