import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { getLatestCommitAndBuildStatus, getUpdateRepoConfig } from "@/lib/github";

function getUpdaterConfig(): { url: string; secret: string } | null {
    const url = (process.env.SYSTEM_UPDATER_URL || "").trim().replace(/\/+$/, "");
    const secret = (process.env.SYSTEM_UPDATER_SECRET || "").trim();
    if (!url || !secret) return null;
    return { url, secret };
}

async function fetchUpdater(
    path: string,
    method: "GET" | "POST",
    body?: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
    const cfg = getUpdaterConfig();
    if (!cfg) {
        return {
            ok: false,
            status: 503,
            data: null,
            error: "Agente de atualização automática não configurado (SYSTEM_UPDATER_URL / SYSTEM_UPDATER_SECRET).",
        };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch(`${cfg.url}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${cfg.secret}`,
                "Content-Type": "application/json",
            },
            body: body ? JSON.stringify(body) : undefined,
            cache: "no-store",
            signal: controller.signal,
        });

        const data = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, data };
    } catch (err: any) {
        return {
            ok: false,
            status: 502,
            data: null,
            error: err?.name === "AbortError"
                ? "Tempo limite ao contatar o agente de atualização na VM."
                : "Não foi possível conectar ao agente de atualização na VM.",
        };
    } finally {
        clearTimeout(timeout);
    }
}

export async function GET(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    }
    if (user.role !== "SUPERADMIN") {
        return NextResponse.json({ status: false, message: "Forbidden", error: "Forbidden" }, { status: 403 });
    }

    const currentSha = (process.env.APP_GIT_SHA || "").trim() || null;
    const currentShortSha = currentSha ? currentSha.slice(0, 7) : null;
    const cfg = getUpdaterConfig();

    if (!cfg) {
        return NextResponse.json({
            status: true,
            configured: false,
            reachable: false,
            currentSha,
            currentShortSha,
            updater: null,
        });
    }

    const res = await fetchUpdater("/status", "GET");
    if (!res.ok) {
        return NextResponse.json({
            status: false,
            configured: true,
            reachable: false,
            currentSha,
            currentShortSha,
            message: res.error || "Agente de atualização indisponível.",
            updater: null,
        }, { status: res.status });
    }

    return NextResponse.json({
        status: true,
        configured: true,
        reachable: true,
        currentSha,
        currentShortSha,
        updater: res.data,
    });
}

export async function POST(req: NextRequest) {
    const user = await getAuthenticatedUser(req);
    if (!user) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    }
    if (user.role !== "SUPERADMIN") {
        return NextResponse.json({ status: false, message: "Somente SuperAdmin pode atualizar o sistema.", error: "Forbidden" }, { status: 403 });
    }

    const cfg = getUpdaterConfig();
    if (!cfg) {
        return NextResponse.json(
            {
                status: false,
                message: "Agente de atualização automática não configurado neste ambiente.",
                error: "SYSTEM_UPDATER_URL not configured",
            },
            { status: 503 }
        );
    }

    const body = await req.json().catch(() => ({}));
    const force = Boolean(body?.force);

    let targetSha = "";
    const repoConfig = getUpdateRepoConfig();
    if (repoConfig) {
        const gh = await getLatestCommitAndBuildStatus(repoConfig.owner, repoConfig.repo, repoConfig.branch);
        if (gh) {
            targetSha = gh.latestCommit.sha;
            if (!force && gh.imageStatus === "building") {
                return NextResponse.json(
                    {
                        status: false,
                        code: "IMAGE_BUILDING",
                        message: `O GitHub Actions ainda está compilando a imagem do commit ${gh.latestCommit.shortSha}. Aguarde finalizar para atualizar.`,
                        data: { workflowRun: gh.workflowRun, latestCommit: gh.latestCommit },
                    },
                    { status: 409 }
                );
            }
            if (!force && gh.imageStatus === "failed") {
                return NextResponse.json(
                    {
                        status: false,
                        code: "IMAGE_BUILD_FAILED",
                        message: `O último build do commit ${gh.latestCommit.shortSha} falhou no GitHub Actions. Verifique o workflow antes de atualizar.`,
                        data: { workflowRun: gh.workflowRun, latestCommit: gh.latestCommit },
                    },
                    { status: 409 }
                );
            }
        }
    }

    const trigger = await fetchUpdater("/update", "POST", { targetSha });
    if (!trigger.ok) {
        return NextResponse.json(
            {
                status: false,
                message: trigger.data?.error || trigger.error || "Falha ao iniciar a atualização na VM.",
                data: trigger.data,
            },
            { status: trigger.status || 502 }
        );
    }

    return NextResponse.json(
        {
            status: true,
            message: "Atualização iniciada na VM.",
            data: trigger.data,
        },
        { status: 202 }
    );
}
