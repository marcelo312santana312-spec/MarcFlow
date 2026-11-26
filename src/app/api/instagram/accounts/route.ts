import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, hasRole, isAdmin } from "@/lib/api-auth";
import { getInstagramOAuthConfig } from "@/modules/instagram/client";
import { getPublicBaseUrl, isPublicHttpsUrl } from "@/modules/instagram/validation";

export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!hasRole(user.role, "OWNER")) {
        return NextResponse.json({ status: false, error: "Permissão insuficiente." }, { status: 403 });
    }

    const accounts = await prisma.instagramAccount.findMany({
        where: isAdmin(user.role) ? undefined : { userId: user.id },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            userId: true,
            igUserId: true,
            username: true,
            name: true,
            profilePictureUrl: true,
            accountType: true,
            tokenExpiresAt: true,
            status: true,
            lastError: true,
            createdAt: true,
            updatedAt: true,
            _count: {
                select: { posts: true },
            },
        },
    });

    const cfg = getInstagramOAuthConfig();
    const publicBaseUrl = getPublicBaseUrl();

    return NextResponse.json({
        status: true,
        data: {
            accounts,
            config: {
                configured: cfg.isConfigured,
                redirectUri: cfg.redirectUri,
                publicBaseUrl,
                isHttpsPublicUrl: isPublicHttpsUrl(publicBaseUrl),
                graphVersion: cfg.graphVersion,
            },
        },
    });
}
