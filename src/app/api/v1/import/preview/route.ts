import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { assertSameOrigin, AuthorizationError, requireUser } from "@/lib/auth";
import {
  assertImportFile,
  checkWorkbook,
  ImportWorkbookError,
  MAX_IMPORT_FILE_SIZE,
  publicCheckResult,
} from "@/lib/excel-import";
import { signImportPreview } from "@/lib/import-preview";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser("create");
    assertSameOrigin(req);
    const contentLengthHeader = req.headers.get("content-length");
    if (!contentLengthHeader) return NextResponse.json({ error: "LENGTH_REQUIRED", message: "上传请求必须包含 Content-Length" }, { status: 411 });
    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0) return NextResponse.json({ error: "INVALID_LENGTH", message: "上传请求长度无效" }, { status: 400 });
    if (contentLength > MAX_IMPORT_FILE_SIZE + 1_000_000) return NextResponse.json({ error: "FILE_TOO_LARGE", message: "Excel 文件不能超过 10 MB" }, { status: 413 });
    const form = await req.formData();
    const file = form.get("file");
    assertImportFile(file);
    const checked = await checkWorkbook(file);
    return NextResponse.json({ data: { ...publicCheckResult(checked), previewToken: await signImportPreview(checked.rows, user.id) } });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", message: error.message }, { status: error.status });
    if (error instanceof ImportWorkbookError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Prisma.PrismaClientInitializationError) {
      console.error(error);
      return NextResponse.json({ error: "DATABASE_ERROR", message: "数据库暂时不可用" }, { status: 503 });
    }
    console.error(error);
    return NextResponse.json({ error: "INVALID_WORKBOOK", message: "无法读取 Excel 文件，请确认文件未损坏" }, { status: 422 });
  }
}
