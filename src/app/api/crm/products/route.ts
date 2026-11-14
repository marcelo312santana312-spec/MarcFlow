import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { z } from "zod";
import { getTeamOwnerId } from "../_helpers";

const createProductSchema = z.object({
    name: z.string().min(1, "Nome é obrigatório"),
    description: z.string().nullable().optional(),
    priceCents: z.number().int().min(0),
    pixKey: z.string().nullable().optional(),
    imageUrl: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    isActive: z.boolean().optional().default(true),
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
        const { searchParams } = new URL(req.url);
        const activeOnly = searchParams.get("activeOnly") === "true";
        const search = searchParams.get("search")?.trim();

        const where: Record<string, unknown> = { userId: ownerId };
        if (activeOnly) where.isActive = true;
        if (search) {
            where.OR = [
                { name: { contains: search } },
                { category: { contains: search } },
                { description: { contains: search } },
            ];
        }

        const products = await prisma.product.findMany({
            where,
            orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
        });

        return NextResponse.json({ status: true, data: products });
    } catch (error) {
        console.error("GET /api/crm/products error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao listar produtos" },
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
        const parsed = createProductSchema.safeParse(body);
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
        const input = parsed.data;

        const product = await prisma.product.create({
            data: {
                userId: ownerId,
                name: input.name.trim(),
                description: input.description?.trim() || null,
                priceCents: input.priceCents,
                pixKey: input.pixKey?.trim() || null,
                imageUrl: input.imageUrl?.trim() || null,
                category: input.category?.trim() || null,
                isActive: input.isActive,
            },
        });

        return NextResponse.json(
            {
                status: true,
                message: "Produto cadastrado com sucesso",
                data: product,
            },
            { status: 201 }
        );
    } catch (error) {
        console.error("POST /api/crm/products error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao cadastrar produto" },
            { status: 500 }
        );
    }
}
