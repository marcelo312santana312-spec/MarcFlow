import crypto from "crypto";
import https from "https";
import http from "http";
import {
    AFFILIATE_DOMAIN_ALLOWLIST,
    AFFILIATE_LIMITS,
    AffiliatePlatform,
    getPlatformIntegrationStatus,
} from "./config";
import { classifyHostByAllowlist, parseAndValidateUrlStructure, redactUrlForLog } from "./ssrf";
import { SafeFetchFn } from "./url-validator";
import { logger } from "@/lib/logger";

export type GenerationFailureReason =
    | "integration_unconfigured"
    | "auth_error"
    | "product_rejected"
    | "invalid_generator_output"
    | "timeout"
    | "service_unavailable";

export interface AffiliateGenerationInput {
    platform: AffiliatePlatform;
    canonicalProductUrl: string;
    productId: string;
}

export interface AffiliateGenerationResult {
    ok: boolean;
    platform: AffiliatePlatform;
    affiliateUrl?: string;
    reason?: GenerationFailureReason;
    missingEnvVars?: string[];
}

export interface AffiliateGenerator {
    generate(input: AffiliateGenerationInput): Promise<AffiliateGenerationResult>;
}

const defaultFetch: SafeFetchFn = (url, init) => fetch(url, init);

/**
 * Executa POST JSON usando https/http nativo com IPv4 prioritário (evita o timeout
 * fixo de 10s do Undici no Windows e permite até GENERATOR_TIMEOUT_MS).
 */
function postJsonNative(
    endpoint: string,
    headers: Record<string, string>,
    bodyStr: string,
    timeoutMs: number
): Promise<{ status: number; ok: boolean; json: () => Promise<any> }> {
    return new Promise((resolve, reject) => {
        let parsed: URL;
        try {
            parsed = new URL(endpoint);
        } catch (err) {
            return reject(err);
        }

        const isHttps = parsed.protocol === "https:";
        const client = isHttps ? https : http;

        const req = client.request(
            parsed,
            {
                method: "POST",
                family: 4,
                headers: {
                    ...headers,
                    "Content-Length": Buffer.byteLength(bodyStr, "utf8").toString(),
                },
                timeout: timeoutMs,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                res.on("end", () => {
                    const text = Buffer.concat(chunks).toString("utf8");
                    const status = res.statusCode || 500;
                    resolve({
                        status,
                        ok: status >= 200 && status < 300,
                        json: async () => JSON.parse(text),
                    });
                });
            }
        );

        req.on("timeout", () => {
            req.destroy(Object.assign(new Error("Request timeout"), { name: "TimeoutError" }));
        });
        req.on("error", (err) => reject(err));
        req.write(bodyStr);
        req.end();
    });
}

/**
 * Valida que o link retornado pelo gerador de afiliados é realmente um link HTTPS
 * pertencente ao domínio oficial daquela plataforma.
 */
function isValidOfficialAffiliateUrl(rawAffiliateUrl: string, platform: AffiliatePlatform): boolean {
    const parsed = parseAndValidateUrlStructure(rawAffiliateUrl);
    if (!parsed.ok || !parsed.url || !parsed.normalizedHost) return false;
    if (parsed.url.protocol !== "https:") return false;

    const hostClass = classifyHostByAllowlist(parsed.normalizedHost, AFFILIATE_DOMAIN_ALLOWLIST);
    return hostClass.platform === platform;
}

/**
 * Gerador oficial da Shopee via Shopee Open Platform Affiliate GraphQL API (`generateShortLink`).
 * Só executa se `SHOPEE_AFFILIATE_APP_ID` e `SHOPEE_AFFILIATE_SECRET` estiverem configurados.
 */
