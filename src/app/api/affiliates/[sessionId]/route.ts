import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";
import { ensureAffiliateSocketBound } from "@/modules/whatsapp/store/autoreply";
import {
    getPlatformIntegrationStatus,
    IdempotencyStore,
    processIncomingAffiliateMessage,
    resolveAffiliateEnv,
    resolveAffiliateTemplates,
    StoredAffiliateSettings,
} from "@/modules/affiliate";

function maskSecret(secret?: string | null): string {
    if (!secret || secret.length < 6) return "";
    return `${secret.slice(0, 3)}${"•".repeat(8)}${secret.slice(-3)}`;
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true, config: true },
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Sessão não encontrada" }, { status: 404 });
        }

        const stored = ((session.config as any)?.affiliate as StoredAffiliateSettings) || {};
        const effectiveEnv = resolveAffiliateEnv(stored, process.env);
        const templates = resolveAffiliateTemplates(stored);

        const shopeeStatus = getPlatformIntegrationStatus("shopee", effectiveEnv);
        const mlStatus = getPlatformIntegrationStatus("mercadolivre", effectiveEnv);

        const shopeeSecretVal = effectiveEnv.SHOPEE_AFFILIATE_SECRET || "";
        const mlTokenVal = effectiveEnv.MERCADOLIVRE_AFFILIATE_TOKEN || "";

        const autoReplyEnabled =
            stored.enabled !== undefined
                ? stored.enabled
                : effectiveEnv.AFFILIATE_AUTO_REPLY_ENABLED !== "false";

        const [totalConversions, shopeeCount, mlCount, recentList] = await Promise.all([
            prisma.affiliateConversion.count({ where: { sessionId } }),
            prisma.affiliateConversion.count({ where: { sessionId, platform: "shopee", status: "success" } }),
            prisma.affiliateConversion.count({ where: { sessionId, platform: "mercadolivre", status: "success" } }),
            prisma.affiliateConversion.findMany({ where: { sessionId }, orderBy: { createdAt: "desc" }, take: 50 })
        ]);

        return NextResponse.json({
            status: true,
            data: {
                stats: {
                    total: totalConversions,
                    shopee: shopeeCount,
                    mercadolivre: mlCount,
                    recent: recentList
                },
                enabled: autoReplyEnabled,
                shopee: {
                    enabled: stored.shopee?.enabled ?? effectiveEnv.SHOPEE_AFFILIATE_ENABLED !== "false",
                    appId: effectiveEnv.SHOPEE_AFFILIATE_APP_ID || "",
                    hasSecret: Boolean(shopeeSecretVal.trim()),
                    secretPreview: maskSecret(shopeeSecretVal),
                    apiUrl:
                        effectiveEnv.SHOPEE_AFFILIATE_API_URL ||
                        "https://open-api.affiliate.shopee.com.br/graphql",
                    configured: shopeeStatus.configured,
                },
                mercadolivre: {
                    enabled:
                        stored.mercadolivre?.enabled ??
                        effectiveEnv.MERCADOLIVRE_AFFILIATE_ENABLED !== "false",
                    apiUrl:
                        effectiveEnv.MERCADOLIVRE_AFFILIATE_API_URL ||
                        "http://localhost:5678/webhook/meli-affiliate",
                    tag: effectiveEnv.MERCADOLIVRE_AFFILIATE_TAG || "venddor17",
                    hasToken: Boolean(mlTokenVal.trim()),
                    tokenPreview: maskSecret(mlTokenVal),
                    configured: mlStatus.configured,
                },
                templates,
            },
        });
    } catch (err: any) {
        console.error("GET affiliate error:", err);
        return NextResponse.json(
            { status: false, message: "Erro ao carregar configurações de afiliados" },
            { status: 500 }
        );
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true, config: true },
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Sessão não encontrada" }, { status: 404 });
        }

        const body = await request.json();
        const currentConfig = ((session.config as any) || {}) as Record<string, any>;
        const prevAffiliate = (currentConfig.affiliate || {}) as StoredAffiliateSettings;

        const newShopeeSecret =
            typeof body.shopee?.secret === "string" && body.shopee.secret.trim() !== ""
                ? body.shopee.secret.trim()
                : prevAffiliate.shopee?.secret;

        const newMlToken =
            typeof body.mercadolivre?.token === "string" && body.mercadolivre.token.trim() !== ""
                ? body.mercadolivre.token.trim()
                : prevAffiliate.mercadolivre?.token;

        const updatedAffiliate: StoredAffiliateSettings = {
            enabled: body.enabled !== undefined ? Boolean(body.enabled) : prevAffiliate.enabled ?? true,
            shopee: {
                enabled:
                    body.shopee?.enabled !== undefined
                        ? Boolean(body.shopee.enabled)
                        : prevAffiliate.shopee?.enabled ?? true,
                appId:
                    typeof body.shopee?.appId === "string"
                        ? body.shopee.appId.trim()
                        : prevAffiliate.shopee?.appId,
                secret: newShopeeSecret,
                apiUrl:
                    typeof body.shopee?.apiUrl === "string" && body.shopee.apiUrl.trim()
                        ? body.shopee.apiUrl.trim()
                        : prevAffiliate.shopee?.apiUrl ||
                          "https://open-api.affiliate.shopee.com.br/graphql",
            },
            mercadolivre: {
                enabled:
                    body.mercadolivre?.enabled !== undefined
                        ? Boolean(body.mercadolivre.enabled)
                        : prevAffiliate.mercadolivre?.enabled ?? true,
                apiUrl:
                    typeof body.mercadolivre?.apiUrl === "string"
                        ? body.mercadolivre.apiUrl.trim()
                        : prevAffiliate.mercadolivre?.apiUrl,
                tag:
                    typeof body.mercadolivre?.tag === "string" && body.mercadolivre.tag.trim()
                        ? body.mercadolivre.tag.trim()
                        : prevAffiliate.mercadolivre?.tag || "venddor17",
                token: newMlToken,
            },
            templates: {
                ...resolveAffiliateTemplates(prevAffiliate),
                ...(body.templates || {}),
            },
        };

        const updatedConfig = {
            ...currentConfig,
            affiliate: updatedAffiliate,
        };

        await prisma.session.update({
            where: { sessionId },
            data: { config: updatedConfig as any },
        });

        // Garante que o listener de tempo real está vinculado se a sessão estiver ativa
        const instance = waManager.getInstance(sessionId);
        if (instance) {
            instance.config = updatedConfig;
            if (instance.socket) {
                ensureAffiliateSocketBound(instance.socket, sessionId);
            }
        }

        return NextResponse.json({
            status: true,
            message: "Configurações de afiliados salvas com sucesso!",
        });
    } catch {
        return NextResponse.json(
            { status: false, message: "Erro ao salvar configurações de afiliados" },
            { status: 500 }
        );
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true, config: true },
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Sessão não encontrada" }, { status: 404 });
        }

        const body = await request.json();
        const testText = String(body.testText || "").trim();
        if (!testText) {
            return NextResponse.json(
                { status: false, message: "Informe uma mensagem ou link para testar." },
                { status: 400 }
            );
        }

        const stored = ((session.config as any)?.affiliate as StoredAffiliateSettings) || null;
        const result = await processIncomingAffiliateMessage(
            {
                sessionId,
                messageId: `sim-${Date.now()}`,
                remoteJid: "5511999999999@s.whatsapp.net",
                fromMe: false,
                isGroup: false,
                text: testText,
            },
            {
                settings: stored,
                idempotencyStore: new IdempotencyStore(),
            }
        );

        return NextResponse.json({
            status: true,
            data: result,
        });
    } catch {
        return NextResponse.json(
            { status: false, message: "Erro ao executar teste de conversão" },
            { status: 500 }
        );
    }
}
