import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { checkPlanLimit, getUserSubscriptionWithLimits } from "@/lib/subscription";

export const dynamic = "force-dynamic";

const createMemberSchema = z.object({
    name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
    email: z.string().email("E-mail inválido"),
    password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
    sessionIds: z.array(z.string()).optional(),
});

export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Não autorizado", error: "Unauthorized" }, { status: 401 });
        }

        if (user.role === "STAFF") {
            return NextResponse.json(
                { status: false, message: "Apenas o proprietário pode gerenciar a equipe.", error: "Forbidden" },
                { status: 403 }
            );
        }

        const [members, subscriptionInfo, ownerSessions] = await Promise.all([
            prisma.user.findMany({
                where: { ownerId: user.id, role: "STAFF" },
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    createdAt: true,
                    sessionAccesses: {
                        select: {
                            sessionId: true,
                            session: { select: { id: true, name: true, sessionId: true } },
                        },
                    },
                },
            }),
            getUserSubscriptionWithLimits(user.id),
            prisma.session.findMany({
                where: { userId: user.id },
                select: { id: true, name: true, sessionId: true, status: true },
                orderBy: { createdAt: "desc" },
            }),
        ]);

        return NextResponse.json({
            status: true,
            message: "Equipe carregada com sucesso",
            data: {
                members,
                sessions: ownerSessions,
                limits: subscriptionInfo.limits,
                usage: subscriptionInfo.usage,
                planName: subscriptionInfo.plan.name,
            },
        });
    } catch (error) {
        console.error("Get team error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao carregar equipe", error: "Erro ao carregar equipe" },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Não autorizado", error: "Unauthorized" }, { status: 401 });
        }

        if (user.role === "STAFF") {
            return NextResponse.json(
                { status: false, message: "Apenas o proprietário pode adicionar atendentes.", error: "Forbidden" },
                { status: 403 }
            );
        }

        const limitCheck = await checkPlanLimit(user.id, "users");
        if (!limitCheck.allowed) {
            return NextResponse.json(
                {
                    status: false,
                    message: limitCheck.reason,
                    error: limitCheck.reason,
                    code: "PLAN_LIMIT_REACHED",
                },
                { status: 403 }
            );
        }

        const body = await request.json();
        const parsed = createMemberSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                {
                    status: false,
                    message: parsed.error.issues[0]?.message || "Dados inválidos",
                    error: parsed.error.flatten(),
                },
                { status: 400 }
            );
        }

        const { name, email, password, sessionIds } = parsed.data;
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return NextResponse.json(
                { status: false, message: "Este e-mail já está cadastrado.", error: "Email already exists" },
                { status: 400 }
            );
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newMember = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                role: "STAFF",
                ownerId: user.id,
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                ownerId: true,
                createdAt: true,
            },
        });

        // Grant access to selected owner sessions (or all owner sessions if none specified)
        const ownerSessions = await prisma.session.findMany({
            where: { userId: user.id },
            select: { id: true },
        });
        const allowedSessionIds =
            sessionIds && sessionIds.length > 0
                ? ownerSessions.filter((s) => sessionIds.includes(s.id)).map((s) => s.id)
                : ownerSessions.map((s) => s.id);

        if (allowedSessionIds.length > 0) {
            await prisma.sessionAccess.createMany({
                data: allowedSessionIds.map((sid) => ({
                    sessionId: sid,
                    userId: newMember.id,
                })),
                skipDuplicates: true,
            });
        }

        return NextResponse.json(
            { status: true, message: "Atendente adicionado à equipe com sucesso!", data: newMember },
            { status: 201 }
        );
    } catch (error) {
        console.error("Create team member error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao criar atendente", error: "Erro ao criar atendente" },
            { status: 500 }
        );
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Não autorizado", error: "Unauthorized" }, { status: 401 });
        }

        if (user.role === "STAFF") {
            return NextResponse.json(
                { status: false, message: "Apenas o proprietário pode remover atendentes.", error: "Forbidden" },
                { status: 403 }
            );
        }

        let memberId = request.nextUrl.searchParams.get("id");
        if (!memberId) {
            try {
                const body = await request.json();
                memberId = body?.id;
            } catch {
                // ignore empty body
            }
        }

        if (!memberId) {
            return NextResponse.json(
                { status: false, message: "ID do atendente é obrigatório", error: "Missing member id" },
                { status: 400 }
            );
        }

        const member = await prisma.user.findUnique({
            where: { id: memberId },
            select: { id: true, role: true, ownerId: true },
        });

        if (!member || member.role !== "STAFF") {
            return NextResponse.json(
                { status: false, message: "Atendente não encontrado", error: "Not found" },
                { status: 404 }
            );
        }

        if (!isAdmin(user.role) && member.ownerId !== user.id) {
            return NextResponse.json(
                { status: false, message: "Você não tem permissão para remover este atendente", error: "Forbidden" },
                { status: 403 }
            );
        }

        await prisma.user.delete({ where: { id: member.id } });

        return NextResponse.json({
            status: true,
            message: "Atendente removido da equipe com sucesso",
        });
    } catch (error) {
        console.error("Delete team member error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao remover atendente", error: "Erro ao remover atendente" },
            { status: 500 }
        );
    }
}
