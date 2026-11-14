import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessSession, getAuthenticatedUser } from "@/lib/api-auth";
import { z } from "zod";

const createNoteSchema = z.object({
    content: z.string().min(1, "A nota não pode estar vazia"),
});

export async function POST(
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
        const deal = await prisma.deal.findUnique({ where: { id } });
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

        const body = await req.json();
        const parsed = createNoteSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                {
                    status: false,
                    message: "Conteúdo inválido",
                    error: parsed.error.flatten(),
                },
                { status: 400 }
            );
        }

        const [note] = await prisma.$transaction([
            prisma.dealNote.create({
                data: {
                    dealId: id,
                    authorName: user.name || user.email,
                    content: parsed.data.content.trim(),
                },
            }),
            prisma.deal.update({
                where: { id },
                data: { lastInteractionAt: new Date() },
            }),
        ]);

        return NextResponse.json(
            {
                status: true,
                message: "Nota adicionada",
                data: note,
            },
            { status: 201 }
        );
    } catch (error) {
        console.error("POST /api/crm/deals/[id]/notes error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao adicionar nota" },
            { status: 500 }
        );
    }
}
