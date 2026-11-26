export type InstagramPostTypeValue = "FEED" | "CAROUSEL" | "REELS" | "STORY";

export interface InstagramMediaItem {
    filename?: string;
    url?: string;
    mediaType: "IMAGE" | "VIDEO";
    mimeType?: string;
}

export interface CreateInstagramPostInput {
    accountId: string;
    type: InstagramPostTypeValue;
    caption?: string | null;
    mediaItems: InstagramMediaItem[];
    shareToFeed?: boolean;
    scheduledAt?: string | Date;
    publishNow?: boolean;
}

const VALID_TYPES: ReadonlySet<string> = new Set(["FEED", "CAROUSEL", "REELS", "STORY"]);

/**
 * Retorna a URL base pública configurada sem barra final.
 */
export function getPublicBaseUrl(): string {
    const raw = process.env.BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3030";
    return raw.trim().replace(/\/+$/, "");
}

/**
 * Verifica se a URL é HTTPS pública (não localhost ou loopback).
 */
export function isPublicHttpsUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") return false;
        const host = parsed.hostname.toLowerCase();
        if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Valida os dados de entrada para criação ou atualização de um agendamento no Instagram.
 */
export function validateInstagramPostInput(
    input: CreateInstagramPostInput
): { ok: true; data: CreateInstagramPostInput & { scheduledAtDate: Date } } | { ok: false; error: string } {
    if (!input.accountId || typeof input.accountId !== "string" || !input.accountId.trim()) {
        return { ok: false, error: "Selecione uma conta do Instagram." };
    }

    if (!input.type || !VALID_TYPES.has(input.type)) {
        return { ok: false, error: "Tipo de publicação inválido. Use FEED, CAROUSEL, REELS ou STORY." };
    }

    const caption = typeof input.caption === "string" ? input.caption : "";
    if (caption.length > 2200) {
        return { ok: false, error: "A legenda deve ter no máximo 2.200 caracteres." };
    }

    if (!Array.isArray(input.mediaItems) || input.mediaItems.length === 0) {
        return { ok: false, error: "Envie pelo menos uma mídia para publicar." };
    }

    for (let i = 0; i < input.mediaItems.length; i++) {
        const item = input.mediaItems[i];
        if (!item || (item.mediaType !== "IMAGE" && item.mediaType !== "VIDEO")) {
            return { ok: false, error: `Tipo de mídia inválido no item ${i + 1}.` };
        }
        const hasFilename = typeof item.filename === "string" && item.filename.trim().length > 0;
        const hasUrl = typeof item.url === "string" && item.url.trim().length > 0;
        if (!hasFilename && !hasUrl) {
            return { ok: false, error: `Mídia ${i + 1} sem arquivo ou URL válida.` };
        }
        if (hasFilename && (item.filename!.includes("..") || item.filename!.includes("/") || item.filename!.includes("\\"))) {
            return { ok: false, error: `Nome de arquivo inválido no item ${i + 1}.` };
        }
        if (!hasFilename && hasUrl && !isPublicHttpsUrl(item.url!)) {
            return { ok: false, error: `A URL externa do item ${i + 1} precisa ser HTTPS pública.` };
        }
    }

    if (input.type === "FEED" && input.mediaItems.length !== 1) {
        return { ok: false, error: "Publicações de Feed simples exigem exatamente 1 mídia." };
    }

    if (input.type === "STORY" && input.mediaItems.length !== 1) {
        return { ok: false, error: "Stories exigem exatamente 1 imagem ou 1 vídeo." };
    }

    if (input.type === "REELS") {
        if (input.mediaItems.length !== 1 || input.mediaItems[0].mediaType !== "VIDEO") {
            return { ok: false, error: "Reels exige exatamente 1 vídeo (MP4/MOV)." };
        }
    }

    if (input.type === "CAROUSEL") {
        if (input.mediaItems.length < 2 || input.mediaItems.length > 10) {
            return { ok: false, error: "Carrossel exige entre 2 e 10 mídias." };
        }
    }

    let scheduledAtDate: Date;
    if (input.publishNow) {
        scheduledAtDate = new Date();
    } else {
        if (!input.scheduledAt) {
            return { ok: false, error: "Informe a data e hora do agendamento." };
        }
        scheduledAtDate = input.scheduledAt instanceof Date ? input.scheduledAt : new Date(input.scheduledAt);
        if (Number.isNaN(scheduledAtDate.getTime())) {
            return { ok: false, error: "Data/hora de agendamento inválida." };
        }
    }

    return {
        ok: true,
        data: {
            accountId: input.accountId.trim(),
            type: input.type,
            caption,
            mediaItems: input.mediaItems,
            shareToFeed: input.shareToFeed ?? true,
            scheduledAt: scheduledAtDate,
            scheduledAtDate,
            publishNow: Boolean(input.publishNow),
        },
    };
}
