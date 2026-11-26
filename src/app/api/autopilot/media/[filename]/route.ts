import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { AUTOPILOT_MEDIA_DIR } from "@/modules/autopilot/scheduler";

function detectMime(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".webp") return "image/webp";
    if (ext === ".mp4") return "video/mp4";
    if (ext === ".mov") return "video/quicktime";
    return "image/jpeg";
}

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ filename: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { filename } = await context.params;
    if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
        return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    const filePath = path.join(AUTOPILOT_MEDIA_DIR, path.basename(filename));
    try {
        const stat = await fs.stat(filePath);
        const data = await fs.readFile(filePath);
        return new NextResponse(new Uint8Array(data), {
            status: 200,
            headers: {
                "Content-Type": detectMime(filename),
                "Content-Length": String(stat.size),
                "Cache-Control": "private, max-age=3600",
            },
        });
    } catch {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
}
