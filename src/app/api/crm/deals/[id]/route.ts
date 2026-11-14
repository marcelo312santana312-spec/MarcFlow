import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessSession, getAuthenticatedUser } from "@/lib/api-auth";
import { z } from "zod";

const updateDealSchema = z.object({
    stageId: z.string().optional(),
    title: z.string().min(1).optional(),
    valueCents: z.number().int().min(0).optional(),
    status: z.enum(["OPEN", "WON", "LOST"]).optional(),
    followUpAt: z.string().datetime().nullable().optional(),
    contactName: z.string().nullable().optional(),
    contactPhone: z.string().nullable().optional(),
});

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return NextResponse.json(
                { status: false, message: "Não autorizado" },
                { status: 401 }
            );
        }

        const { id } = await params;
        const deal = await prisma.deal.findUnique({
            where: { id },
            include: {
                stage: true,
                session: { select: { id: true, sessionId: true, name: true } },
                notes: { orderBy: { createdAt: "desc" } },
            },
        });

        if (!deal) {
            return NextResponse.json(
                { status: false, message: "Negócio não encontrado" },
                { status: 404 }
            );
        }

        const canAccess = await canAccessSession(
            user.id,
            user.role,
            deal.sessionId
        );
        if (!canAccess) {
            return NextResponse.json(
                { status: false, message: "Sem permissão" },
                { status: 403 }
            );
        }

        return NextResponse.json({ status: true, data: deal });
    } catch (error) {
        console.error("GET /api/crm/deals/[id] error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao buscar negócio" },
            { status: 500 }
        );
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return NextResponse.json(
                { status: false, message: "Não autorizado" },
                { status: 401 }
            );
        }

        const { id } = await params;
        const existing = await prisma.deal.findUnique({ where: { id } });
        if (!existing) {
            return NextResponse.json(
                { status: false, message: "Negócio não encontrado" },
                { status: 404 }
            );
        }

        const canAccess = await canAccessSession(
            user.id,
            user.role,
            existing.sessionId
        );
        if (!canAccess) {
            return NextResponse.json(
                { status: false, message: "Sem permissão" },
                { status: 403 }
            );
        }

        const body = await req.json();
        const parsed = updateDealSchema.safeParse(body);
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
        const data: Record<string, unknown> = {
            lastInteractionAt: new Date(),
        };

        if (input.title !== undefined) data.title = input.title;
        if (input.valueCents !== undefined) data.valueCents = input.valueCents;
        if (input.contactName !== undefined) data.contactName = input.contactName;
        if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone;
        if (input.followUpAt !== undefined) {
            data.followUpAt = input.followUpAt ? new Date(input.followUpAt) : null;
        }

        if (input.stageId) {
            const stage = await prisma.pipelineStage.findFirst({
                where: { id: input.stageId, pipelineId: existing.pipelineId },
            });
            if (!stage) {
                return NextResponse.json(
                    { status: false, message: "Estágio inválido" },
                    { status: 400 }
                );
            }
            data.stageId = stage.id;
            if (!input.status) {
                data.status = stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN";
            }
        }

        if (input.status !== undefined) {
            data.status = input.status;
        }

        const updated = await prisma.deal.update({
            where: { id },
            data,
            include: {
                stage: true,
                session: { select: { id: true, sessionId: true, name: true } },
                notes: { orderBy: { createdAt: "desc" } },
            },
        });

        return NextResponse.json({
            status: true,
            message: "Negócio atualizado",
            data: updated,
        });
    } catch (error) {
        console.error("PATCH /api/crm/deals/[id] error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao atualizar negócio" },
            { status: 500 }
        );
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return NextResponse.json(
                { status: false, message: "Não autorizado" },
                { status: 401 }
            );
        }

        const { id } = await params;
        const existing = await prisma.deal.findUnique({ where: { id } });
        if (!existing) {
            return NextResponse.json(
                { status: false, message: "Negócio não encontrado" },
                { status: 404 }
            );
        }

        const canAccess = await canAccessSession(
            user.id,
            user.role,
            existing.sessionId
        );
        if (!canAccess) {
            return NextResponse.json(
                { status: false, message: "Sem permissão" },
                { status: 403 }
            );
        }

        await prisma.deal.delete({ where: { id } });

        return NextResponse.json({
            status: true,
            message: "Negócio removido",
        });
    } catch (error) {
        console.error("DELETE /api/crm/deals/[id] error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao remover negócio" },
            { status: 500 }
        );
    }
}