export function createShopeeAffiliateGenerator(
    opts: { env?: Record<string, string | undefined>; fetchFn?: SafeFetchFn } = {}
): AffiliateGenerator {
    const env = opts.env || process.env;
    const fetchFn = opts.fetchFn || defaultFetch;

    return {
        async generate(input: AffiliateGenerationInput): Promise<AffiliateGenerationResult> {
            const status = getPlatformIntegrationStatus("shopee", env);
            if (!status.enabled || !status.configured) {
                logger.warn(
                    "Affiliate",
                    `Integração Shopee desativada/não configurada. Variáveis ausentes: ${status.missingEnvVars.join(", ")}`
                );
                return {
                    ok: false,
                    platform: "shopee",
                    reason: "integration_unconfigured",
                    missingEnvVars: status.missingEnvVars,
                };
            }

            const appId = String(env.SHOPEE_AFFILIATE_APP_ID).trim();
            const secret = String(env.SHOPEE_AFFILIATE_SECRET).trim();
            const endpoint =
                env.SHOPEE_AFFILIATE_API_URL?.trim() ||
                "https://open-api.affiliate.shopee.com.br/graphql";

            const query = `mutation GenerateShortLink($originUrl: String!) {
                generateShortLink(input: { originUrl: $originUrl }) {
                    shortLink
                }
            }`;
            const bodyStr = JSON.stringify({
                query,
                variables: { originUrl: input.canonicalProductUrl },
            });

            const maxAttempts = AFFILIATE_LIMITS.GENERATOR_MAX_RETRIES + 1;
            let lastReason: GenerationFailureReason = "service_unavailable";

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                const timestamp = Math.floor(Date.now() / 1000).toString();
                const signature = crypto
                    .createHash("sha256")
                    .update(`${appId}${timestamp}${bodyStr}${secret}`, "utf8")
                    .digest("hex");

                try {
                    const reqHeaders = {
                        "Content-Type": "application/json",
                        Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
                    };

                    const res = opts.fetchFn
                        ? await fetchFn(endpoint, {
                              method: "POST",
                              headers: reqHeaders,
                              body: bodyStr,
                              signal: AbortSignal.timeout(AFFILIATE_LIMITS.GENERATOR_TIMEOUT_MS),
                          })
                        : await postJsonNative(
                              endpoint,
                              reqHeaders,
                              bodyStr,
                              AFFILIATE_LIMITS.GENERATOR_TIMEOUT_MS
                          );

                    if (res.status === 401 || res.status === 403) {
                        logger.error("Affiliate", "Shopee Affiliate API retornou erro de autenticação/autorização.");
                        return { ok: false, platform: "shopee", reason: "auth_error" };
                    }

                    if (!res.ok) {
                        logger.warn("Affiliate", `Shopee Affiliate API indisponível (HTTP ${res.status}).`);
                        lastReason = "service_unavailable";
                        if (attempt < maxAttempts) continue;
                        return { ok: false, platform: "shopee", reason: lastReason };
                    }

                    const data: any = await res.json().catch(() => null);
                    if (data?.errors && Array.isArray(data.errors) && data.errors.length > 0) {
                        logger.warn(
                            "Affiliate",
                            `Shopee rejeitou a geração do link para ${redactUrlForLog(input.canonicalProductUrl)}.`
                        );
                        return { ok: false, platform: "shopee", reason: "product_rejected" };
                    }

                    const shortLink = data?.data?.generateShortLink?.shortLink;
                    if (typeof shortLink !== "string" || !isValidOfficialAffiliateUrl(shortLink, "shopee")) {
                        logger.error("Affiliate", "Shopee Affiliate API retornou um link inválido ou fora do domínio oficial.");
                        return { ok: false, platform: "shopee", reason: "invalid_generator_output" };
                    }

                    return {
                        ok: true,
                        platform: "shopee",
                        affiliateUrl: shortLink.trim(),
                    };
                } catch (err: any) {
                    const isTimeout =
                        err?.name === "TimeoutError" ||
                        err?.name === "AbortError" ||
                        String(err?.message || "").toLowerCase().includes("timeout");
                    lastReason = isTimeout ? "timeout" : "service_unavailable";
                    logger.warn(
                        "Affiliate",
                        `Falha ao chamar gerador Shopee (tentativa ${attempt}/${maxAttempts}: ${isTimeout ? "timeout" : "erro de rede"}).`
                    );
                    if (attempt < maxAttempts) {
                        await new Promise((r) => setTimeout(r, 400 * attempt));
                        continue;
                    }
                }
            }

            return {
                ok: false,
                platform: "shopee",
                reason: lastReason,
            };
        },
    };
}

/**
 * Gera link de afiliado diretamente via Mercado Livre usando Cookie de sessão
 */
