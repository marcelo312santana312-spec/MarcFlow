import path from "path";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { decryptToken, encryptToken, signMediaPath } from "./crypto";
import { InstagramApiError, publishInstagramPost, refreshLongLivedToken } from "./client";
import { getPublicBaseUrl, InstagramMediaItem, InstagramPostTypeValue, isPublicHttpsUrl } from "./validation";

export const INSTAGRAM_MEDIA_DIR = path.join(process.cwd(), "data", "instagram-media");

/**
 * Gera URL assinada para o endpoint /api/instagram/media/[filename].
 */
export function buildSignedMediaUrl(filename: string, baseUrl?: string, ttlSeconds = 7200): string {
    const { exp, sig } = signMediaPath(filename, ttlSeconds);
    const relative = `/api/instagram/media/${encodeURIComponent(filename)}?exp=${exp}&sig=${encodeURIComponent(sig)}`;
    if (!baseUrl) return relative;
    return `${baseUrl.replace(/\/+$/, "")}${relative}`;
}

export function attachPreviewUrls(mediaItems: unknown): Array<InstagramMediaItem & { previewUrl: string }> {
    if (!Array.isArray(mediaItems)) return [];
    return mediaItems.map((raw) => {
        const item = raw as InstagramMediaItem;
        const previewUrl = item.filename ? buildSignedMediaUrl(item.filename) : item.url || "";
        return { ...item, previewUrl };
    });
}

/**
 * Publica imediatamente um post agendado no Instagram pelo ID, garantindo lock otimista contra execução dupla.
 */
export async function publishScheduledPostById(postId: string) {
    const claim = await prisma.instagramPost.updateMany({
        where: {
            id: postId,
            status: { in: ["PENDING", "FAILED"] },
        },
        data: {
            status: "PUBLISHING",
            errorMessage: null,
        },
    });

    if (claim.count === 0) {
        return await prisma.instagramPost.findUnique({
            where: { id: postId },
            include: {
                account: {
                    select: { id: true, username: true, name: true, profilePictureUrl: true, status: true },
                },
            },
        });
    }

    const post = await prisma.instagramPost.findUnique({
        where: { id: postId },
        include: { account: true },
    });

    if (!post) return null;

    try {
        const accessToken = decryptToken(post.account.accessToken);
        const rawItems = Array.isArray(post.mediaItems) ? (post.mediaItems as unknown as InstagramMediaItem[]) : [];

        if (rawItems.length === 0) {
            throw new Error("Nenhuma mídia associada a este agendamento.");
        }

        const publicBaseUrl = getPublicBaseUrl();
        const resolvedItems = rawItems.map((item) => {
            if (item.filename) {
                if (!isPublicHttpsUrl(publicBaseUrl)) {
                    throw new Error(
                        `A URL base (${publicBaseUrl}) não é HTTPS pública. Configure BASE_URL com seu domínio HTTPS (ex.: Cloudflare Tunnel) para a Meta baixar a mídia.`
                    );
                }
                return {
                    ...item,
                    publicUrl: buildSignedMediaUrl(item.filename, publicBaseUrl, 7200),
                };
            }
            if (item.url && isPublicHttpsUrl(item.url)) {
                return { ...item, publicUrl: item.url };
            }
            throw new Error("Mídia sem URL HTTPS pública válida.");
        });

        const result = await publishInstagramPost({
            igUserId: post.account.igUserId,
            accessToken,
            type: post.type as InstagramPostTypeValue,
            caption: post.caption,
            mediaItems: resolvedItems,
            shareToFeed: post.shareToFeed,
        });

        const updated = await prisma.instagramPost.update({
            where: { id: post.id },
            data: {
                status: "PUBLISHED",
                igContainerId: result.containerId,
                igMediaId: result.mediaId,
                permalink: result.permalink || null,
                publishedAt: new Date(),
                errorMessage: null,
            },
            include: {
                account: {
                    select: { id: true, username: true, name: true, profilePictureUrl: true, status: true },
                },
            },
        });

        logger.info("Instagram", `Post ${post.id} (${post.type}) publicado em @${post.account.username} (mediaId=${result.mediaId})`);
        return updated;
    } catch (err: any) {
        const errorMessage = err?.message || "Erro desconhecido ao publicar no Instagram.";
        logger.error("Instagram", `Falha ao publicar post ${post.id}:`, errorMessage);

        if (err instanceof InstagramApiError && err.code === 190) {
            await prisma.instagramAccount
                .update({
                    where: { id: post.accountId },
                    data: { status: "EXPIRED", lastError: errorMessage },
                })
                .catch(() => {});
        }

        return await prisma.instagramPost.update({
            where: { id: post.id },
            data: {
                status: "FAILED",
                errorMessage,
                retryCount: { increment: 1 },
            },
            include: {
                account: {
                    select: { id: true, username: true, name: true, profilePictureUrl: true, status: true },
                },
            },
        });
    }
}

