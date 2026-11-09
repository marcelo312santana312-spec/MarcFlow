/**
 * Configuração centralizada do módulo de Afiliados (Mercado Livre e Shopee).
 *
 * COMO ATUALIZAR A ALLOWLIST DE DOMÍNIOS:
 * - Adicione apenas domínios oficiais confirmados de cada plataforma em lowercase.
 * - Domínios onde páginas finais de produto são hospedadas devem ir em `productHosts`.
 * - Domínios oficiais usados exclusivamente para links curtos/redirecionamento devem ir em `shortenerHosts`.
 * - Nunca adicione domínios genéricos de encurtadores de terceiros (ex.: bit.ly, tinyurl.com).
 */

import { loadEnvConfig } from "@next/env";

export type AffiliatePlatform = "mercadolivre" | "shopee";

export interface PlatformDomainConfig {
    /** Domínios oficiais onde páginas de produto ou navegação da plataforma residem */
    productHosts: readonly string[];
    /** Domínios oficiais de links curtos que redirecionam para productHosts */
    shortenerHosts: readonly string[];
}

export const AFFILIATE_DOMAIN_ALLOWLIST: Readonly<Record<AffiliatePlatform, PlatformDomainConfig>> = {
    mercadolivre: {
        productHosts: [
            "mercadolivre.com.br",
            "www.mercadolivre.com.br",
            "produto.mercadolivre.com.br",
            "lista.mercadolivre.com.br",
        ],
        shortenerHosts: [
            "mercadolivre.com",
            "www.mercadolivre.com",
            "meli.la",
        ],
    },
    shopee: {
        productHosts: [
            "shopee.com.br",
            "www.shopee.com.br",
        ],
        shortenerHosts: [
            "s.shopee.com.br",
            "shp.ee",
            "br.shp.ee",
        ],
    },
};

export const AFFILIATE_LIMITS = {
    /** Número máximo de redirecionamentos seguidos ao resolver um link curto */
    MAX_REDIRECTS: 5,
    /** Timeout por requisição de resolução de redirecionamento (ms) */
    RESOLVE_TIMEOUT_MS: 5000,
    /** Tamanho máximo de leitura de corpo caso necessário (bytes) */
    MAX_RESPONSE_BYTES: 32 * 1024,
    /** Quantidade máxima de URLs processadas por mensagem recebida */
    MAX_URLS_PER_MESSAGE: 5,
    /** Tamanho máximo aceito para o texto de uma mensagem recebida (caracteres) */
    MAX_MESSAGE_LENGTH: 4096,
    /** Timeout para chamada à API geradora de link de afiliado (ms) */
    GENERATOR_TIMEOUT_MS: 20000,
    /** Quantidade máxima de tentativas na API de afiliados para falhas transitórias */
    GENERATOR_MAX_RETRIES: 2,
    /** TTL de idempotência para IDs de mensagens processadas (ms) */
    IDEMPOTENCY_TTL_MS: 24 * 60 * 60 * 1000,
    /** Quantidade máxima de chaves em memória no cache de idempotência */
    IDEMPOTENCY_MAX_ENTRIES: 5000,
} as const;

export interface PlatformIntegrationStatus {
    platform: AffiliatePlatform;
    enabled: boolean;
    configured: boolean;
    missingEnvVars: string[];
}

export interface AffiliateReplyTemplates {
    singleSuccess: string;
    multiHeader: string;
    multiItem: string;
    nonProductUrl: string;
    invalidUrl: string;
    unavailablePlatform: string;
    replyWhenUnavailable: boolean;
}

export const DEFAULT_AFFILIATE_TEMPLATES: AffiliateReplyTemplates = {
    singleSuccess: "Aqui está o link do produto ({plataforma}):\n{link}",
    multiHeader: "",
    multiItem: "{indice}. {plataforma} ({id}): {link}",
    nonProductUrl:
        "O link enviado do {plataforma} aponta para um perfil, busca ou página geral. Por favor, envie a URL direta da página do produto.",
    invalidUrl:
        "Não foi possível validar o link enviado. Por favor, envie uma URL oficial direta da página do produto.",
    unavailablePlatform:
        "Não foi possível gerar o link de afiliado para {plataforma} no momento.",
    replyWhenUnavailable: true,
};

export interface StoredAffiliateSettings {
    enabled?: boolean;
    shopee?: {
        enabled?: boolean;
        appId?: string;
        secret?: string;
        apiUrl?: string;
    };
    mercadolivre?: {
        enabled?: boolean;
        apiUrl?: string;
        token?: string;
        tag?: string;
    };
    templates?: Partial<AffiliateReplyTemplates>;
}

/**
 * Mescla as configurações salvas na sessão (banco de dados) com o fallback das variáveis de ambiente (.env).
 */
