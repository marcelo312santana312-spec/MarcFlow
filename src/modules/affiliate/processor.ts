import { prisma } from "@/lib/prisma";
import {
    AFFILIATE_LIMITS,
    AffiliatePlatform,
    renderAffiliateTemplate,
    resolveAffiliateEnv,
    resolveAffiliateTemplates,
    StoredAffiliateSettings,
} from "./config";
import {
    extractUrlsFromText,
    validateAndResolveCandidateUrl,
    ValidatedUrlResult,
    ValidatorDependencies,
} from "./url-validator";
import {
    AffiliateGenerationResult,
    AffiliateGenerator,
    createMercadoLivreAffiliateGenerator,
    createShopeeAffiliateGenerator,
} from "./generators";
import { redactUrlForLog } from "./ssrf";
import { logger } from "@/lib/logger";

export interface IncomingAffiliateMessageEvent {
    sessionId: string;
    messageId: string;
    remoteJid: string;
    fromMe: boolean;
    isGroup?: boolean;
    text: string;
}

export interface ProcessedUrlItem {
    validation: ValidatedUrlResult;
    generation?: AffiliateGenerationResult;
}

export interface AffiliateProcessResult {
    action:
        | "ignored_self"
        | "ignored_non_direct_chat"
        | "ignored_invalid_payload"
        | "ignored_duplicate"
        | "ignored_no_urls"
        | "ignored_unrelated_urls"
        | "replied"
        | "reply_failed";
    replyText?: string;
    recipientJid?: string;
    items: ProcessedUrlItem[];
}

export type SendWhatsAppTextFn = (recipientJid: string, text: string) => Promise<void>;

export interface AffiliateProcessorDependencies extends ValidatorDependencies {
    generators?: Partial<Record<AffiliatePlatform, AffiliateGenerator>>;
    sendText?: SendWhatsAppTextFn;
    idempotencyStore?: IdempotencyStore;
    env?: Record<string, string | undefined>;
    settings?: StoredAffiliateSettings | null;
}

export class IdempotencyStore {
    private map = new Map<string, number>();
    private readonly ttlMs: number;
    private readonly maxEntries: number;

    constructor(
        ttlMs = AFFILIATE_LIMITS.IDEMPOTENCY_TTL_MS,
        maxEntries = AFFILIATE_LIMITS.IDEMPOTENCY_MAX_ENTRIES
    ) {
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
    }

    public tryAcquire(sessionId: string, messageId: string): boolean {
        const now = Date.now();
        const key = `${sessionId}:${messageId}`;

        const existingExpiry = this.map.get(key);
        if (existingExpiry !== undefined && existingExpiry > now) {
            return false;
        }

        if (this.map.size >= this.maxEntries) {
            for (const [k, exp] of this.map.entries()) {
                if (exp <= now || this.map.size >= this.maxEntries) {
                    this.map.delete(k);
                }
                if (this.map.size < this.maxEntries * 0.9) break;
            }
        }

        this.map.set(key, now + this.ttlMs);
        return true;
    }

    public clear(): void {
        this.map.clear();
    }
}

const globalForAffiliate = globalThis as unknown as {
    __affiliateIdempotencyStore?: IdempotencyStore;
};

export const defaultIdempotencyStore =
    (globalForAffiliate.__affiliateIdempotencyStore ??= new IdempotencyStore());

function formatPlatformLabel(platform: AffiliatePlatform): string {
    return platform === "mercadolivre" ? "Mercado Livre" : "Shopee";
}

function isDirectPersonalChatJid(remoteJid: string, isGroupFlag?: boolean): boolean {
    if (isGroupFlag === true) return false;
    const jid = remoteJid.trim().toLowerCase();
    if (!jid) return false;
    if (jid.endsWith("@g.us")) return false;
    if (jid === "status@broadcast" || jid.endsWith("@broadcast")) return false;
    if (jid.endsWith("@newsletter")) return false;
    return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
}

/**
 *Verifica se um texto contém menção ou URL candidata que justifique avaliação pelo módulo de afiliados.
 */
export function hasCandidateUrlsInText(text: string): boolean {
    return extractUrlsFromText(text).length > 0;
}

