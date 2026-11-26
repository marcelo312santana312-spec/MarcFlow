import crypto from "crypto";
import path from "path";

export interface DriveFileEntry {
    id: string;
    name: string;
    mimeType: string;
    description?: string;
    sizeBytes?: number;
    mediaType: "IMAGE" | "VIDEO" | "TEXT";
}

export interface ParsedDriveMetadata {
    caption?: string;
    productUrl?: string;
    priceText?: string;
    couponCode?: string;
}

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".mov"]);
const MAX_DRIVE_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Extrai o ID de uma pasta do Google Drive a partir da URL compartilhada ou do próprio ID.
 */
export function extractGoogleDriveFolderId(input: string): string | null {
    const trimmed = (input || "").trim();
    if (!trimmed) return null;

    if (/^[a-zA-Z0-9_-]{15,80}$/.test(trimmed)) {
        return trimmed;
    }

    try {
        const parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
        const host = parsed.hostname.toLowerCase();
        if (host !== "drive.google.com" && host !== "docs.google.com") {
            return null;
        }

        const folderMatch = parsed.pathname.match(/\/folders\/([a-zA-Z0-9_-]{10,80})/);
        if (folderMatch) return folderMatch[1];

        const idParam = parsed.searchParams.get("id");
        if (idParam && /^[a-zA-Z0-9_-]{10,80}$/.test(idParam)) {
            return idParam;
        }
    } catch {
        return null;
    }

    return null;
}

export function classifyDriveFile(name: string, mimeType = ""): "IMAGE" | "VIDEO" | "TEXT" | null {
    const ext = path.extname(name || "").toLowerCase();
    const mime = (mimeType || "").toLowerCase();

    if (mime.startsWith("image/") || IMAGE_EXTS.has(ext)) {
        if (ext === ".gif" || ext === ".svg") return null;
        return "IMAGE";
    }
    if (mime.startsWith("video/") || VIDEO_EXTS.has(ext)) {
        return "VIDEO";
    }
    if (mime === "text/plain" || ext === ".txt") {
        return "TEXT";
    }
    return null;
}

export function baseMediaKey(filename: string): string {
    const parsed = path.parse((filename || "").trim().toLowerCase());
    return parsed.name;
}

/**
 * Extrai legenda, preço, cupom e link de produto de um texto livre (.txt sidecar ou descrição no Drive).
 */
