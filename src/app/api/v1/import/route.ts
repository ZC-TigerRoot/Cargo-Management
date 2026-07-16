import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { assertSameOrigin, AuthorizationError, requestIp, requirePayloadWarehouseInScope, requireUser } from "@/lib/auth";
import { assertImportFile, checkWorkbook, ImportWorkbookError, MAX_IMPORT_FILE_SIZE, publicCheckResult } from "@/lib/excel-import";
import { createVehicle } from "@/lib/vehicle-repository";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser("create");
    assertSameOrigin(req);
    const contentLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_FILE_SIZE + 1_000_000) {
      return NextResponse.json({ error: "FILE_TOO_LARGE", message: "Excel 文件不能超过 10 MB" }, { status: 413 });
    }
    const form = await req.formData();
    const file = form.get("file");
    assertImportFile(file);
    const checked = await checkWorkbook(file);
    const validRows = checked.rows.filter(row => !row.errors.length);
    const imported: number[] = [];
    const failed: { row: number; vin?: string; errors: string[] }[] = [];

    for (const row of validRows) {
      try {
        await requirePayloadWarehouseInScope(user, row.payload.warehouse, row.payload.warehouseLocation);
        await createVehicle(row.payload, `excel:${crypto.randomUUID()}`, { actorId: user.id, ip: requestIp(req) });
        imported.push(row.row);
      } catch (error) {
        const message = error instanceof AuthorizationError ? error.message
          : error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? "车架号已存在"
            : "导入该行时数据库写入失败";
        failed.push({ row: row.row, vin: row.vin, errors: [message] });
      }
    }

    const preview = publicCheckResult(checked);
    return NextResponse.json({ data: {
      ...preview,
      importedRows: imported.length,
      failedRows: checked.invalidRows + failed.length,
      errors: [...preview.errors, ...failed].sort((left, right) => left.row - right.row),
    } }, { status: imported.length ? 201 : 200 });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", message: error.message }, { status: error.status });
    if (error instanceof ImportWorkbookError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "IMPORT_FAILED", message: "导入失败，请稍后重试" }, { status: 503 });
  }
}
