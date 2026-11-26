import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, hasRole } from "@/lib/api-auth";
import { createOAuthState } from "@/modules/instagram/crypto";
import { buildInstagramAuthorizeUrl, getInstagramOAuthConfig } from "@/modules/instagram/client";

export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!hasRole(user.role, "OWNER")) {
        return NextResponse.json({ status: false, error: "Permissão insuficiente." }, { status: 403 });
    }

    const cfg = getInstagramOAuthConfig();
    if (!cfg.isConfigured) {
        return NextResponse.json(
            {
                status: false,
                error: "INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET não estão configurados no servidor.",
            },
            { status: 400 }
        );
    }

    const state = createOAuthState(user.id);
    const url = buildInstagramAuthorizeUrl(state);

    const shouldRedirect = request.nextUrl.searchParams.get("redirect") === "1";
    if (shouldRedirect) {
        return NextResponse.redirect(url);
    }

    return NextResponse.json({ status: true, data: { url } });
}