export function parseMetadataText(rawText: string): ParsedDriveMetadata {
    const text = (rawText || "").trim();
    if (!text) return {};

    const urlMatch = text.match(/https?:\/\/[^\s<>"')]+/i);
    const priceMatch = text.match(/R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/i);
    const couponMatch = text.match(/(?:cupom|c[oó]digo)\s*[:=]\s*([a-zA-Z0-9_-]{3,30})/i);

    return {
        caption: text,
        productUrl: urlMatch ? urlMatch[0].replace(/[.,;!?]+$/, "") : undefined,
        priceText: priceMatch ? priceMatch[0].replace(/\s+/g, " ") : undefined,
        couponCode: couponMatch ? couponMatch[1].toUpperCase() : undefined,
    };
}

/**
 * Faz o parse da página pública embeddedfolderview do Google Drive quando não há GOOGLE_DRIVE_API_KEY.
 */
export function parseEmbeddedFolderHtml(html: string): DriveFileEntry[] {
    const entries: DriveFileEntry[] = [];
    const seen = new Set<string>();

    // Padrão típico do embeddedfolderview: id="entry-<FILE_ID>" ... <div class="flip-entry-title">nome.mp4</div>
    const entryRegex = /id="entry-([a-zA-Z0-9_-]{15,80})"[\s\S]*?<div class="flip-entry-title">([^<]+)<\/div>/gi;
    let match: RegExpExecArray | null;
    while ((match = entryRegex.exec(html)) !== null) {
        const id = match[1];
        const name = decodeHtmlEntities(match[2].trim());
        if (!id || !name || seen.has(id)) continue;
        const kind = classifyDriveFile(name);
        if (!kind) continue;
        seen.add(id);
        entries.push({
            id,
            name,
            mimeType: guessMimeFromName(name, kind),
            mediaType: kind,
        });
    }

    // Fallback secundário para markup alternativo (/file/d/ID/ ... title)
    if (entries.length === 0) {
        const altRegex = /\/file\/d\/([a-zA-Z0-9_-]{15,80})\/[^"']*["'][^>]*>([^<]{3,160}\.(?:jpg|jpeg|png|webp|mp4|mov|txt))</gi;
        while ((match = altRegex.exec(html)) !== null) {
            const id = match[1];
            const name = decodeHtmlEntities(match[2].trim());
            if (!id || !name || seen.has(id)) continue;
            const kind = classifyDriveFile(name);
            if (!kind) continue;
            seen.add(id);
            entries.push({
                id,
                name,
                mimeType: guessMimeFromName(name, kind),
                mediaType: kind,
            });
        }
    }

    return entries;
}

function decodeHtmlEntities(str: string): string {
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function guessMimeFromName(name: string, kind: "IMAGE" | "VIDEO" | "TEXT"): string {
    const ext = path.extname(name).toLowerCase();
    if (kind === "TEXT") return "text/plain";
    if (ext === ".png") return "image/png";
    if (ext === ".webp") return "image/webp";
    if (ext === ".mov") return "video/quicktime";
    if (ext === ".mp4") return "video/mp4";
    return kind === "VIDEO" ? "video/mp4" : "image/jpeg";
}

/**
 * Lista arquivos suportados (imagens, vídeos e .txt) de uma pasta pública do Google Drive.
 */
export async function listGoogleDriveFolderFiles(
    folderId: string,
    fetchImpl: typeof fetch = fetch
): Promise<DriveFileEntry[]> {
    const apiKey = (process.env.GOOGLE_DRIVE_API_KEY || "").trim();

    if (apiKey) {
        const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
        const fields = encodeURIComponent("files(id,name,mimeType,description,size,modifiedTime)");
        const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=modifiedTime%20desc&pageSize=60&key=${encodeURIComponent(apiKey)}`;
        const res = await fetchImpl(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
        if (!res.ok) {
            const errTxt = await res.text().catch(() => "");
            throw new Error(`Erro na Google Drive API (${res.status}): ${errTxt || res.statusText}`);
        }
        const json = await res.json();
        const files = Array.isArray(json?.files) ? json.files : [];
        const entries: DriveFileEntry[] = [];
        for (const f of files) {
            const kind = classifyDriveFile(String(f.name || ""), String(f.mimeType || ""));
            if (!kind) continue;
            entries.push({
                id: String(f.id),
                name: String(f.name),
                mimeType: String(f.mimeType || guessMimeFromName(String(f.name || ""), kind)),
                description: typeof f.description === "string" ? f.description : undefined,
                sizeBytes: f.size ? Number(f.size) : undefined,
                mediaType: kind,
            });
        }
        return entries;
    }

    const embedUrl = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#list`;
    const res = await fetchImpl(embedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 MarcFlowDriveSync/1.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
        throw new Error(
            `Não foi possível acessar a pasta do Google Drive (HTTP ${res.status}). Verifique se a pasta está compartilhada como "Qualquer pessoa com o link (Leitor)".`
        );
    }

    const html = await res.text();
    if (/accounts\.google\.com\/ServiceLogin/i.test(res.url || "") || /Sign in - Google Accounts/i.test(html)) {
        throw new Error(
            'Esta pasta do Google Drive parece privada. Altere o compartilhamento para "Qualquer pessoa com o link (Leitor)".'
        );
    }

    return parseEmbeddedFolderHtml(html);
}

/**
 * Baixa um arquivo público do Google Drive com limite de segurança (100 MB).
 */
export async function downloadGoogleDriveFile(
    fileId: string,
    fetchImpl: typeof fetch = fetch
): Promise<{ buffer: Buffer; contentType: string }> {
    const apiKey = (process.env.GOOGLE_DRIVE_API_KEY || "").trim();
    const initialUrl = apiKey
        ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${encodeURIComponent(apiKey)}`
        : `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;

    let res = await fetchImpl(initialUrl, {
        headers: { "User-Agent": "Mozilla/5.0 MarcFlowDriveSync/1.0" },
        redirect: "follow",
        signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
        throw new Error(`Falha ao baixar arquivo ${fileId} do Drive (HTTP ${res.status}).`);
    }

    let contentType = res.headers.get("content-type") || "application/octet-stream";

    // Para arquivos maiores sem API Key, o Drive pode retornar HTML de confirmação de vírus
    if (!apiKey && contentType.includes("text/html")) {
        const html = await res.text();
        const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/i);
        const confirmMatch = html.match(/name="confirm"\s+value="([^"]+)"/i);
        const retryUrl = new URL("https://drive.usercontent.google.com/download");
        retryUrl.searchParams.set("id", fileId);
        retryUrl.searchParams.set("export", "download");
        retryUrl.searchParams.set("confirm", confirmMatch?.[1] || "t");
        if (uuidMatch?.[1]) retryUrl.searchParams.set("uuid", uuidMatch[1]);

        res = await fetchImpl(retryUrl.toString(), {
            headers: { "User-Agent": "Mozilla/5.0 MarcFlowDriveSync/1.0" },
            redirect: "follow",
            signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) {
            throw new Error(`Falha ao baixar arquivo grande ${fileId} do Drive (HTTP ${res.status}).`);
        }
        contentType = res.headers.get("content-type") || "application/octet-stream";
        if (contentType.includes("text/html")) {
            throw new Error(
                `O arquivo ${fileId} exige autenticação do Google ou está privado. Defina GOOGLE_DRIVE_API_KEY no .env ou torne o arquivo público.`
            );
        }
    }

    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_DRIVE_DOWNLOAD_BYTES) {
        throw new Error(`Arquivo ${fileId} excede o limite máximo de 100 MB.`);
    }

    return { buffer: Buffer.from(ab), contentType };
}

export function generateSafeMediaFilename(originalName: string, mimeType: string): string {
    const parsed = path.parse(originalName || "media");
    let ext = parsed.ext.toLowerCase();
    if (!IMAGE_EXTS.has(ext) && !VIDEO_EXTS.has(ext)) {
        if (mimeType.includes("png")) ext = ".png";
        else if (mimeType.includes("webp")) ext = ".webp";
        else if (mimeType.includes("quicktime")) ext = ".mov";
        else if (mimeType.includes("video")) ext = ".mp4";
        else ext = ".jpg";
    }
    return `ap_${Date.now()}_${crypto.randomBytes(5).toString("hex")}${ext}`;
}