export function resolveAffiliateEnv(
    stored?: StoredAffiliateSettings | null,
    baseEnv: Record<string, string | undefined> = process.env
): Record<string, string | undefined> {
    if (baseEnv === process.env && (!baseEnv.SHOPEE_AFFILIATE_APP_ID || !baseEnv.MERCADOLIVRE_AFFILIATE_API_URL)) {
        try {
            loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info: () => {}, error: () => {} }, true);
        } catch {}
    }

    if (!stored) return baseEnv;

    const merged: Record<string, string | undefined> = { ...baseEnv };

    if (stored.enabled !== undefined) {
        merged.AFFILIATE_AUTO_REPLY_ENABLED = stored.enabled ? "true" : "false";
    }

    if (stored.shopee) {
        if (stored.shopee.enabled !== undefined) {
            merged.SHOPEE_AFFILIATE_ENABLED = stored.shopee.enabled ? "true" : "false";
        }
        if (stored.shopee.appId !== undefined && stored.shopee.appId.trim() !== "") {
            merged.SHOPEE_AFFILIATE_APP_ID = stored.shopee.appId.trim();
        }
        if (stored.shopee.secret !== undefined && stored.shopee.secret.trim() !== "") {
            merged.SHOPEE_AFFILIATE_SECRET = stored.shopee.secret.trim();
        }
        if (stored.shopee.apiUrl !== undefined && stored.shopee.apiUrl.trim() !== "") {
            merged.SHOPEE_AFFILIATE_API_URL = stored.shopee.apiUrl.trim();
        }
    }

    if (stored.mercadolivre) {
        if (stored.mercadolivre.enabled !== undefined) {
            merged.MERCADOLIVRE_AFFILIATE_ENABLED = stored.mercadolivre.enabled ? "true" : "false";
        }
        if (stored.mercadolivre.apiUrl !== undefined && stored.mercadolivre.apiUrl.trim() !== "") {
            merged.MERCADOLIVRE_AFFILIATE_API_URL = stored.mercadolivre.apiUrl.trim();
        }
        if (stored.mercadolivre.token !== undefined && stored.mercadolivre.token.trim() !== "") {
            merged.MERCADOLIVRE_AFFILIATE_TOKEN = stored.mercadolivre.token.trim();
        }
        if (stored.mercadolivre.tag !== undefined && stored.mercadolivre.tag.trim() !== "") {
            merged.MERCADOLIVRE_AFFILIATE_TAG = stored.mercadolivre.tag.trim();
        }
    }

    return merged;
}

export function resolveAffiliateTemplates(
    stored?: StoredAffiliateSettings | null
): AffiliateReplyTemplates {
    return {
        ...DEFAULT_AFFILIATE_TEMPLATES,
        ...(stored?.templates || {}),
    };
}

export function renderAffiliateTemplate(
    template: string,
    vars: Record<string, string | number | undefined>
): string {
    return template.replace(/\{([a-zA-Z0-9_-]+)\}/g, (match, key) => {
        const val = vars[key];
        return val !== undefined && val !== null ? String(val) : match;
    });
}

/**
 * Verifica se as variáveis de ambiente exigidas para a integração oficial
 * de cada plataforma estão legitimamente configuradas no ambiente.
 */
export function getPlatformIntegrationStatus(
    platform: AffiliatePlatform,
    env: Record<string, string | undefined> = process.env
): PlatformIntegrationStatus {
    if (env === process.env && (!env.SHOPEE_AFFILIATE_APP_ID || !env.MERCADOLIVRE_AFFILIATE_API_URL)) {
        try {
            loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info: () => {}, error: () => {} }, true);
        } catch {}
    }

    if (platform === "mercadolivre") {
        const required = ["MERCADOLIVRE_AFFILIATE_API_URL", "MERCADOLIVRE_AFFILIATE_TOKEN"];
        const missing = required.filter((k) => !env[k] || !String(env[k]).trim());
        const enabledFlag = env.MERCADOLIVRE_AFFILIATE_ENABLED !== "false";
        return {
            platform: "mercadolivre",
            enabled: enabledFlag && missing.length === 0,
            configured: missing.length === 0,
            missingEnvVars: missing,
        };
    }

    const required = ["SHOPEE_AFFILIATE_APP_ID", "SHOPEE_AFFILIATE_SECRET"];
    const missing = required.filter((k) => !env[k] || !String(env[k]).trim());
    const enabledFlag = env.SHOPEE_AFFILIATE_ENABLED !== "false";
    return {
        platform: "shopee",
        enabled: enabledFlag && missing.length === 0,
        configured: missing.length === 0,
        missingEnvVars: missing,
    };
}
