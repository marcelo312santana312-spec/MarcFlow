import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { classifyDriveFile, generateSafeMediaFilename } from "@/modules/autopilot/drive";
import { AUTOPILOT_MEDIA_DIR, ensureAutoPilotMediaDir } from "@/modules/autopilot/scheduler";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const library = await prisma.contentLibrary.findUnique({ where: { id } });
    if (!library) {
        return NextResponse.json({ status: false, error: "Biblioteca não encontrada." }, { status: 404 });
    }
    if (library.userId !== user.id && !isAdmin(user.role)) {
        return NextResponse.json({ status: false, error: "Sem permissão para enviar arquivos nesta biblioteca." }, { status: 403 });
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
        return NextResponse.json({ status: false, error: "Envio inválido (multipart/form-data)." }, { status: 400 });
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
        return NextResponse.json({ status: false, error: "Selecione uma foto ou vídeo." }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ status: false, error: "Arquivo deve ter entre 1 byte e 100 MB." }, { status: 400 });
    }

    const kind = classifyDriveFile(file.name, file.type);
    if (!kind || kind === "TEXT") {
        return NextResponse.json(
            { status: false, error: "Formato não suportado. Envie JPG, PNG, WEBP, MP4 ou MOV." },
            { status: 400 }
        );
    }

    await ensureAutoPilotMediaDir();
    const safeFilename = generateSafeMediaFilename(file.name, file.type);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(AUTOPILOT_MEDIA_DIR, safeFilename), buffer);

    const rawTitle = String(formData.get("title") || "").trim();
    const title = rawTitle || path.parse(file.name).name.replace(/[_-]+/g, " ").trim() || "Produto";
    const caption = String(formData.get("caption") || "").trim() || null;
    const productUrl = String(formData.get("productUrl") || "").trim() || null;
    const priceText = String(formData.get("priceText") || "").trim() || null;
    const couponCode = String(formData.get("couponCode") || "").trim().toUpperCase() || null;

    const item = await prisma.contentItem.create({
        data: {
            libraryId: library.id,
            title,
            caption,
            productUrl,
            priceText,
            couponCode,
            filename: safeFilename,
            mimeType: file.type || (kind === "VIDEO" ? "video/mp4" : "image/jpeg"),
            mediaType: kind,
            sizeBytes: buffer.byteLength,
        },
    });

    return NextResponse.json(
        {
            status: true,
            message: `Mídia "${title}" adicionada ao repositório!`,
            data: item,
        },
        { status: 201 }
    );
}
