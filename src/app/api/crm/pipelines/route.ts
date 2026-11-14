import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { z } from "zod";
import {
    DEFAULT_PIPELINE_STAGES,
    ensureDefaultPipeline,
    getTeamOwnerId,
} from "../_helpers";

const stageInputSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    color: z.string().default("#3B82F6"),
    order: z.number().int().min(0),
    isWon: z.boolean().optional().default(false),
    isLost: z.boolean().optional().default(false),
});

const upsertPipelineSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    isDefault: z.boolean().optional().default(false),
    stages: z.array(stageInputSchema).optional(),
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

        const ownerId = await getTeamOwnerId(user.id);
        const pipelines = await ensureDefaultPipeline(ownerId);

        return NextResponse.json({
            status: true,
            data: pipelines,
        });
    } catch (error) {
        console.error("GET /api/crm/pipelines error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao carregar funis" },
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
        const parsed = upsertPipelineSchema.safeParse(body);
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

        const ownerId = await getTeamOwnerId(user.id);
        const { id, name, isDefault, stages } = parsed.data;

        if (isDefault) {
            await prisma.pipeline.updateMany({
                where: { userId: ownerId },
                data: { isDefault: false },
            });
        }

        if (id) {
            const existing = await prisma.pipeline.findFirst({
                where: { id, userId: ownerId },
                include: { stages: true },
            });

            if (!existing) {
                return NextResponse.json(
                    { status: false, message: "Funil não encontrado" },
                    { status: 404 }
                );
            }

            await prisma.pipeline.update({
                where: { id },
                data: { name, isDefault },
            });

            if (stages && stages.length > 0) {
                for (const s of stages) {
                    if (s.id) {
                        await prisma.pipelineStage.updateMany({
                            where: { id: s.id, pipelineId: id },
                            data: {
                                name: s.name,
                                color: s.color,
                                order: s.order,
                                isWon: s.isWon,
                                isLost: s.isLost,
                            },
                        });
                    } else {
                        await prisma.pipelineStage.create({
                            data: {
                                pipelineId: id,
                                name: s.name,
                                color: s.color,
                                order: s.order,
                                isWon: s.isWon,
                                isLost: s.isLost,
                            },
                        });
                    }
                }
            }

            const updated = await prisma.pipeline.findUnique({
                where: { id },
                include: { stages: { orderBy: { order: "asc" } } },
            });

            return NextResponse.json({
                status: true,
                message: "Funil atualizado com sucesso",
                data: updated,
            });
        }

        const created = await prisma.pipeline.create({
            data: {
                userId: ownerId,
                name,
                isDefault,
                stages: {
                    create:
                        stages && stages.length > 0
                            ? stages.map((s) => ({
                                  name: s.name,
                                  color: s.color,
                                  order: s.order,
                                  isWon: s.isWon,
                                  isLost: s.isLost,
                              }))
                            : DEFAULT_PIPELINE_STAGES,
                },
            },
            include: {
                stages: { orderBy: { order: "asc" } },
            },
        });

        return NextResponse.json(
            {
                status: true,
                message: "Funil criado com sucesso",
                data: created,
            },
            { status: 201 }
        );
    } catch (error) {
        console.error("POST /api/crm/pipelines error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao salvar funil" },
            { status: 500 }
        );
    }
}
