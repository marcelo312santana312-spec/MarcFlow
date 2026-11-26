import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptToken, verifyOAuthState } from "@/modules/instagram/crypto";
import { exchangeCodeForLongLivedToken, fetchInstagramProfile } from "@/modules/instagram/client";
import { getPublicBaseUrl } from "@/modules/instagram/validation";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
    const baseUrl = getPublicBaseUrl();
    const redirectDashboard = (params: Record<string, string>) => {
        const target = new URL(`${baseUrl}/dashboard/instagram`);
        for (const [k, v] of Object.entries(params)) {
            target.searchParams.set(k, v);
        }
        return NextResponse.redirect(target.toString());
    };

    const errorParam = request.nextUrl.searchParams.get("error");
    const errorDescription =
        request.nextUrl.searchParams.get("error_description") ||
        request.nextUrl.searchParams.get("error_reason") ||
        errorParam;

    if (errorParam) {
        return redirectDashboard({ error: errorDescription || "Autorização cancelada no Instagram." });
    }

    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");

    if (!code || !state) {
        return redirectDashboard({ error: "Parâmetros code ou state ausentes no retorno do Instagram." });
    }

    const verifiedState = verifyOAuthState(state);
    if (!verifiedState) {
        return redirectDashboard({ error: "Sessão OAuth expirada ou assinatura inválida. Tente conectar novamente." });
    }

    try {
        const cleanCode = code.replace(/#_$/, "");
        const tokenData = await exchangeCodeForLongLivedToken(cleanCode);
        const profile = await fetchInstagramProfile(tokenData.accessToken);
        const encryptedToken = encryptToken(tokenData.accessToken);
        const tokenExpiresAt = new Date(Date.now() + tokenData.expiresIn * 1000);

        await prisma.instagramAccount.upsert({
            where: {
                userId_igUserId: {
                    userId: verifiedState.userId,
                    igUserId: profile.igUserId,
                },
            },
            update: {
                username: profile.username,
                name: profile.name || null,
                profilePictureUrl: profile.profilePictureUrl || null,
                accountType: profile.accountType || null,
                accessToken: encryptedToken,
                tokenExpiresAt,
                status: "CONNECTED",
                lastError: null,
            },
            create: {
                userId: verifiedState.userId,
                igUserId: profile.igUserId,
                username: profile.username,
                name: profile.name || null,
                profilePictureUrl: profile.profilePictureUrl || null,
                accountType: profile.accountType || null,
                accessToken: encryptedToken,
                tokenExpiresAt,
                status: "CONNECTED",
            },
        });

        await prisma.instagramAccessRequest.updateMany({
            where: {
                userId: verifiedState.userId,
                status: { in: ["PENDING", "APPROVED"] },
                igUsername: profile.username.toLowerCase(),
            },
            data: {
                status: "COMPLETED",
                completedAt: new Date(),
            },
        });

        logger.info("Instagram", `Conta @${profile.username} conectada para usuário ${verifiedState.userId}`);
        return redirectDashboard({ connected: `@${profile.username}` });
    } catch (err: any) {
        logger.error("Instagram", "Erro no callback OAuth:", err);
        return redirectDashboard({
            error: err?.message || "Não foi possível concluir a conexão com o Instagram.",
        });
    }
}
