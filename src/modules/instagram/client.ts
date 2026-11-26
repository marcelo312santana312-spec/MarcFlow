import { getPublicBaseUrl, InstagramMediaItem, InstagramPostTypeValue } from "./validation";

export class InstagramApiError extends Error {
    public readonly status: number;
    public readonly code?: number;
    public readonly subcode?: number;

    constructor(message: string, status = 500, code?: number, subcode?: number) {
        super(message);
        this.name = "InstagramApiError";
        this.status = status;
        this.code = code;
        this.subcode = subcode;
    }
}

export interface InstagramOAuthConfig {
    appId: string;
    appSecret: string;
    redirectUri: string;
    graphVersion: string;
    isConfigured: boolean;
}

export function getInstagramOAuthConfig(): InstagramOAuthConfig {
    const appId = (process.env.INSTAGRAM_APP_ID || "").trim();
    const appSecret = (process.env.INSTAGRAM_APP_SECRET || "").trim();
    const graphVersion = (process.env.INSTAGRAM_GRAPH_VERSION || "v22.0").trim();
    const redirectUri = (
        process.env.INSTAGRAM_REDIRECT_URI || `${getPublicBaseUrl()}/api/instagram/callback`
    ).trim();

    return {
        appId,
        appSecret,
        redirectUri,
        graphVersion,
        isConfigured: Boolean(appId && appSecret),
    };
}

export function buildInstagramAuthorizeUrl(state: string): string {
    const cfg = getInstagramOAuthConfig();
    if (!cfg.isConfigured) {
        throw new Error("INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET não estão configurados no .env.");
    }
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("enable_fb_login", "0");
    url.searchParams.set("force_authentication", "1");
    url.searchParams.set("client_id", cfg.appId);
    url.searchParams.set("redirect_uri", cfg.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "instagram_business_basic,instagram_business_content_publish");
    url.searchParams.set("state", state);
    return url.toString();
}

async function parseMetaResponse<T = Record<string, any>>(res: Response): Promise<T> {
    const text = await res.text();
    let json: any = null;
    try {
        json = text ? JSON.parse(text) : {};
    } catch {
        if (!res.ok) {
            throw new InstagramApiError(`Resposta inválida da API do Instagram (HTTP ${res.status}): ${text}`, res.status);
        }
        throw new InstagramApiError("Resposta não-JSON da API do Instagram.", res.status);
    }

    if (!res.ok || json?.error) {
        const errObj = json?.error || {};
        const message =
            errObj.error_user_msg ||
            errObj.message ||
            json?.error_message ||
            `Erro na API do Instagram (HTTP ${res.status})`;
        const code = typeof errObj.code === "number" ? errObj.code : undefined;
        const subcode = typeof errObj.error_subcode === "number" ? errObj.error_subcode : undefined;
        throw new InstagramApiError(message, res.status, code, subcode);
    }

    return json as T;
}

export interface LongLivedTokenResult {
    accessToken: string;
    expiresIn: number;
    userId?: string;
}

/**
 * Troca o authorization code por um token de curta duração e em seguida pelo token de longa duração (60 dias).
 */
