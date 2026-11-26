import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getAuthenticatedUser, hasRole } from "@/lib/api-auth";
import { buildSignedMediaUrl, INSTAGRAM_MEDIA_DIR } from "@/modules/instagram/scheduler";

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

const ALLOWED_EXT_MAP: Record<string, { mediaType: "IMAGE" | "VIDEO"; mimeType: string }> = {
    ".jpg": { mediaType: "IMAGE", mimeType: "image/jpeg" },
    ".jpeg": { mediaType: "IMAGE", mimeType: "image/jpeg" },
    ".png": { mediaType: "IMAGE", mimeType: "image/png" },
    ".mp4": { mediaType: "VIDEO", mimeType: "video/mp4" },
    ".mov": { mediaType: "VIDEO", mimeType: "video/quicktime" },
};

const ALLOWED_MIME_EXT: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
};

export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!hasRole(user.role, "OWNER")) {
        return NextResponse.json({ status: false, error: "Permissão insuficiente." }, { status: 403 });
    }

    try {
        const formData = await request.formData();
        const file = formData.get("file");

        if (!file || !(file instanceof File)) {
            return NextResponse.json({ status: false, error: "Arquivo não enviado." }, { status: 400 });
        }

        if (file.size <= 0) {
            return NextResponse.json({ status: false, error: "O arquivo enviado está vazio." }, { status: 400 });
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
            return NextResponse.json(
                { status: false, error: "Arquivo excede o limite de 100 MB." },
                { status: 400 }
            );
        }

        let ext = path.extname(file.name || "").toLowerCase();
        if (!ALLOWED_EXT_MAP[ext]) {
            ext = ALLOWED_MIME_EXT[file.type.toLowerCase()] || "";
        }

        const meta = ALLOWED_EXT_MAP[ext];
        if (!meta) {
            return NextResponse.json(
                { status: false, error: "Formato não suportado pelo Instagram. Use JPG, PNG, MP4 ou MOV." },
                { status: 400 }
            );
        }

        await mkdir(INSTAGRAM_MEDIA_DIR, { recursive: true });
        const filename = `${crypto.randomBytes(16).toString("hex")}${ext}`;
        const destPath = path.join(INSTAGRAM_MEDIA_DIR, filename);

        const buffer = Buffer.from(await file.arrayBuffer());
        await writeFile(destPath, buffer);

        return NextResponse.json({
            status: true,
            data: {
                filename,
                mediaType: meta.mediaType,
                mimeType: meta.mimeType,
                size: file.size,
                previewUrl: buildSignedMediaUrl(filename),
            },
        });
    } catch (err: any) {
        return NextResponse.json(
            { status: false, error: err?.message || "Erro ao salvar arquivo de mídia." },
            { status: 500 }
        );
    }
}
