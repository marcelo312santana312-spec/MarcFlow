import { NextRequest, NextResponse } from "next/server";
import { createReadStream, existsSync } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { verifyMediaSignature } from "@/modules/instagram/crypto";
import { INSTAGRAM_MEDIA_DIR } from "@/modules/instagram/scheduler";

const MIME_BY_EXT: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
};

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ filename: string }> }
) {
    const { filename } = await params;

    if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
        return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    const expParam = request.nextUrl.searchParams.get("exp");
    const sigParam = request.nextUrl.searchParams.get("sig");
    const exp = expParam ? Number(expParam) : NaN;

    if (!sigParam || !verifyMediaSignature(filename, exp, sigParam)) {
        return NextResponse.json({ error: "Assinatura inválida ou expirada." }, { status: 403 });
    }

    const filePath = path.join(INSTAGRAM_MEDIA_DIR, filename);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(INSTAGRAM_MEDIA_DIR))) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (!existsSync(filePath)) {
        return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 });
    }

    const fileStat = await stat(filePath);
    const totalSize = fileStat.size;
    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_BY_EXT[ext] || "application/octet-stream";

    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
        const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
        if (match) {
            const start = match[1] ? parseInt(match[1], 10) : 0;
            const end = match[2] ? Math.min(parseInt(match[2], 10), totalSize - 1) : totalSize - 1;

            if (start >= totalSize || start > end) {
                return new NextResponse(null, {
                    status: 416,
                    headers: { "Content-Range": `bytes */${totalSize}` },
                });
            }

            const chunkSize = end - start + 1;
            const stream = createReadStream(filePath, { start, end });
            const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>;

            return new NextResponse(webStream, {
                status: 206,
                headers: {
                    "Content-Type": contentType,
                    "Content-Range": `bytes ${start}-${end}/${totalSize}`,
                    "Content-Length": String(chunkSize),
                    "Accept-Ranges": "bytes",
                    "Cache-Control": "public, max-age=3600",
                    "X-Content-Type-Options": "nosniff",
                },
            });
        }
    }

    const stream = createReadStream(filePath);
    const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>;

    return new NextResponse(webStream, {
        status: 200,
        headers: {
            "Content-Type": contentType,
            "Content-Length": String(totalSize),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
