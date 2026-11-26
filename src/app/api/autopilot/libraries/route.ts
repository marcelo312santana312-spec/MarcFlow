import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, hasRole, isAdmin } from "@/lib/api-auth";
import { extractGoogleDriveFolderId } from "@/modules/autopilot/drive";
import { generateShareCode, syncLibraryFromDrive } from "@/modules/autopilot/scheduler";

export const dynamic = "force-dynamic";

const createLibrarySchema = z.object({
    name: z.string().min(2).max(120),
    description: z.string().max(1000).optional().nullable(),
    sourceType: z.enum(["MANUAL", "GOOGLE_DRIVE"]).default("MANUAL"),
    driveFolderUrl: z.string().max(500).optional().nullable(),
    syncEnabled: z.boolean().default(true),
    syncHour: z.number().int().min(0).max(23).default(6),
    isShared: z.boolean().default(false),
    syncNow: z.boolean().default(true),
});

export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!hasRole(user.role, "OWNER")) {
        return NextResponse.json({ status: false, error: "Permissão insuficiente." }, { status: 403 });
    }

    const shareLookup = (request.nextUrl.searchParams.get("shareCode") || "").trim().toUpperCase();
    if (shareLookup) {
        const found = await prisma.contentLibrary.findFirst({
            where: { shareCode: shareLookup, isShared: true },
            select: {
                id: true,
                name: true,
                description: true,
                sourceType: true,
                shareCode: true,
                user: { select: { name: true, email: true } },
                _count: { select: { items: true } },
            },
        });
        if (!found) {
            return NextResponse.json(
                { status: false, error: "Nenhum repositório compartilhado encontrado com esse código." },
                { status: 404 }
            );
        }
        return NextResponse.json({ status: true, data: found });
    }

    const ownLibraries = await prisma.contentLibrary.findMany({
        where: isAdmin(user.role) ? undefined : { userId: user.id },
        orderBy: { createdAt: "desc" },
        include: {
            items: {
                orderBy: { createdAt: "desc" },
                take: 40,
            },
            _count: {
                select: { items: true, rules: true },
            },
        },
    });

    // Também lista bibliotecas compartilhadas que este cliente já vinculou às suas regras
    const ruleLinks = await prisma.autoPostRule.findMany({
        where: { userId: user.id },
        select: { libraryId: true },
    });
    const ownIds = new Set(ownLibraries.map((l) => l.id));
    const subscribedIds = Array.from(new Set(ruleLinks.map((r) => r.libraryId))).filter((id) => !ownIds.has(id));

    const subscribedLibraries =
        subscribedIds.length > 0
            ? await prisma.contentLibrary.findMany({
                  where: { id: { in: subscribedIds }, isShared: true },
                  include: {
                      user: { select: { name: true } },
                      items: {
                          orderBy: { createdAt: "desc" },
                          take: 20,
                      },
                      _count: { select: { items: true, rules: true } },
                  },
              })
            : [];

    return NextResponse.json({
        status: true,
        data: {
            libraries: ownLibraries,
            subscribedLibraries,
        },
    });
}

export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!hasRole(user.role, "OWNER")) {
        return NextResponse.json({ status: false, error: "Permissão insuficiente." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = createLibrarySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { status: false, error: "Dados inválidos para criar biblioteca.", details: parsed.error.flatten() },
            { status: 400 }
        );
    }

    const data = parsed.data;
    let driveFolderId: string | null = null;
    if (data.sourceType === "GOOGLE_DRIVE") {
        driveFolderId = extractGoogleDriveFolderId(data.driveFolderUrl || "");
        if (!driveFolderId) {
            return NextResponse.json(
                {
                    status: false,
                    error: "Link da pasta do Google Drive inválido. Cole o link completo da pasta compartilhada.",
                },
                { status: 400 }
            );
        }
    }

    const created = await prisma.contentLibrary.create({
        data: {
            userId: user.id,
            name: data.name.trim(),
            description: data.description?.trim() || null,
            sourceType: data.sourceType,
            driveFolderUrl: data.driveFolderUrl?.trim() || null,
            driveFolderId,
            syncEnabled: data.syncEnabled,
            syncHour: data.syncHour,
            shareCode: generateShareCode(data.name),
            isShared: data.isShared,
        },
    });

    let syncResult: { added: number; skipped: number } | null = null;
    let syncWarning: string | null = null;
    if (data.sourceType === "GOOGLE_DRIVE" && data.syncNow) {
        try {
            syncResult = await syncLibraryFromDrive(created.id);
        } catch (err: any) {
            syncWarning = err?.message || "Não foi possível sincronizar imediatamente.";
        }
    }

    return NextResponse.json(
        {
            status: true,
            message: syncWarning
                ? `Biblioteca criada, mas o Drive retornou aviso: ${syncWarning}`
                : syncResult
                ? `Biblioteca criada e sincronizada (+${syncResult.added} arquivos)!`
                : "Biblioteca criada com sucesso!",
            data: {
                library: created,
                syncResult,
                syncWarning,
            },
        },
        { status: 201 }
    );
}
