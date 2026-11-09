import { prisma } from "@/lib/prisma";
import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const { sessionId } = await params;

    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        // @ts-ignore
        const session = await (prisma as any).session.findUnique({
            where: { sessionId },
            select: { id: true, botConfig: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        // Return config or default if null
        session.botConfig = session.botConfig || {
            enabled: true,
            botMode: 'OWNER',
            botAllowedJids: [],
            botBlockedJids: [],
            autoReplyMode: 'ALL',
            autoReplyAllowedJids: [],
            autoReplyBlockedJids: [],
            enableSticker: true,
            enablePing: true,
            enableUptime: true,
            botName: "MarcFlow Bot",
            removeBgApiKey: null,
            enableVideoSticker: true,
            maxStickerDuration: 10,
            prefix: "#",
            antiSpamEnabled: false,
            spamLimit: 5,
            spamInterval: 10,
            spamDelayMin: 1000,
            spamDelayMax: 3000,
            welcomeMessage: null,
            autoRead: false,
            alwaysOnline: false,
            aiEnabled: false,
            aiApiKey: null,
            aiModel: "gemini-3.8-flash",
            aiSystemPrompt: null,
            aiTriggerType: "ALL",
            aiContextLimit: 10,
        };

        return NextResponse.json({ status: true, message: "Bot config fetched successfully", data: session.botConfig });
    } catch (error) {
        console.error("Get Bot Config Error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const { sessionId } = await params;

    try {
        const user = await getAuthenticatedUser(request);
        if (!user) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });

        const body = await request.json();

        // Find session DB ID
        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        if (!session) return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });

        // Monta os campos de update dinamicamente para suportar updates parciais (ex: apenas aiEnabled)
        const updateData: Record<string, any> = {};
        if (body.enabled !== undefined) updateData.enabled = Boolean(body.enabled);
        if (body.botMode !== undefined) updateData.botMode = body.botMode;
        if (body.botAllowedJids !== undefined) updateData.botAllowedJids = body.botAllowedJids;
        if (body.botBlockedJids !== undefined) updateData.botBlockedJids = body.botBlockedJids;
        if (body.autoReplyMode !== undefined) updateData.autoReplyMode = body.autoReplyMode;
        if (body.autoReplyAllowedJids !== undefined) updateData.autoReplyAllowedJids = body.autoReplyAllowedJids;
        if (body.autoReplyBlockedJids !== undefined) updateData.autoReplyBlockedJids = body.autoReplyBlockedJids;
        if (body.botName !== undefined) updateData.botName = body.botName;
        if (body.enableSticker !== undefined) updateData.enableSticker = body.enableSticker;
        if (body.enableVideoSticker !== undefined) updateData.enableVideoSticker = body.enableVideoSticker;
        if (body.maxStickerDuration !== undefined) updateData.maxStickerDuration = body.maxStickerDuration;
        if (body.enablePing !== undefined) updateData.enablePing = body.enablePing;
        if (body.enableUptime !== undefined) updateData.enableUptime = body.enableUptime;
        if (body.removeBgApiKey !== undefined) updateData.removeBgApiKey = body.removeBgApiKey || null;
        if (body.prefix !== undefined) updateData.prefix = body.prefix;
        if (body.antiSpamEnabled !== undefined) updateData.antiSpamEnabled = body.antiSpamEnabled;
        if (body.spamLimit !== undefined) updateData.spamLimit = body.spamLimit;
        if (body.spamInterval !== undefined) updateData.spamInterval = body.spamInterval;
        if (body.spamDelayMin !== undefined) updateData.spamDelayMin = body.spamDelayMin;
        if (body.spamDelayMax !== undefined) updateData.spamDelayMax = body.spamDelayMax;
        if (body.welcomeMessage !== undefined) updateData.welcomeMessage = body.welcomeMessage || null;
        if (body.autoRead !== undefined) updateData.autoRead = body.autoRead;
        if (body.alwaysOnline !== undefined) updateData.alwaysOnline = body.alwaysOnline;
        if (body.aiEnabled !== undefined) updateData.aiEnabled = Boolean(body.aiEnabled);
        if (body.aiApiKey !== undefined) updateData.aiApiKey = body.aiApiKey || null;
        if (body.aiModel !== undefined) updateData.aiModel = body.aiModel || "gemini-3.8-flash";
        if (body.aiSystemPrompt !== undefined) updateData.aiSystemPrompt = body.aiSystemPrompt || null;
        if (body.aiTriggerType !== undefined) updateData.aiTriggerType = body.aiTriggerType || "ALL";
        if (body.aiContextLimit !== undefined) updateData.aiContextLimit = Number(body.aiContextLimit) || 10;

        // Upsert Config
        // @ts-ignore
        const config = await (prisma as any).botConfig.upsert({
            where: { sessionId: session.id },
            create: {
                sessionId: session.id,
                enabled: body.enabled ?? true,
                botMode: body.botMode || 'OWNER',
                botAllowedJids: body.botAllowedJids || [],
                botBlockedJids: body.botBlockedJids || [],
                autoReplyMode: body.autoReplyMode || 'ALL',
                autoReplyAllowedJids: body.autoReplyAllowedJids || [],
                autoReplyBlockedJids: body.autoReplyBlockedJids || [],

                enableSticker: body.enableSticker ?? true,
                enableVideoSticker: body.enableVideoSticker ?? true,
                maxStickerDuration: body.maxStickerDuration || 10,
                enablePing: body.enablePing ?? true,
                enableUptime: body.enableUptime ?? true,
                removeBgApiKey: body.removeBgApiKey || null,
                prefix: body.prefix || "#",
                antiSpamEnabled: body.antiSpamEnabled ?? false,
                spamLimit: body.spamLimit || 5,
                spamInterval: body.spamInterval || 10,
                spamDelayMin: body.spamDelayMin || 1000,
                spamDelayMax: body.spamDelayMax || 3000,
                welcomeMessage: body.welcomeMessage || null,
                autoRead: body.autoRead ?? false,
                alwaysOnline: body.alwaysOnline ?? false,
                aiEnabled: body.aiEnabled !== undefined ? Boolean(body.aiEnabled) : false,
                aiApiKey: body.aiApiKey || null,
                aiModel: body.aiModel || "gemini-3.8-flash",
                aiSystemPrompt: body.aiSystemPrompt || null,
                aiTriggerType: body.aiTriggerType || "ALL",
                aiContextLimit: Number(body.aiContextLimit) || 10,
            },
            update: updateData
        });

        return NextResponse.json({ status: true, message: "Bot config updated successfully", data: config });
    } catch (error) {
        console.error("Update Bot Config Error:", error);
        return NextResponse.json({ status: false, message: "Failed to update config", error: "Failed to update config" }, { status: 500 });
    }
}