export async function exchangeCodeForLongLivedToken(
    code: string,
    fetchImpl: typeof fetch = fetch
): Promise<LongLivedTokenResult> {
    const cfg = getInstagramOAuthConfig();
    if (!cfg.isConfigured) {
        throw new Error("INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET não estão configurados.");
    }

    const body = new URLSearchParams({
        client_id: cfg.appId,
        client_secret: cfg.appSecret,
        grant_type: "authorization_code",
        redirect_uri: cfg.redirectUri,
        code,
    });

    const shortRes = await fetchImpl("https://api.instagram.com/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });
    const shortData = await parseMetaResponse<{ access_token?: string; user_id?: string | number }>(shortRes);
    if (!shortData.access_token) {
        throw new InstagramApiError("API do Instagram não retornou access_token.", 502);
    }

    const longUrl = new URL("https://graph.instagram.com/access_token");
    longUrl.searchParams.set("grant_type", "ig_exchange_token");
    longUrl.searchParams.set("client_secret", cfg.appSecret);
    longUrl.searchParams.set("access_token", shortData.access_token);

    const longRes = await fetchImpl(longUrl.toString(), { method: "GET" });
    const longData = await parseMetaResponse<{ access_token?: string; expires_in?: number }>(longRes);

    return {
        accessToken: longData.access_token || shortData.access_token,
        expiresIn: typeof longData.expires_in === "number" ? longData.expires_in : 60 * 24 * 3600,
        userId: shortData.user_id !== undefined ? String(shortData.user_id) : undefined,
    };
}

/**
 * Renova um token de longa duração (válido por mais 60 dias).
 */
export async function refreshLongLivedToken(
    accessToken: string,
    fetchImpl: typeof fetch = fetch
): Promise<LongLivedTokenResult> {
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", accessToken);

    const res = await fetchImpl(url.toString(), { method: "GET" });
    const data = await parseMetaResponse<{ access_token?: string; expires_in?: number }>(res);
    if (!data.access_token) {
        throw new InstagramApiError("Falha ao renovar token do Instagram.", 502);
    }
    return {
        accessToken: data.access_token,
        expiresIn: typeof data.expires_in === "number" ? data.expires_in : 60 * 24 * 3600,
    };
}

export interface InstagramProfile {
    igUserId: string;
    username: string;
    name?: string;
    accountType?: string;
    profilePictureUrl?: string;
}

/**
 * Busca os dados da conta profissional conectada.
 */
export async function fetchInstagramProfile(
    accessToken: string,
    fetchImpl: typeof fetch = fetch
): Promise<InstagramProfile> {
    const { graphVersion } = getInstagramOAuthConfig();
    const url = new URL(`https://graph.instagram.com/${graphVersion}/me`);
    url.searchParams.set("fields", "user_id,username,name,account_type,profile_picture_url");
    url.searchParams.set("access_token", accessToken);

    const res = await fetchImpl(url.toString(), { method: "GET" });
    const data = await parseMetaResponse<{
        id?: string;
        user_id?: string;
        username?: string;
        name?: string;
        account_type?: string;
        profile_picture_url?: string;
    }>(res);

    const igUserId = String(data.user_id || data.id || "");
    if (!igUserId || !data.username) {
        throw new InstagramApiError("Não foi possível obter user_id/username da conta Instagram.", 502);
    }

    return {
        igUserId,
        username: data.username,
        name: data.name,
        accountType: data.account_type,
        profilePictureUrl: data.profile_picture_url,
    };
}

async function createMediaContainer(
    igUserId: string,
    accessToken: string,
    graphVersion: string,
    payload: Record<string, string>,
    fetchImpl: typeof fetch
): Promise<string> {
    const url = `https://graph.instagram.com/${graphVersion}/${encodeURIComponent(igUserId)}/media`;
    const body = new URLSearchParams({ ...payload, access_token: accessToken });
    const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });
    const data = await parseMetaResponse<{ id?: string }>(res);
    if (!data.id) {
        throw new InstagramApiError("Meta API não retornou container ID.", 502);
    }
    return data.id;
}

async function waitForContainerReady(
    containerId: string,
    accessToken: string,
    graphVersion: string,
    fetchImpl: typeof fetch,
    pollIntervalMs: number,
    maxPollAttempts: number
): Promise<void> {
    for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
        const url = new URL(`https://graph.instagram.com/${graphVersion}/${encodeURIComponent(containerId)}`);
        url.searchParams.set("fields", "status_code,status");
        url.searchParams.set("access_token", accessToken);

        const res = await fetchImpl(url.toString(), { method: "GET" });
        const data = await parseMetaResponse<{ status_code?: string; status?: string }>(res);
        const code = (data.status_code || "").toUpperCase();

        if (code === "FINISHED" || code === "PUBLISHED") {
            return;
        }
        if (code === "ERROR" || code === "EXPIRED") {
            throw new InstagramApiError(
                `Processamento da mídia falhou na Meta (${code}${data.status ? `: ${data.status}` : ""}).`,
                502
            );
        }

        if (attempt < maxPollAttempts - 1 && pollIntervalMs > 0) {
            await new Promise((r) => setTimeout(r, pollIntervalMs));
        }
    }

    throw new InstagramApiError("Tempo limite excedido aguardando processamento da mídia pela Meta.", 504);
}

export interface PublishInstagramParams {
    igUserId: string;
    accessToken: string;
    type: InstagramPostTypeValue;
    caption?: string | null;
    mediaItems: Array<InstagramMediaItem & { publicUrl: string }>;
    shareToFeed?: boolean;
}

export interface PublishInstagramResult {
    containerId: string;
    mediaId: string;
    permalink?: string;
}

/**
 * Cria containers, aguarda processamento (vídeos/carrossel) e publica no Instagram (Feed, Carrossel, Reels ou Story).
 */
