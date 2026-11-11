import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; filename: string }> }
) {
    try {
        const { sessionId, filename } = await params;
        const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
        const safeFile = path.basename(filename);

        const filePath = path.join(process.cwd(), "public", "ai-studio", safeSession, safeFile);
        const buffer = await fs.readFile(filePath);

        const ext = path.extname(safeFile).toLowerCase();
        const mimeType =
            ext === ".mp4"
                ? "video/mp4"
                : ext === ".webp"
                ? "image/webp"
                : ext === ".jpg" || ext === ".jpeg"
                ? "image/jpeg"
                : "image/png";

        return new NextResponse(buffer, {
            status: 200,
            headers: {
                "Content-Type": mimeType,
                "Content-Length": String(buffer.length),
                "Cache-Control": "public, max-age=31536000, immutable",
            },
        });
    } catch {
        return NextResponse.json({ status: false, message: "Arquivo não encontrado" }, { status: 404 });
    }
}
