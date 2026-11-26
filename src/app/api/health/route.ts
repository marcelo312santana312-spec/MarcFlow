import { NextResponse } from "next/server";

export async function GET() {
    const gitSha = (process.env.APP_GIT_SHA || "").trim() || null;
    return NextResponse.json({
        ok: true,
        gitSha,
        gitShortSha: gitSha ? gitSha.slice(0, 7) : null,
        timestamp: new Date().toISOString(),
    });
}