export async function publishInstagramPost(
    params: PublishInstagramParams,
    options?: {
        fetchImpl?: typeof fetch;
        pollIntervalMs?: number;
        maxPollAttempts?: number;
    }
): Promise<PublishInstagramResult> {
    const fetchImpl = options?.fetchImpl ?? fetch;
    const pollIntervalMs = options?.pollIntervalMs ?? 3000;
    const maxPollAttempts = options?.maxPollAttempts ?? 40;
    const { graphVersion } = getInstagramOAuthConfig();

    const { igUserId, accessToken, type, caption, mediaItems, shareToFeed = true } = params;
    let mainContainerId = "";

    if (type === "FEED") {
        const item = mediaItems[0];
        if (item.mediaType === "IMAGE") {
            const payload: Record<string, string> = { image_url: item.publicUrl };
            if (caption) payload.caption = caption;
            mainContainerId = await createMediaContainer(igUserId, accessToken, graphVersion, payload, fetchImpl);
        } else {
            const payload: Record<string, string> = {
                media_type: "REELS",
                video_url: item.publicUrl,
                share_to_feed: "true",
            };
            if (caption) payload.caption = caption;
            mainContainerId = await createMediaContainer(igUserId, accessToken, graphVersion, payload, fetchImpl);
            await waitForContainerReady(mainContainerId, accessToken, graphVersion, fetchImpl, pollIntervalMs, maxPollAttempts);
        }
    } else if (type === "STORY") {
        const item = mediaItems[0];
        const payload: Record<string, string> = { media_type: "STORIES" };
        if (item.mediaType === "IMAGE") {
            payload.image_url = item.publicUrl;
            mainContainerId = await createMediaContainer(igUserId, accessToken, graphVersion, payload, fetchImpl);
        } else {
            payload.video_url = item.publicUrl;
            mainContainerId = await createMediaContainer(igUserId, accessToken, graphVersion, payload, fetchImpl);
            await waitForContainerReady(mainContainerId, accessToken, graphVersion, fetchImpl, pollIntervalMs, maxPollAttempts);
        }
    } else if (type === "REELS") {
        const item = mediaItems[0];
        const payload: Record<string, string> = {
            media_type: "REELS",
            video_url: item.publicUrl,
            share_to_feed: shareToFeed ? "true" : "false",
        };
        if (caption) payload.caption = caption;
        mainContainerId = await createMediaContainer(igUserId, accessToken, graphVersion, payload, fetchImpl);
        await waitForContainerReady(mainContainerId, accessToken, graphVersion, fetchImpl, pollIntervalMs, maxPollAttempts);
    } else if (type === "CAROUSEL") {
        const childIds: string[] = [];
        for (const item of mediaItems) {
            const childPayload: Record<string, string> = { is_carousel_item: "true" };
            if (item.mediaType === "IMAGE") {
                childPayload.image_url = item.publicUrl;
                const cid = await createMediaContainer(igUserId, accessToken, graphVersion, childPayload, fetchImpl);
                childIds.push(cid);
            } else {
                childPayload.media_type = "VIDEO";
                childPayload.video_url = item.publicUrl;
                const cid = await createMediaContainer(igUserId, accessToken, graphVersion, childPayload, fetchImpl);
                await waitForContainerReady(cid, accessToken, graphVersion, fetchImpl, pollIntervalMs, maxPollAttempts);
                childIds.push(cid);
            }
        }

        const parentPayload: Record<string, string> = {
            media_type: "CAROUSEL",
            children: childIds.join(","),
        };
        if (caption) parentPayload.caption = caption;
        mainContainerId = await createMediaContainer(igUserId, accessToken, graphVersion, parentPayload, fetchImpl);
        await waitForContainerReady(mainContainerId, accessToken, graphVersion, fetchImpl, pollIntervalMs, maxPollAttempts);
    } else {
        throw new InstagramApiError(`Tipo de publicação não suportado: ${type}`, 400);
    }

    const publishUrl = `https://graph.instagram.com/${graphVersion}/${encodeURIComponent(igUserId)}/media_publish`;
    const publishBody = new URLSearchParams({
        creation_id: mainContainerId,
        access_token: accessToken,
    });
    const publishRes = await fetchImpl(publishUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: publishBody.toString(),
    });
    const publishData = await parseMetaResponse<{ id?: string }>(publishRes);
    if (!publishData.id) {
        throw new InstagramApiError("Meta API não retornou o ID da publicação final.", 502);
    }

    let permalink: string | undefined;
    try {
        const linkUrl = new URL(`https://graph.instagram.com/${graphVersion}/${encodeURIComponent(publishData.id)}`);
        linkUrl.searchParams.set("fields", "permalink");
        linkUrl.searchParams.set("access_token", accessToken);
        const linkRes = await fetchImpl(linkUrl.toString(), { method: "GET" });
        const linkData = await parseMetaResponse<{ permalink?: string }>(linkRes);
        permalink = linkData.permalink;
    } catch {
        // Best effort: permalink pode não estar disponível imediatamente
    }

    return {
        containerId: mainContainerId,
        mediaId: publishData.id,
        permalink,
    };
}
