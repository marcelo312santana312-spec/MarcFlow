import crypto from "crypto";

export * from "./config";
export * from "./ssrf";
export * from "./url-validator";
export * from "./generators";
export * from "./processor";

/**
 * Verifica a autenticidade da assinatura HMAC-SHA256 (`X-Webhook-Signature: sha256=<hex>`)
 * usando comparação em tempo constante (`crypto.timingSafeEqual`).
 */
export function verifyWebhookHmacSignature(
    rawBody: string,
    signatureHeader: string | null | undefined,
    secret: string | null | undefined
): boolean {
    if (!rawBody || !signatureHeader || !secret) return false;
    const trimmedHeader = signatureHeader.trim();
    const prefix = "sha256=";
    const providedHex = trimmedHeader.startsWith(prefix)
        ? trimmedHeader.slice(prefix.length)
        : trimmedHeader;

    if (!/^[0-9a-f]{64}$/i.test(providedHex)) return false;

    const expectedHex = crypto
        .createHmac("sha256", secret)
        .update(rawBody, "utf8")
        .digest("hex");

    const providedBuf = Buffer.from(providedHex.toLowerCase(), "hex");
    const expectedBuf = Buffer.from(expectedHex.toLowerCase(), "hex");
    if (providedBuf.length !== expectedBuf.length) return false;

    return crypto.timingSafeEqual(providedBuf, expectedBuf);
}
