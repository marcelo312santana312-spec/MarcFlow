import crypto from "crypto";

function getSecretKey(): Buffer {
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
        throw new Error("AUTH_SECRET não está definida no ambiente.");
    }
    return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Criptografa um token usando AES-256-GCM.
 */
export function encryptToken(plain: string): string {
    const key = getSecretKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `v1:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Descriptografa um token criptografado por encryptToken.
 */
export function decryptToken(encrypted: string): string {
    const parts = encrypted.split(":");
    if (parts.length !== 4 || parts[0] !== "v1") {
        throw new Error("Formato de token criptografado inválido.");
    }
    const [, ivHex, tagHex, cipherHex] = parts;
    const key = getSecretKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");
    const ciphertext = Buffer.from(cipherHex, "hex");
    if (iv.length !== 12 || authTag.length !== 16) {
        throw new Error("Parâmetros de criptografia inválidos.");
    }
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
}

function hmacSign(payload: string): string {
    return crypto.createHmac("sha256", getSecretKey()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Gera state assinado via HMAC-SHA256 para o fluxo OAuth do Instagram.
 */
export function createOAuthState(userId: string, ttlSeconds = 600): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const nonce = crypto.randomBytes(12).toString("hex");
    const payload = Buffer.from(JSON.stringify({ userId, exp, nonce }), "utf8").toString("base64url");
    const sig = hmacSign(payload);
    return `${payload}.${sig}`;
}

/**
 * Verifica assinatura e expiração do state OAuth do Instagram.
 */
export function verifyOAuthState(state: string): { userId: string } | null {
    try {
        const parts = state.split(".");
        if (parts.length !== 2) return null;
        const [payload, sig] = parts;
        const expected = hmacSign(payload);
        if (!safeEqual(sig, expected)) return null;
        const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
            userId?: string;
            exp?: number;
        };
        if (!parsed?.userId || typeof parsed.exp !== "number") return null;
        if (Math.floor(Date.now() / 1000) > parsed.exp) return null;
        return { userId: parsed.userId };
    } catch {
        return null;
    }
}

/**
 * Gera parâmetros exp e sig para acesso público temporário a arquivos de mídia do Instagram.
 */
export function signMediaPath(filename: string, ttlSeconds = 7200): { exp: number; sig: string } {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = hmacSign(`media:${filename}:${exp}`);
    return { exp, sig };
}

/**
 * Valida assinatura e validade de uma URL de mídia assinada.
 */
export function verifyMediaSignature(filename: string, exp: number, sig: string): boolean {
    try {
        if (!filename || !sig || !Number.isFinite(exp)) return false;
        if (Math.floor(Date.now() / 1000) > exp) return false;
        const expected = hmacSign(`media:${filename}:${exp}`);
        return safeEqual(sig, expected);
    } catch {
        return false;
    }
}
