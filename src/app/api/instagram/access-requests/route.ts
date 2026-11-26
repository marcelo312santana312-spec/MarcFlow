import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, hasRole, isAdmin } from "@/lib/api-auth";
import { normalizeInstagramUsername } from "@/modules/instagram/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!hasRole(user.role, "OWNER")) {
        return NextResponse.json({ status: false, error: "Permissão insuficiente." }, { status: 403 });
    }

    const scopeAll = request.nextUrl.searchParams.get("scope") === "all" && isAdmin(user.role);

    const requests = await prisma.instagramAccessRequest.findMany({
        where: scopeAll ? undefined : { userId: user.id },
        orderBy: { updatedAt: "desc" },
        include: scopeAll
            ? {
                  user: {
                      select: { id: true, name: true, email: true },
                  },
              }
            : undefined,
    });

    return NextResponse.json({
        status: true,
        data: requests,
    });
}

export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!hasRole(user.role, "OWNER")) {
        return NextResponse.json({ status: false, error: "Permissão insuficiente." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const normalized = normalizeInstagramUsername(String(body?.igUsername || ""));
    if (!normalized) {
        return NextResponse.json(
            {
                status: false,
                error: "Informe um @usuário válido do Instagram (letras, números, ponto ou underline).",
            },
            { status: 400 }
        );
    }

    const existingSame = await prisma.instagramAccessRequest.findFirst({
        where: {
            userId: user.id,
            igUsername: normalized,
            status: { in: ["PENDING", "APPROVED"] },
        },
        orderBy: { updatedAt: "desc" },
    });

    if (existingSame) {
        return NextResponse.json({
            status: true,
            message:
                existingSame.status === "APPROVED"
                    ? `A conta @${normalized} já está liberada para você seguir com a conexão.`
                    : `Já existe uma solicitação pendente para @${normalized}.`,
            data: existingSame,
        });
    }

    // Cancela/substitui pendências antigas de outro @ do mesmo usuário para manter apenas 1 ativa
    await prisma.instagramAccessRequest.updateMany({
        where: {
            userId: user.id,
            status: "PENDING",
        },
        data: {
            status: "REJECTED",
            adminNote: `Substituída por nova solicitação (@${normalized}).`,
        },
    });

    const created = await prisma.instagramAccessRequest.create({
        data: {
            userId: user.id,
            igUsername: normalized,
            status: "PENDING",
        },
    });

    // Notifica todos os SUPERADMINs no painel + tempo real via Socket.IO
    const superAdmins = await prisma.user.findMany({
        where: { role: "SUPERADMIN" },
        select: { id: true },
    });

    const requesterLabel = user.name ? `${user.name} (${user.email})` : user.email;
    const title = `Solicitação Instagram: @${normalized}`;
    const message = `${requesterLabel} pediu liberação da conta @${normalized} como Testador do Instagram no app da Meta.`;
    const href = "/dashboard/admin?tab=instagram";
    const io = (global as any).io;

    await Promise.all(
        superAdmins.map(async (admin) => {
            const notif = await prisma.notification.create({
                data: {
                    userId: admin.id,
                    title,
                    message,
                    type: "WARNING",
                    href,
                },
            });

            if (io) {
                io.to(`user:${admin.id}`).emit("notification:new", {
                    id: notif.id,
                    userId: admin.id,
                    title,
                    message,
                    type: "WARNING",
                    href,
                    createdAt: notif.createdAt,
                });
            }
        })
    );

    return NextResponse.json(
        {
            status: true,
            message: `Solicitação enviada! O administrador foi avisado sobre @${normalized}.`,
            data: created,
        },
        { status: 201 }
    );
}
