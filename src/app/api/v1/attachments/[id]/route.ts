import { NextResponse } from "next/server";
import { AuthorizationError, requireUser, requireVehicleInScope } from "@/lib/auth";
import { readLocalUpload } from "@/lib/local-upload";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("view");
    const { id } = await params;
    const attachment = await prisma.attachment.findUnique({ where: { id } });
    if (!attachment?.vehicleId) return NextResponse.json({ error: "NOT_FOUND", message: "图片不存在" }, { status: 404 });
    await requireVehicleInScope(user, attachment.vehicleId);

    let bytes: Buffer;
    try {
      bytes = await readLocalUpload(attachment.objectKey);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return NextResponse.json({ error: "FILE_NOT_FOUND", message: "图片文件不存在" }, { status: 404 });
      }
      throw error;
    }

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "private, max-age=60",
        "Content-Length": String(bytes.byteLength),
        "Content-Type": attachment.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", message: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "ATTACHMENT_READ_FAILED", message: "暂时无法读取图片" }, { status: 503 });
  }
}