const gIgScheduler = globalThis as unknown as {
    __instagramSchedulerInterval?: ReturnType<typeof setInterval>;
    __instagramSchedulerRunning?: boolean;
    __instagramLastTokenRefreshAt?: number;
};

async function refreshExpiringTokensIfNeeded() {
    const nowMs = Date.now();
    const oneHourMs = 60 * 60 * 1000;
    if (gIgScheduler.__instagramLastTokenRefreshAt && nowMs - gIgScheduler.__instagramLastTokenRefreshAt < oneHourMs) {
        return;
    }
    gIgScheduler.__instagramLastTokenRefreshAt = nowMs;

    const sevenDaysFromNow = new Date(nowMs + 7 * 24 * 3600 * 1000);
    const expiringAccounts = await prisma.instagramAccount.findMany({
        where: {
            status: "CONNECTED",
            tokenExpiresAt: { lte: sevenDaysFromNow },
        },
        take: 10,
    });

    for (const acc of expiringAccounts) {
        try {
            const currentToken = decryptToken(acc.accessToken);
            const refreshed = await refreshLongLivedToken(currentToken);
            await prisma.instagramAccount.update({
                where: { id: acc.id },
                data: {
                    accessToken: encryptToken(refreshed.accessToken),
                    tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
                    status: "CONNECTED",
                    lastError: null,
                },
            });
            logger.info("Instagram", `Token da conta @${acc.username} renovado automaticamente.`);
        } catch (err: any) {
            const msg = err?.message || "Erro ao renovar token.";
            logger.warn("Instagram", `Falha ao renovar token de @${acc.username}: ${msg}`);
            if (err instanceof InstagramApiError && err.code === 190) {
                await prisma.instagramAccount
                    .update({
                        where: { id: acc.id },
                        data: { status: "EXPIRED", lastError: msg },
                    })
                    .catch(() => {});
            }
        }
    }
}

/**
 * Executa uma rodada do agendador do Instagram (publica pendentes vencidos e renova tokens próximos do vencimento).
 */
export async function runInstagramSchedulerTick(): Promise<void> {
    if (gIgScheduler.__instagramSchedulerRunning) return;
    gIgScheduler.__instagramSchedulerRunning = true;
    try {
        const now = new Date();
        const duePosts = await prisma.instagramPost.findMany({
            where: {
                status: "PENDING",
                scheduledAt: { lte: now },
            },
            orderBy: { scheduledAt: "asc" },
            take: 5,
            select: { id: true },
        });

        for (const post of duePosts) {
            await publishScheduledPostById(post.id);
        }

        await refreshExpiringTokensIfNeeded();
    } catch (err) {
        logger.error("Instagram", "Erro no loop de agendamento do Instagram:", err);
    } finally {
        gIgScheduler.__instagramSchedulerRunning = false;
    }
}

/**
 * Inicia o worker agendador do Instagram (deve ser chamado apenas no entrypoint do servidor).
 */
export function startInstagramScheduler(): void {
    if (gIgScheduler.__instagramSchedulerInterval) {
        clearInterval(gIgScheduler.__instagramSchedulerInterval);
        gIgScheduler.__instagramSchedulerInterval = undefined;
    }

    logger.info("Instagram", "Starting Instagram Post & Story Scheduler (30s interval)...");
    void runInstagramSchedulerTick();
    gIgScheduler.__instagramSchedulerInterval = setInterval(() => {
        void runInstagramSchedulerTick();
    }, 30 * 1000);
}
