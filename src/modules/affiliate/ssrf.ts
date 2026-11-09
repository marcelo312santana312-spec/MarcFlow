import net from "net";
import dns from "dns/promises";
import { AFFILIATE_DOMAIN_ALLOWLIST, AffiliatePlatform } from "./config";

export type DnsLookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export const defaultDnsLookup: DnsLookupFn = async (hostname: string) => {
    return dns.lookup(hostname, { all: true, verbatim: true });
};

/**
 * Verifica se um endereço IPv4 é privado, loopback, link-local, CGNAT, multicast ou reservado.
 */
export function isPrivateOrReservedIPv4(ip: string): boolean {
    const parts = ip.split(".");
    if (parts.length !== 4) return true;
    const nums = parts.map((p) => Number(p));
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;

    const [a, b, c] = nums;

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;
    // 10.0.0.0/8 (Private)
    if (a === 10) return true;
    // 100.64.0.0/10 (Shared Address Space / CGNAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (Link-local / Cloud metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (Private)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (a === 192 && b === 0 && c === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (a === 192 && b === 0 && c === 2) return true;
    // 192.168.0.0/16 (Private)
    if (a === 192 && b === 168) return true;
    // 198.18.0.0/15 (Benchmarking)
    if (a === 198 && (b === 18 || b === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (a === 198 && b === 51 && c === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (a === 203 && b === 0 && c === 113) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved / Broadcast)
    if (a >= 224) return true;

    return false;
}

/**
 * Verifica se um endereço IPv6 é loopback, não especificado, link-local, unique-local, multicast
 * ou mapeado para um IPv4 privado/reservado.
 */
export function isPrivateOrReservedIPv6(rawIp: string): boolean {
    const ip = rawIp.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];

    if (ip === "::" || ip === "::1" || ip === "0:0:0:0:0:0:0:1" || ip === "0:0:0:0:0:0:0:0") {
        return true;
    }

    // IPv4-mapped IPv6 (ex.: ::ffff:127.0.0.1 ou ::ffff:7f00:1)
    if (ip.startsWith("::ffff:")) {
        const tail = ip.slice("::ffff:".length);
        if (net.isIPv4(tail)) {
            return isPrivateOrReservedIPv4(tail);
        }
        // Hex representation ::ffff:7f00:0001
        const hexParts = tail.split(":");
        if (hexParts.length === 2) {
            const hi = parseInt(hexParts[0], 16);
            const lo = parseInt(hexParts[1], 16);
            if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
                const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
                return isPrivateOrReservedIPv4(ipv4);
            }
        }
        return true;
    }

    // fc00::/7 (Unique local fc00:: - fdff::)
    if (ip.startsWith("fc") || ip.startsWith("fd")) return true;
    // fe80::/10 (Link-local fe8, fe9, fea, feb)
    if (ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb")) return true;
    // ff00::/8 (Multicast)
    if (ip.startsWith("ff")) return true;
    // 2001:db8::/32 (Documentation)
    if (ip.startsWith("2001:db8:") || ip.startsWith("2001:0db8:")) return true;

    return false;
}

/**
 * Verifica se qualquer IP literal (IPv4 ou IPv6) é privado/reservado/inválido.
 */
export function isForbiddenIpAddress(address: string): boolean {
    const clean = address.trim().replace(/^\[|\]$/g, "");
    const version = net.isIP(clean);
    if (version === 4) return isPrivateOrReservedIPv4(clean);
    if (version === 6) return isPrivateOrReservedIPv6(clean);
    return true;
}

export interface ParsedSafeUrlResult {
    ok: boolean;
    url?: URL;
    normalizedHost?: string;
    reason?:
        | "malformed_url"
        | "invalid_scheme"
        | "credentials_not_allowed"
        | "invalid_port"
        | "forbidden_host_or_ip";
}

/**
 * Faz o parse real e normalização segura de uma URL, bloqueando esquemas não HTTP/HTTPS,
 * credenciais embutidas, portas não padrão, localhost e IPs privados/reservados.
 */
export function parseAndValidateUrlStructure(rawInput: string): ParsedSafeUrlResult {
    if (!rawInput || typeof rawInput !== "string" || rawInput.length > 2048) {
        return { ok: false, reason: "malformed_url" };
    }

    let parsed: URL;
    try {
        parsed = new URL(rawInput.trim());
    } catch {
        return { ok: false, reason: "malformed_url" };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, reason: "invalid_scheme" };
    }

    if (parsed.username || parsed.password) {
        return { ok: false, reason: "credentials_not_allowed" };
    }

    if (parsed.port !== "" && parsed.port !== "80" && parsed.port !== "443") {
        return { ok: false, reason: "invalid_port" };
    }

    // Normaliza host (URL já converte IDN para punycode ASCII em lowercase)
    const normalizedHost = parsed.hostname.toLowerCase().replace(/\.+$/, "");
    if (!normalizedHost) {
        return { ok: false, reason: "malformed_url" };
    }

    // Bloqueia localhost, domínios internos e IPs literais diretamente na URL
    if (
        normalizedHost === "localhost" ||
        normalizedHost.endsWith(".localhost") ||
        normalizedHost.endsWith(".local") ||
        normalizedHost.endsWith(".internal") ||
        normalizedHost.endsWith(".arpa")
    ) {
        return { ok: false, reason: "forbidden_host_or_ip" };
    }

    const strippedIpv6 = normalizedHost.replace(/^\[|\]$/g, "");
    if (net.isIP(strippedIpv6) !== 0) {
        // Nunca aceitamos IP literal como domínio de loja
        return { ok: false, reason: "forbidden_host_or_ip" };
    }

    // Rejeita formato octal/hex/decimal de IPv4 disfarçado de hostname (ex.: 2130706433 ou 0x7f.0.0.1)
    if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/i.test(normalizedHost)) {
        return { ok: false, reason: "forbidden_host_or_ip" };
    }

    return {
        ok: true,
        url: parsed,
        normalizedHost,
    };
}