async function generateMercadoLivreDirect(
    productUrl: string,
    cookie: string,
    tag: string
): Promise<AffiliateGenerationResult | null> {
    try {
        const res1 = await fetch("https://www.mercadolivre.com.br/afiliados/linkbuilder", {
            headers: {
                cookie: cookie,
                "user-agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            },
            signal: AbortSignal.timeout(8000),
        });

        const setCookies =
            typeof (res1.headers as any).getSetCookie === "function"
                ? (res1.headers as any).getSetCookie()
                : [];
        const cookieMap: Record<string, string> = {};
        cookie.split(";").forEach((c) => {
            const [k, ...v] = c.trim().split("=");
            if (k) cookieMap[k] = v.join("=");
        });
        for (const sc of setCookies) {
            const part = String(sc).split(";")[0];
            const [k, ...v] = part.trim().split("=");
            if (k) cookieMap[k] = v.join("=");
        }
        const updatedCookie = Object.keys(cookieMap)
            .map((k) => `${k}=${cookieMap[k]}`)
            .join("; ");

        const res2 = await fetch(
            "https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink",
            {
                method: "POST",
                headers: {
                    accept: "application/json, text/plain, */*",
                    "content-type": "application/json",
                    origin: "https://www.mercadolivre.com.br",
                    referer: "https://www.mercadolivre.com.br/afiliados/linkbuilder",
                    "user-agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                    "x-csrf-token": "CRoUbkB5-udAuzRwZkidqm7yW9Omqcb1z1zs",
                    cookie: updatedCookie,
                },
                body: JSON.stringify({
                    urls: [productUrl],
                    tag: tag || "venddor17",
                }),
                signal: AbortSignal.timeout(8000),
            }
        );

        if (!res2.ok) return null;

        const data: any = await res2.json().catch(() => null);
        const item = data?.urls?.[0];
        const shortUrl = item?.short_url || item?.shortUrl || item?.url;
        if (typeof shortUrl === "string" && isValidOfficialAffiliateUrl(shortUrl, "mercadolivre")) {
            return {
                ok: true,
                platform: "mercadolivre",
                affiliateUrl: shortUrl.trim(),
            };
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Gerador do Mercado Livre via endpoint oficial/autorizado configurado no ambiente
 * ou geração direta via Cookie da sessão de afiliado.
 */
export function createMercadoLivreAffiliateGenerator(
    opts: { env?: Record<string, string | undefined>; fetchFn?: SafeFetchFn } = {}
): AffiliateGenerator {
    const env = opts.env || process.env;
    const fetchFn = opts.fetchFn || defaultFetch;

    return {
        async generate(input: AffiliateGenerationInput): Promise<AffiliateGenerationResult> {
            const status = getPlatformIntegrationStatus("mercadolivre", env);
            if (!status.enabled || !status.configured) {
                logger.warn(
                    "Affiliate",
                    `Integração Mercado Livre desativada/não configurada. Variáveis ausentes: ${status.missingEnvVars.join(", ")}`
                );
                return {
                    ok: false,
                    platform: "mercadolivre",
                    reason: "integration_unconfigured",
                    missingEnvVars: status.missingEnvVars,
                };
            }

            const endpoint = String(env.MERCADOLIVRE_AFFILIATE_API_URL).trim();
            const token = String(env.MERCADOLIVRE_AFFILIATE_TOKEN || "").trim();
            const tag = String(env.MERCADOLIVRE_AFFILIATE_TAG || "venddor17").trim();

            // Se o token contém cookies reais do Mercado Livre, tenta geração direta primeiro
            const isCookie = token.includes("ssid=") || token.includes("orguserid=") || token.includes("orgnickp=");
            if (isCookie && !opts.fetchFn) {
                const directResult = await generateMercadoLivreDirect(input.canonicalProductUrl, token, tag);
                if (directResult?.ok) {
                    return directResult;
                }
            }

            try {
                const reqHeaders: Record<string, string> = {
                    "Content-Type": "application/json",
                };
                if (token) {
                    reqHeaders["Authorization"] = `Bearer ${token}`;
                }
                const bodyStr = JSON.stringify({
                    url: input.canonicalProductUrl,
                    productId: input.productId,
                    tag,
                    cookie: token, // Passa o Cookie do Mercado Livre no body para o n8n
                });

                const res = opts.fetchFn
                    ? await fetchFn(endpoint, {
                          method: "POST",
                          headers: reqHeaders,
                          body: bodyStr,
                          signal: AbortSignal.timeout(AFFILIATE_LIMITS.GENERATOR_TIMEOUT_MS),
                      })
                    : await postJsonNative(
                          endpoint,
                          reqHeaders,
                          bodyStr,
                          AFFILIATE_LIMITS.GENERATOR_TIMEOUT_MS
                      );

                if (res.status === 401 || res.status === 403) {
                    logger.error("Affiliate", "API de afiliados do Mercado Livre retornou erro de autenticação.");
                    return { ok: false, platform: "mercadolivre", reason: "auth_error" };
                }

                if (res.status === 400 || res.status === 422) {
                    logger.warn(
                        "Affiliate",
                        `Produto rejeitado pelo gerador Mercado Livre: ${redactUrlForLog(input.canonicalProductUrl)}`
                    );
                    return { ok: false, platform: "mercadolivre", reason: "product_rejected" };
                }

                if (!res.ok) {
                    logger.warn("Affiliate", `Serviço de afiliados Mercado Livre indisponível (HTTP ${res.status}).`);
                    return { ok: false, platform: "mercadolivre", reason: "service_unavailable" };
                }

                const data: any = await res.json().catch(() => null);
                const affiliateUrl = data?.affiliateUrl || data?.shortUrl || data?.url;
                if (typeof affiliateUrl !== "string" || !isValidOfficialAffiliateUrl(affiliateUrl, "mercadolivre")) {
                    logger.error(
                        "Affiliate",
                        "Serviço de afiliados Mercado Livre retornou saída inválida ou fora do domínio oficial."
                    );
                    return { ok: false, platform: "mercadolivre", reason: "invalid_generator_output" };
                }

                return {
                    ok: true,
                    platform: "mercadolivre",
                    affiliateUrl: affiliateUrl.trim(),
                };
            } catch (err: any) {
                const isTimeout =
                    err?.name === "TimeoutError" ||
                    err?.name === "AbortError" ||
                    String(err?.message || "").toLowerCase().includes("timeout");
                logger.warn(
                    "Affiliate",
                    `Falha ao chamar gerador Mercado Livre (${isTimeout ? "timeout" : "erro de rede"}).`
                );
                return {
                    ok: false,
                    platform: "mercadolivre",
                    reason: isTimeout ? "timeout" : "service_unavailable",
                };
            }
        },
    };
}
