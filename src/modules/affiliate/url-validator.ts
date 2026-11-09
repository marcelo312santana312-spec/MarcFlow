import {
    AFFILIATE_DOMAIN_ALLOWLIST,
    AFFILIATE_LIMITS,
    AffiliatePlatform,
} from "./config";
import {
    assertHostResolvesToPublicIp,
    classifyHostByAllowlist,
    defaultDnsLookup,
    DnsLookupFn,
    parseAndValidateUrlStructure,
} from "./ssrf";

export type UrlClassificationKind =
    | "product"
    | "profile_or_non_product"
    | "unsupported_domain"
    | "inconclusive"
    | "invalid_url";

export interface ValidatedUrlResult {
    originalUrl: string;
    resolvedUrl?: string;
    canonicalProductUrl?: string;
    platform: AffiliatePlatform | "other" | "inconclusive";
    kind: UrlClassificationKind;
    productId?: string;
    reason?: string;
}

export type SafeFetchFn = (url: string, init: RequestInit) => Promise<Response>;

const defaultFetch: SafeFetchFn = (url, init) => fetch(url, init);

/**
 * Extrai todas as URLs candidatas de um texto de mensagem (mesmo quando misturadas com texto adicional).
 * Trata o texto como dado não confiável (ignora qualquer instrução textual).
 */