export interface HostClassification {
    platform: AffiliatePlatform | "other";
    isShortener: boolean;
    isProductHost: boolean;
}

/**
 * Compara o hostname exato e completo contra a allowlist explícita de domínios oficiais.
 * Não aceita substrings (rejeita ex.: mercadolivre.exemplo.com ou fake-shopee.com.br).
 */
export function classifyHostByAllowlist(
    normalizedHost: string,
    allowlist = AFFILIATE_DOMAIN_ALLOWLIST
): HostClassification {
    const host = normalizedHost.toLowerCase().replace(/\.+$/, "");

    for (const platform of ["mercadolivre", "shopee"] as const) {
        const cfg = allowlist[platform];
        if (cfg.productHosts.includes(host)) {
            return { platform, isShortener: false, isProductHost: true };
        }
        if (cfg.shortenerHosts.includes(host)) {
            return { platform, isShortener: true, isProductHost: false };
        }
    }

    return { platform: "other", isShortener: false, isProductHost: false };
}

/**
 * Resolve o DNS do host e garante que nenhum registro A/AAAA aponta para IP privado/reservado (anti-DNS rebinding).
 */
export async function assertHostResolvesToPublicIp(
    hostname: string,
    lookupFn: DnsLookupFn = defaultDnsLookup
): Promise<{ ok: boolean; reason?: string }> {
    const cleanHost = hostname.toLowerCase().replace(/\.+$/, "").replace(/^\[|\]$/g, "");
    if (net.isIP(cleanHost) !== 0) {
        return { ok: false, reason: "ip_literal_not_allowed" };
    }

    try {
        const records = await lookupFn(cleanHost);
        if (!records || records.length === 0) {
            return { ok: false, reason: "dns_empty" };
        }
        for (const rec of records) {
            if (!rec.address || isForbiddenIpAddress(rec.address)) {
                return { ok: false, reason: "private_or_reserved_ip" };
            }
        }
        return { ok: true };
    } catch {
        return { ok: false, reason: "dns_lookup_failed" };
    }
}

/**
 * Sanitiza uma URL antes de colocá-la em logs (remove query string e fragmento para não vazar tokens/dados sensíveis).
 */
export function redactUrlForLog(rawUrl: string): string {
    try {
        const u = new URL(rawUrl);
        return `${u.protocol}//${u.hostname}${u.pathname}`;
    } catch {
        return "[invalid-url]";
    }
}