/**
 * Processa uma mensagem recebida do WhatsApp de ponta a ponta:
 * - Valida estrutura, origem, tamanho e idempotência.
 * - Ignora mensagens enviadas pela própria conta ou de grupos.
 * - Extrai e valida todas as URLs com proteção contra SSRF e allowlist estrita.
 * - Aciona os geradores de afiliados independentes para produtos confirmados.
 * - Envia a resposta somente ao próprio remetente no chat direto.
 */
export async function processIncomingAffiliateMessage(
    event: IncomingAffiliateMessageEvent,
    deps: AffiliateProcessorDependencies = {}
): Promise<AffiliateProcessResult> {
    if (
        !event ||
        typeof event !== "object" ||
        typeof event.sessionId !== "string" ||
        !event.sessionId.trim() ||
        typeof event.messageId !== "string" ||
        !event.messageId.trim() ||
        typeof event.remoteJid !== "string" ||
        !event.remoteJid.trim() ||
        typeof event.text !== "string"
    ) {
        return { action: "ignored_invalid_payload", items: [] };
    }

    if (event.text.length > AFFILIATE_LIMITS.MAX_MESSAGE_LENGTH) {
        return { action: "ignored_invalid_payload", items: [] };
    }

    // 1. Ignorar mensagens enviadas pela própria conta
    if (event.fromMe === true) {
        return { action: "ignored_self", items: [] };
    }

    // 2. Ignorar grupos, status e canais; responder apenas em chat direto
    if (!isDirectPersonalChatJid(event.remoteJid, event.isGroup)) {
        return { action: "ignored_non_direct_chat", items: [] };
    }

    // 3. Extrair URLs do texto
    const extractedUrls = extractUrlsFromText(event.text);
    if (extractedUrls.length === 0) {
        return { action: "ignored_no_urls", items: [] };
    }

    // 4. Idempotência por (sessionId, messageId)
    const idempotency = deps.idempotencyStore || defaultIdempotencyStore;
    if (!idempotency.tryAcquire(event.sessionId, event.messageId)) {
        logger.debug("Affiliate", `Mensagem duplicada ignorada: ${event.messageId}`);
        return { action: "ignored_duplicate", items: [] };
    }

    const effectiveEnv = resolveAffiliateEnv(deps.settings, deps.env || process.env);
    const templates = resolveAffiliateTemplates(deps.settings);

    const generators: Record<AffiliatePlatform, AffiliateGenerator> = {
        mercadolivre:
            deps.generators?.mercadolivre ||
            createMercadoLivreAffiliateGenerator({ env: effectiveEnv, fetchFn: deps.fetchFn }),
        shopee:
            deps.generators?.shopee ||
            createShopeeAffiliateGenerator({ env: effectiveEnv, fetchFn: deps.fetchFn }),
    };

    const items: ProcessedUrlItem[] = [];
    for (const rawUrl of extractedUrls) {
        const validation = await validateAndResolveCandidateUrl(rawUrl, {
            fetchFn: deps.fetchFn,
            dnsLookupFn: deps.dnsLookupFn,
            allowlist: deps.allowlist,
        });

        if (
            validation.kind === "product" &&
            (validation.platform === "mercadolivre" || validation.platform === "shopee") &&
            validation.canonicalProductUrl &&
            validation.productId
        ) {
            const generator = generators[validation.platform];
            const generation = await generator.generate({
                platform: validation.platform,
                canonicalProductUrl: validation.canonicalProductUrl,
                productId: validation.productId,
            });
            items.push({ validation, generation });
            // Grava conversao de afiliado no banco para o Dashboard
            if (generation?.ok && generation.affiliateUrl) {
                prisma.affiliateConversion.create({
                    data: {
                        sessionId: event.sessionId,
                        platform: validation.platform,
                        originalUrl: validation.originalUrl,
                        affiliateUrl: generation.affiliateUrl,
                        productId: validation.productId || null,
                        senderJid: event.remoteJid,
                        status: "success",
                    }
                }).catch(() => {});
            } else if (generation && !generation.ok) {
                prisma.affiliateConversion.create({
                    data: {
                        sessionId: event.sessionId,
                        platform: validation.platform,
                        originalUrl: validation.originalUrl,
                        affiliateUrl: "",
                        productId: validation.productId || null,
                        senderJid: event.remoteJid,
                        status: "error",
                        errorMessage: generation.reason || "unknown",
                    }
                }).catch(() => {});
            }
        } else {
            items.push({ validation });
        }
    }

    // Verifica se todos os links eram apenas de sites comuns não relacionados (ex.: youtube.com, google.com)
    const relevantItems = items.filter(
        (it) =>
            it.validation.platform === "mercadolivre" ||
            it.validation.platform === "shopee" ||
            it.validation.reason === "lookalike_untrusted_domain" ||
            it.validation.kind === "invalid_url"
    );

    if (relevantItems.length === 0) {
        return { action: "ignored_unrelated_urls", items };
    }

    const isMulti = relevantItems.length > 1;
    const replyLines: string[] = [];

    for (let idx = 0; idx < relevantItems.length; idx++) {
        const { validation, generation } = relevantItems[idx];
        const prefix = isMulti ? `${idx + 1}. ` : "";

        if (
            validation.kind === "product" &&
            (validation.platform === "mercadolivre" || validation.platform === "shopee")
        ) {
            const label = formatPlatformLabel(validation.platform);
            if (generation?.ok && generation.affiliateUrl) {
                if (isMulti) {
                    replyLines.push(
                        renderAffiliateTemplate(templates.multiItem, {
                            indice: idx + 1,
                            plataforma: label,
                            id: validation.productId || "",
                            link: generation.affiliateUrl,
                            url_original: validation.originalUrl,
                        })
                    );
                } else {
                    replyLines.push(
                        renderAffiliateTemplate(templates.singleSuccess, {
                            plataforma: label,
                            id: validation.productId || "",
                            link: generation.affiliateUrl,
                            url_original: validation.originalUrl,
                        })
                    );
                }
            } else if (templates.replyWhenUnavailable !== false) {
                const msg = renderAffiliateTemplate(templates.unavailablePlatform, {
                    plataforma: label,
                    id: validation.productId || "",
                });
                replyLines.push(isMulti && !msg.startsWith(prefix) ? `${prefix}${msg}` : msg);
            }
            continue;
        }

        if (
            validation.kind === "profile_or_non_product" &&
            (validation.platform === "mercadolivre" || validation.platform === "shopee")
        ) {
            const label = formatPlatformLabel(validation.platform);
            const msg = renderAffiliateTemplate(templates.nonProductUrl, {
                plataforma: label,
            });
            replyLines.push(isMulti && !msg.startsWith(prefix) ? `${prefix}${msg}` : msg);
            continue;
        }

        if (validation.kind === "inconclusive") {
            const label =
                validation.platform === "mercadolivre" || validation.platform === "shopee"
                    ? formatPlatformLabel(validation.platform)
                    : "loja";
            const msg = renderAffiliateTemplate(templates.nonProductUrl, {
                plataforma: label,
            });
            replyLines.push(isMulti && !msg.startsWith(prefix) ? `${prefix}${msg}` : msg);
            continue;
        }

        if (validation.kind === "invalid_url") {
            logger.warn(
                "Affiliate",
                `URL bloqueada ou inválida recebida (${validation.reason || "invalid"}): ${redactUrlForLog(validation.originalUrl)}`
            );
            const msg = renderAffiliateTemplate(templates.invalidUrl, {});
            replyLines.push(isMulti && !msg.startsWith(prefix) ? `${prefix}${msg}` : msg);
        }
    }

    if (replyLines.length === 0) {
        return { action: "ignored_unrelated_urls", items };
    }

    const header = isMulti && templates.multiHeader?.trim() ? `${templates.multiHeader.trim()}\n\n` : "";
    const replyText = `${header}${replyLines.join("\n\n")}`;

    if (deps.sendText) {
        try {
            await deps.sendText(event.remoteJid, replyText);
        } catch (err: any) {
            logger.error("Affiliate", `Falha ao enviar resposta no WhatsApp: ${err?.message || "erro"}`);
            return {
                action: "reply_failed",
                replyText,
                recipientJid: event.remoteJid,
                items,
            };
        }
    }

    return {
        action: "replied",
        replyText,
        recipientJid: event.remoteJid,
        items,
    };
}