export function extractUrlsFromText(text: string): string[] {
    if (!text || typeof text !== "string") return [];
    const safeText = text.slice(0, AFFILIATE_LIMITS.MAX_MESSAGE_LENGTH * 2);

    // Captura tokens que tenham esquema (ex.: https://, http://, ftp://, javascript:) ou formato de URL
    const regex = /\b(?:https?|ftp|javascript|file|data):\/\/[^\s<>"'`]+/gi;
    const matches = safeText.match(regex) || [];

    const seen = new Set<string>();
    const results: string[] = [];

    for (const raw of matches) {
        // Remove pontuação final comum de frases em português (.,;:!?) e parênteses/colchetes de fechamento desbalanceados
        let cleaned = raw.trim().replace(/[.,;:!?]+$/, "");
        while (cleaned.endsWith(")") && (cleaned.match(/\(/g)?.length || 0) < (cleaned.match(/\)/g)?.length || 0)) {
            cleaned = cleaned.slice(0, -1);
        }
        while (cleaned.endsWith("]") && (cleaned.match(/\[/g)?.length || 0) < (cleaned.match(/\]/g)?.length || 0)) {
            cleaned = cleaned.slice(0, -1);
        }

        if (cleaned && !seen.has(cleaned)) {
            seen.add(cleaned);
            results.push(cleaned);
            if (results.length >= AFFILIATE_LIMITS.MAX_URLS_PER_MESSAGE) {
                break;
            }
        }
    }

    return results;
}

const ML_NON_PRODUCT_PATH_PREFIXES = [
    "/social/",
    "/perfil/",
    "/loja/",
    "/ofertas",
    "/categorias",
    "/ajuda",
    "/jm/search",
    "/navigation",
    "/resumo",
    "/assinaturas",
    "/meliplus",
    "/cupons",
    "/veiculos",
    "/imoveis",
];

/**
 * Verifica se uma URL já resolvida do Mercado Livre aponta comprovadamente para uma página de produto elegível.
 */
export function verifyMercadoLivreProductUrl(url: URL): {
    isProduct: boolean;
    isProfileOrNonProduct: boolean;
    productId?: string;
    canonicalProductUrl?: string;
    reason?: string;
} {
    const host = url.hostname.toLowerCase().replace(/\.+$/, "");
    const pathname = url.pathname;
    const lowerPath = pathname.toLowerCase();

    // Domínio de busca/listagem não é página de produto único
    if (host === "lista.mercadolivre.com.br") {
        return { isProduct: false, isProfileOrNonProduct: true, reason: "search_or_listing_page" };
    }

    // Links curtos /sec/ que não redirecionaram para produto são inconclusivos/perfil social
    if (host === "mercadolivre.com" || host === "www.mercadolivre.com" || host === "meli.la") {
        return { isProduct: false, isProfileOrNonProduct: false, reason: "unresolved_shortlink" };
    }

    // Caminhos explicitamente de perfil social, busca, loja ou vitrine geral
    for (const prefix of ML_NON_PRODUCT_PATH_PREFIXES) {
        if (lowerPath === prefix || lowerPath.startsWith(prefix)) {
            return { isProduct: false, isProfileOrNonProduct: true, reason: "non_product_section" };
        }
    }

    if (lowerPath === "/" || lowerPath === "") {
        return { isProduct: false, isProfileOrNonProduct: true, reason: "homepage" };
    }

    // 1. Catálogo /p/MLB12345678 ou /up/MLBU12345678
    const catalogMatch = pathname.match(/\/(?:p|up)\/(MLBU?\d{6,16})(?:[/?#]|$)/i);
    if (catalogMatch) {
        const productId = catalogMatch[1].toUpperCase();
        const canonical = new URL(url.origin + pathname);
        return {
            isProduct: true,
            isProfileOrNonProduct: false,
            productId,
            canonicalProductUrl: canonical.toString(),
        };
    }

    // 2. Produto tradicional MLB-1234567890-nome-do-produto-_JM ou /MLB1234567890
    const itemMatch = pathname.match(/(?:^|\/)(MLB-?\d{6,16})(?:-|_JM|[/?#]|$)/i);
    if (itemMatch) {
        const productId = itemMatch[1].toUpperCase().replace("-", "");
        const canonical = new URL(url.origin + pathname);
        return {
            isProduct: true,
            isProfileOrNonProduct: false,
            productId,
            canonicalProductUrl: canonical.toString(),
        };
    }

    // 3. Query param item_id=MLB... ou wid=MLB... em página de produto
    const paramId = url.searchParams.get("item_id") || url.searchParams.get("wid");
    if (paramId && /^MLBU?-?\d{6,16}$/i.test(paramId.trim())) {
        const productId = paramId.trim().toUpperCase().replace("-", "");
        const canonical = new URL(url.origin + pathname);
        canonical.searchParams.set("item_id", productId);
        return {
            isProduct: true,
            isProfileOrNonProduct: false,
            productId,
            canonicalProductUrl: canonical.toString(),
        };
    }

    return {
        isProduct: false,
        isProfileOrNonProduct: true,
        reason: "missing_product_identifier",
    };
}

const SHOPEE_RESERVED_FIRST_SEGMENTS = new Set([
    "search",
    "shop",
    "user",
    "buyer",
    "seller",
    "m",
    "campaigns",
    "daily_discover",
    "flash_deals",
    "mall",
    "collections",
    "cart",
    "checkout",
    "me",
    "universal-link",
    "verify",
    "blog",
    "help",
    "legal",
    "live",
    "feed",
]);

/**
 * Verifica se uma URL já resolvida da Shopee aponta comprovadamente para uma página de produto elegível.
 */
export function verifyShopeeProductUrl(url: URL): {
    isProduct: boolean;
    isProfileOrNonProduct: boolean;
    productId?: string;
    canonicalProductUrl?: string;
    reason?: string;
} {
    const host = url.hostname.toLowerCase().replace(/\.+$/, "");
    if (host === "s.shopee.com.br" || host === "shp.ee" || host === "br.shp.ee") {
        return { isProduct: false, isProfileOrNonProduct: false, reason: "unresolved_shortlink" };
    }

    const pathname = url.pathname;
    const segments = pathname.split("/").filter(Boolean);

    if (segments.length === 0) {
        return { isProduct: false, isProfileOrNonProduct: true, reason: "homepage" };
    }

    // 1. Formato /product/<shopId>/<itemId> ou /opaanlp/<shopId>/<itemId>
    if (
        (segments[0].toLowerCase() === "product" || segments[0].toLowerCase() === "opaanlp") &&
        segments.length >= 3 &&
        /^\d{4,20}$/.test(segments[1]) &&
        /^\d{5,22}$/.test(segments[2])
    ) {
        const shopId = segments[1];
        const itemId = segments[2];
        return {
            isProduct: true,
            isProfileOrNonProduct: false,
            productId: `${shopId}.${itemId}`,
            canonicalProductUrl: `https://shopee.com.br/product/${shopId}/${itemId}`,
        };
    }

    // 2. Formato clássico /<slug>-i.<shopId>.<itemId>
    const slugMatch = pathname.match(/\/[^/]+-i\.(\d{4,20})\.(\d{5,22})(?:[/?#]|$)/i);
    if (slugMatch) {
        const shopId = slugMatch[1];
        const itemId = slugMatch[2];
        return {
            isProduct: true,
            isProfileOrNonProduct: false,
            productId: `${shopId}.${itemId}`,
            canonicalProductUrl: `https://shopee.com.br/product/${shopId}/${itemId}`,
        };
    }

    // 3. Formato /<shopUsername>/<itemId> (2 segmentos onde o 2º é ID numérico de item e o 1º não é rota reservada)
    if (
        segments.length === 2 &&
        !SHOPEE_RESERVED_FIRST_SEGMENTS.has(segments[0].toLowerCase()) &&
        /^[a-zA-Z0-9_.-]{2,64}$/.test(segments[0]) &&
        /^\d{6,22}$/.test(segments[1])
    ) {
        return {
            isProduct: true,
            isProfileOrNonProduct: false,
            productId: `${segments[0]}.${segments[1]}`,
            canonicalProductUrl: `https://shopee.com.br/${segments[0]}/${segments[1]}`,
        };
    }

    return {
        isProduct: false,
        isProfileOrNonProduct: true,
        reason: "non_product_or_profile_page",
    };
}

/**
 * Lê no máximo `maxBytes` de uma resposta textual HTML para identificar redirecionamento
 * canônico oficial (ex.: páginas intermediárias /sec/ do Mercado Livre), ignorando scripts/comandos.
 */
async function readBoundedText(res: Response, maxBytes: number): Promise<string> {
    if (!res.body) return "";
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
        while (total < maxBytes) {
            const { done, value } = await reader.read();
            if (done || !value) break;
            const remaining = maxBytes - total;
            if (value.byteLength > remaining) {
                chunks.push(value.subarray(0, remaining));
                total += remaining;
                break;
            }
            chunks.push(value);
            total += value.byteLength;
        }
    } finally {
        await reader.cancel().catch(() => {});
    }

    return Buffer.concat(chunks).toString("utf-8");
}

export interface ValidatorDependencies {
    fetchFn?: SafeFetchFn;
    dnsLookupFn?: DnsLookupFn;
    allowlist?: typeof AFFILIATE_DOMAIN_ALLOWLIST;
}

/**
 * Valida uma URL candidata, resolve redirecionamentos de links curtos oficiais com proteção contra SSRF,
 * e confirma se o destino final é uma página de produto elegível do Mercado Livre ou da Shopee.
 */
export async function validateAndResolveCandidateUrl(
    rawUrl: string,
    deps: ValidatorDependencies = {}
): Promise<ValidatedUrlResult> {
    const fetchFn = deps.fetchFn || defaultFetch;
    const dnsLookupFn = deps.dnsLookupFn || defaultDnsLookup;
    const allowlist = deps.allowlist || AFFILIATE_DOMAIN_ALLOWLIST;

    const initialParse = parseAndValidateUrlStructure(rawUrl);
    if (!initialParse.ok || !initialParse.url || !initialParse.normalizedHost) {
        return {
            originalUrl: rawUrl,
            platform: "other",
            kind: "invalid_url",
            reason: initialParse.reason || "malformed_url",
        };
    }

    const initialHostClass = classifyHostByAllowlist(initialParse.normalizedHost, allowlist);
    if (initialHostClass.platform === "other") {
        // Verifica se o host tentou imitar "mercadolivre", "meli" ou "shopee" (domínio falso / phishing)
        const looksSuspicious = /(?:mercadolivre|mercadolibre|meli|shopee|shpee)/i.test(initialParse.normalizedHost);
        return {
            originalUrl: rawUrl,
            platform: "other",
            kind: looksSuspicious ? "invalid_url" : "unsupported_domain",
            reason: looksSuspicious ? "lookalike_untrusted_domain" : "domain_not_in_allowlist",
        };
    }

    const platform = initialHostClass.platform;
    let currentUrl = initialParse.url;
    let currentClass = initialHostClass;
    const visited = new Set<string>([currentUrl.toString()]);

    // Se for um link curto (ou se for mercadolivre.com/sec/...), resolvemos redirecionamentos passo a passo
    const needsRedirectResolution = (u: URL, cls: typeof initialHostClass) => {
        if (cls.isShortener) return true;
        if (cls.platform === "mercadolivre" && u.pathname.toLowerCase().startsWith("/sec/")) return true;
        if (cls.platform === "shopee" && u.pathname.toLowerCase().startsWith("/universal-link")) return true;
        return false;
    };

    let hops = 0;
    while (needsRedirectResolution(currentUrl, currentClass)) {
        if (hops >= AFFILIATE_LIMITS.MAX_REDIRECTS) {
            return {
                originalUrl: rawUrl,
                platform,
                kind: "invalid_url",
                reason: "max_redirects_exceeded",
            };
        }

        // Proteção SSRF + DNS Rebinding antes de cada conexão de rede
        const dnsCheck = await assertHostResolvesToPublicIp(currentUrl.hostname, dnsLookupFn);
        if (!dnsCheck.ok) {
            return {
                originalUrl: rawUrl,
                platform,
                kind: "invalid_url",
                reason: `ssrf_blocked:${dnsCheck.reason}`,
            };
        }

        let response: Response;
        try {
            response = await fetchFn(currentUrl.toString(), {
                method: "GET",
                redirect: "manual",
                credentials: "omit",
                headers: {
                    Accept: "text/html,application/xhtml+xml;q=0.9",
                    "User-Agent": "MarcFlow-LinkValidator/1.0",
                },
                signal: AbortSignal.timeout(AFFILIATE_LIMITS.RESOLVE_TIMEOUT_MS),
            });
        } catch {
            return {
                originalUrl: rawUrl,
                platform,
                kind: "inconclusive",
                reason: "shortlink_resolution_failed",
            };
        }

        const status = response.status;
        const locationHeader = response.headers.get("location");

        if (status >= 300 && status < 400 && locationHeader) {
            // Cancela leitura do body do redirect
            await response.body?.cancel().catch(() => {});

            let nextRawUrl: string;
            try {
                nextRawUrl = new URL(locationHeader, currentUrl).toString();
            } catch {
                return {
                    originalUrl: rawUrl,
                    platform,
                    kind: "invalid_url",
                    reason: "malformed_redirect_location",
                };
            }

            if (visited.has(nextRawUrl)) {
                return {
                    originalUrl: rawUrl,
                    platform,
                    kind: "invalid_url",
                    reason: "redirect_loop_detected",
                };
            }
            visited.add(nextRawUrl);

            const nextParsed = parseAndValidateUrlStructure(nextRawUrl);
            if (!nextParsed.ok || !nextParsed.url || !nextParsed.normalizedHost) {
                return {
                    originalUrl: rawUrl,
                    platform,
                    kind: "invalid_url",
                    reason: `redirect_target_invalid:${nextParsed.reason}`,
                };
            }

            const nextClass = classifyHostByAllowlist(nextParsed.normalizedHost, allowlist);
            // Não permite que um link curto de uma plataforma redirecione para domínio fora da allowlist da mesma plataforma
            if (nextClass.platform !== platform) {
                return {
                    originalUrl: rawUrl,
                    platform,
                    kind: "invalid_url",
                    reason: "redirect_to_disallowed_domain",
                };
            }

            currentUrl = nextParsed.url;
            currentClass = nextClass;
            hops++;
            continue;
        }

        // Caso especial: Mercado Livre /sec/... às vezes responde 200 com canonical/meta refresh para o produto
        if (status === 200 && platform === "mercadolivre") {
            const contentType = (response.headers.get("content-type") || "").toLowerCase();
            if (!contentType.includes("text/html")) {
                await response.body?.cancel().catch(() => {});
                return {
                    originalUrl: rawUrl,
                    platform,
                    kind: "invalid_url",
                    reason: "unexpected_content_type",
                };
            }
            const htmlSnippet = await readBoundedText(response, AFFILIATE_LIMITS.MAX_RESPONSE_BYTES);
            // Extrai apenas URLs estáticas em href/content que apontem para produto.mercadolivre.com.br ou www.mercadolivre.com.br
            const embeddedMatch = htmlSnippet.match(
                /https:\/\/(?:produto|www)\.mercadolivre\.com\.br\/[^\s"'<>]+/i
            );
            if (embeddedMatch) {
                const candidateEmbedded = embeddedMatch[0].replace(/&amp;/g, "&");
                const nextParsed = parseAndValidateUrlStructure(candidateEmbedded);
                if (nextParsed.ok && nextParsed.url && nextParsed.normalizedHost) {
                    const nextClass = classifyHostByAllowlist(nextParsed.normalizedHost, allowlist);
                    if (nextClass.platform === "mercadolivre" && nextClass.isProductHost) {
                        currentUrl = nextParsed.url;
                        currentClass = nextClass;
                        break;
                    }
                }
            }
        } else {
            await response.body?.cancel().catch(() => {});
        }

        break;
    }

    // Validação final do destino como produto elegível
    if (platform === "mercadolivre") {
        const check = verifyMercadoLivreProductUrl(currentUrl);
        if (check.isProduct && check.canonicalProductUrl && check.productId) {
            return {
                originalUrl: rawUrl,
                resolvedUrl: currentUrl.toString(),
                canonicalProductUrl: check.canonicalProductUrl,
                platform: "mercadolivre",
                kind: "product",
                productId: check.productId,
            };
        }
        return {
            originalUrl: rawUrl,
            resolvedUrl: currentUrl.toString(),
            platform: "mercadolivre",
            kind: check.isProfileOrNonProduct ? "profile_or_non_product" : "inconclusive",
            reason: check.reason,
        };
    }

    if (platform === "shopee") {
        const check = verifyShopeeProductUrl(currentUrl);
        if (check.isProduct && check.canonicalProductUrl && check.productId) {
            return {
                originalUrl: rawUrl,
                resolvedUrl: currentUrl.toString(),
                canonicalProductUrl: check.canonicalProductUrl,
                platform: "shopee",
                kind: "product",
                productId: check.productId,
            };
        }
        return {
            originalUrl: rawUrl,
            resolvedUrl: currentUrl.toString(),
            platform: "shopee",
            kind: check.isProfileOrNonProduct ? "profile_or_non_product" : "inconclusive",
            reason: check.reason,
        };
    }

    return {
        originalUrl: rawUrl,
        platform: "other",
        kind: "unsupported_domain",
    };
}
