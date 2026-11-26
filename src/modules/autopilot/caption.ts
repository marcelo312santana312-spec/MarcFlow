import {
    createMercadoLivreAffiliateGenerator,
    createShopeeAffiliateGenerator,
} from "@/modules/affiliate/generators";
import { resolveAffiliateEnv, StoredAffiliateSettings } from "@/modules/affiliate/config";
import { extractUrlsFromText, validateAndResolveCandidateUrl } from "@/modules/affiliate/url-validator";

export interface AutoPilotCaptionInput {
    itemTitle: string;
    itemCaption?: string | null;
    itemProductUrl?: string | null;
    itemPriceText?: string | null;
    itemCouponCode?: string | null;
    captionTemplate?: string | null;
    resellerLink?: string | null;
    resellerWhatsapp?: string | null;
    resellerCoupon?: string | null;
    convertAffiliateLinks?: boolean;
    affiliateSettings?: StoredAffiliateSettings | null;
}

/**
 * Converte URLs Shopee / Mercado Livre em links de afiliado quando configurado;
 * caso contrário mantém a URL original sem inventar ou quebrar o texto.
 */
export async function resolveProductOrAffiliateLink(
    rawUrl: string | null | undefined,
    resellerFallbackLink: string | null | undefined,
    convertAffiliateLinks: boolean,
    affiliateSettings?: StoredAffiliateSettings | null
): Promise<string> {
    const baseUrl = (rawUrl || "").trim() || (resellerFallbackLink || "").trim();
    if (!baseUrl) return "";

    if (!convertAffiliateLinks) {
        return baseUrl;
    }

    try {
        const validation = await validateAndResolveCandidateUrl(baseUrl);
        if (
            validation.kind !== "product" ||
            (validation.platform !== "shopee" && validation.platform !== "mercadolivre") ||
            !validation.canonicalProductUrl ||
            !validation.productId
        ) {
            return baseUrl;
        }

        const effectiveEnv = resolveAffiliateEnv(affiliateSettings, process.env);
        const generator =
            validation.platform === "shopee"
                ? createShopeeAffiliateGenerator({ env: effectiveEnv })
                : createMercadoLivreAffiliateGenerator({ env: effectiveEnv });

        const result = await generator.generate({
            platform: validation.platform,
            canonicalProductUrl: validation.canonicalProductUrl,
            productId: validation.productId,
        });
        if (result.ok && result.affiliateUrl) {
            return result.affiliateUrl;
        }
        return baseUrl;
    } catch {
        return baseUrl;
    }
}

/**
 * Renderiza a legenda final substituindo variáveis de produto e de revendedor/afiliado:
 * {produto}, {preco}, {link}, {cupom}, {whatsapp}, {legenda}
 */
export async function buildAutoPilotCaption(input: AutoPilotCaptionInput): Promise<string> {
    const resolvedLink = await resolveProductOrAffiliateLink(
        input.itemProductUrl,
        input.resellerLink,
        Boolean(input.convertAffiliateLinks),
        input.affiliateSettings
    );

    let baseCaption = (input.itemCaption || "").trim();

    // Se a própria legenda do item tiver uma URL da Shopee/ML e convertAffiliateLinks=true, também converte inline
    if (baseCaption && input.convertAffiliateLinks) {
        const urls = extractUrlsFromText(baseCaption);
        for (const u of urls.slice(0, 3)) {
            const converted = await resolveProductOrAffiliateLink(
                u,
                null,
                true,
                input.affiliateSettings
            );
            if (converted && converted !== u) {
                baseCaption = baseCaption.split(u).join(converted);
            }
        }
    }

    const finalCoupon = (input.resellerCoupon || "").trim() || (input.itemCouponCode || "").trim();
    const finalPrice = (input.itemPriceText || "").trim();
    const finalWhatsapp = (input.resellerWhatsapp || "").trim();
    const template = (input.captionTemplate || "").trim();

    if (template) {
        const vars: Record<string, string> = {
            produto: input.itemTitle || "",
            preco: finalPrice,
            link: resolvedLink,
            cupom: finalCoupon,
            whatsapp: finalWhatsapp,
            legenda: baseCaption || input.itemTitle || "",
        };

        return template
            .replace(/\{([a-zA-Z0-9_-]+)\}/g, (_, key) => vars[key.toLowerCase()] ?? "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    const parts: string[] = [];
    if (baseCaption) {
        parts.push(baseCaption);
    } else if (input.itemTitle) {
        parts.push(`✨ ${input.itemTitle}`);
    }

    if (finalPrice && !baseCaption.includes(finalPrice)) {
        parts.push(`💰 Por apenas ${finalPrice}`);
    }
    if (finalCoupon && !baseCaption.includes(finalCoupon)) {
        parts.push(`🏷️ Cupom: ${finalCoupon}`);
    }
    if (resolvedLink && !baseCaption.includes(resolvedLink)) {
        parts.push(`🛒 Garanta o seu aqui: ${resolvedLink}`);
    }
    if (finalWhatsapp && !baseCaption.includes(finalWhatsapp)) {
        parts.push(`📲 Pedido direto no WhatsApp: ${finalWhatsapp}`);
    }

    return parts.join("\n\n").trim();
}
