import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import {
    getLatestCommitAndBuildStatus,
    getUpdateRepoConfig,
    isNewerCommitAvailable,
} from "@/lib/github";

function isSelfUpdateConfigured(): boolean {
    const url = (process.env.SYSTEM_UPDATER_URL || "").trim();
    const secret = (process.env.SYSTEM_UPDATER_SECRET || "").trim();
    return Boolean(url && secret);
}

async function handleCheckUpdates(req: NextRequest, createNotification: boolean) {
    const user = await getAuthenticatedUser(req);
    if (!user) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    }

    const repoConfig = getUpdateRepoConfig();
    const currentSha = (process.env.APP_GIT_SHA || "").trim() || null;
    const currentShortSha = currentSha ? currentSha.slice(0, 7) : null;
    const canSelfUpdate = isSelfUpdateConfigured();

    if (!repoConfig) {
        return NextResponse.json({
            status: true,
            message: "Verificação de atualizações desativada (UPDATE_REPO).",
            data: {
                enabled: false,
                currentSha,
                currentShortSha,
                hasUpdate: false,
                canSelfUpdate,
            },
        });
    }

    try {
        const result = await getLatestCommitAndBuildStatus(
            repoConfig.owner,
            repoConfig.repo,
            repoConfig.branch
        );

        if (!result) {
            return NextResponse.json(
                {
                    status: false,
                    message: "Não foi possível consultar o repositório no GitHub.",
                    error: "Could not fetch GitHub repository status",
                },
                { status: 502 }
            );
        }

        const { latestCommit, workflowRun, imageStatus } = result;
        const versionUnknown = !currentSha;
        const hasUpdate = isNewerCommitAvailable(currentSha, latestCommit.sha);

        if (createNotification && hasUpdate) {
            const title = `Nova atualização disponível: ${latestCommit.shortSha}`;
            const existing = await prisma.notification.findFirst({
                where: {
                    userId: user.id,
                    title,
                },
            });

            if (!existing) {
                const notification = await prisma.notification.create({
                    data: {
                        userId: user.id,
                        title,
                        message: `Uma nova versão (${latestCommit.shortSha}) de ${repoConfig.repo} está disponível no GitHub:\n${latestCommit.message}`,
                        type: "SYSTEM",
                        href: "/dashboard/settings",
                    },
                });

                const io = (global as any).io;
                if (io) {
                    io.to(`user:${user.id}`).emit("notification:new", {
                        id: notification.id,
                        userId: user.id,
                        title,
                        message: notification.message,
                        type: "SYSTEM",
                        href: "/dashboard/settings",
                        createdAt: notification.createdAt,
                    });
                }
            }
        }

        let message = "Seu sistema já está na versão mais recente.";
        if (versionUnknown) {
            message = `Último commit no GitHub: ${latestCommit.shortSha} (${latestCommit.message}).`;
        } else if (hasUpdate && imageStatus === "building") {
            message = `Nova versão ${latestCommit.shortSha} encontrada, mas o GitHub Actions ainda está compilando a imagem.`;
        } else if (hasUpdate) {
            message = `Nova versão disponível: ${latestCommit.shortSha} — ${latestCommit.message}`;
        }

        return NextResponse.json({
            status: true,
            message,
            data: {
                enabled: true,
                repo: repoConfig.fullName,
                branch: repoConfig.branch,
                currentSha,
                currentShortSha,
                versionUnknown,
                hasUpdate,
                imageStatus,
                latestCommit,
                workflowRun,
                canSelfUpdate,
            },
        });
    } catch (e) {
        console.error("[CheckUpdates] Error:", e);
        return NextResponse.json(
            { status: false, message: "Erro ao verificar atualizações", error: "Error checking updates" },
            { status: 500 }
        );
    }
}

export async function GET(req: NextRequest) {
    return handleCheckUpdates(req, false);
}

export async function POST(req: NextRequest) {
    return handleCheckUpdates(req, true);
}
