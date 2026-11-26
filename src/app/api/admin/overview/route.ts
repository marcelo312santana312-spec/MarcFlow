import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { getSuperAdminOverviewData } from "@/lib/admin-overview";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json(
                { status: false, message: "Não autorizado", error: "Unauthorized" },
                { status: 401 }
            );
        }

        if (!isAdmin(user.role)) {
            return NextResponse.json(
                { status: false, message: "Acesso restrito ao SuperAdmin.", error: "Forbidden" },
                { status: 403 }
            );
        }

        const data = await getSuperAdminOverviewData();
        return NextResponse.json({
            status: true,
            message: "Painel de gestão carregado com sucesso",
            data,
        });
    } catch (error) {
        console.error("Admin overview error:", error);
        return NextResponse.json(
            { status: false, message: "Erro ao carregar painel de gestão", error: "Failed to load admin overview" },
            { status: 500 }
        );
    }
}
