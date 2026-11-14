import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, getAccessibleSessions } from "@/lib/api-auth";
import { checkPlanLimit } from "@/lib/subscription";

export const dynamic = 'force-dynamic';

// GET: Fetch sessions (filtered by user role)
export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        // Get sessions based on user role
        const sessions = await getAccessibleSessions(user.id, user.role);
        return NextResponse.json({ status: true, message: "Sessions retrieved successfully", data: sessions });
    } catch (error) {
        console.error("Get sessions error:", error);
        return NextResponse.json({ status: false, message: "Failed to fetch sessions", error: "Failed to fetch sessions" }, { status: 500 });
    }
}

// POST: Create new session (always for the authenticated user)
export async function POST(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const { name, sessionId } = body;

        if (!name) {
            return NextResponse.json({ status: false, message: "Nome da sessão é obrigatório", error: "Session name is required" }, { status: 400 });
        }

        const limitCheck = await checkPlanLimit(user.id, "sessions");
        if (!limitCheck.allowed) {
            return NextResponse.json(
                {
                    status: false,
                    message: limitCheck.reason || "Limite de conexões WhatsApp atingido no seu plano atual.",
                    error: limitCheck.reason || "Plan limit reached",
                    code: "PLAN_LIMIT_REACHED",
                },
                { status: 403 }
            );
        }

        // Create session for the authenticated user
        const session = await waManager.createSession(user.id, name, sessionId);
        return NextResponse.json({ status: true, message: "Session created successfully", data: session });
    } catch (error) {
        console.error("Create session error:", error);
        return NextResponse.json({ status: false, message: "Failed to create session", error: "Failed to create session" }, { status: 500 });
    }
}
