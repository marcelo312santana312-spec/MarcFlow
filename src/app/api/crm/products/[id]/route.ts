import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { z } from "zod";
import { getTeamOwnerId } from "../../_helpers";

const updateProductSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    priceCents: z.number().int().min(0).optional(),
    pixKey: z.string().nullable().optional(),
    imageUrl: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
});

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
        const existing = await prisma.product.findUnique({ where: { id } });
        if (!existing) {
            return NextResponse.json(
                { status: false, message: "Produto não encontrado" },
                { status: 404 }
            );
        }

        const ownerId = await getTeamOwnerId(user.id);
        if (existing.userId !== ownerId && !isAdmin(user.role)) {
            return NextResponse.json(
                { status: false, message: "Sem permissão" },
                { status: 403 }
            );
        }

        const body = await req.json();
        const parsed = updateProductSchema.safeParse(body);
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
        const updated = await prisma.product.update({
            where: { id },
            data: {
                ...(input.name !== undefined && { name: input.name.trim() }),
                ...(input.description !== undefined && {
                    description: input.description?.trim() || null,
                }),
                ...(input.priceCents !== undefined && {
                    priceCents: input.priceCents,
                }),
                ...(input.pixKey !== undefined && {
                    pixKey: input.pixKey?.trim() || null,
                }),
                ...(input.imageUrl !== undefined && {
                    imageUrl: input.imageUrl?.trim() || null,
                }),
                ...(input.category !== undefined && {
                    category: input.category?.trim() || null,
                }),
                ...(input.isActive !== undefined && {
                    isActive: input.isActive,
                }),
            },
        });

        return NextResponse.json({
            status: true,
            message: "Produto atualizado",
            data: updated,
        });
    } catch (error) {
        console.error("PATCH /api/crm/products/[id] error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao atualizar produto" },
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
        const existing = await prisma.product.findUnique({ where: { id } });
        if (!existing) {
            return NextResponse.json(
                { status: false, message: "Produto não encontrado" },
                { status: 404 }
            );
        }

        const ownerId = await getTeamOwnerId(user.id);
        if (existing.userId !== ownerId && !isAdmin(user.role)) {
            return NextResponse.json(
                { status: false, message: "Sem permissão" },
                { status: 403 }
            );
        }

        await prisma.product.delete({ where: { id } });

        return NextResponse.json({
            status: true,
            message: "Produto removido",
        });
    } catch (error) {
        console.error("DELETE /api/crm/products/[id] error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao remover produto" },
            { status: 500 }
        );
    }
}
