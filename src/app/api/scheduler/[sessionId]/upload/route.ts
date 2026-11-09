import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import fs from "fs/promises";
import path from "path";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const formData = await request.formData();
        const file = formData.get("file");

        if (!(file instanceof File)) {
            return NextResponse.json({ status: false, message: "Nenhum arquivo enviado", error: "Nenhum arquivo enviado" }, { status: 400 });
        }

        const dir = path.join(process.cwd(), "data", "scheduler-media", sessionId);
        await fs.mkdir(dir, { recursive: true });

        const ext = path.extname(file.name).toLowerCase();
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        const filePath = path.join(dir, safeName);

        const buffer = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(filePath, buffer);

        // Determine media type
        let mediaType = "image";
        if ([".mp4", ".mov", ".avi", ".webm"].includes(ext)) mediaType = "video";
        else if ([".mp3", ".wav", ".ogg", ".opus", ".m4a"].includes(ext)) mediaType = "audio";
        else if (![".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) mediaType = "document";

        const relativePath = `data/scheduler-media/${sessionId}/${safeName}`;

        return NextResponse.json({
            status: true,
            message: "Arquivo enviado com sucesso",
            data: {
                mediaUrl: relativePath,
                mediaType,
                fileName: file.name,
                size: file.size,
            },
        });
    } catch (error: any) {
        console.error("Upload error:", error);
        return NextResponse.json({ status: false, message: "Falha ao enviar arquivo", error: error?.message }, { status: 500 });
    }
}
