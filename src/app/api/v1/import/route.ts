import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { assertSameOrigin, AuthorizationError, requestIp, requirePayloadWarehouseInScope, requireUser, requireVehicleInScope } from "@/lib/auth";
import { can } from "@/lib/domain";
import { assertImportFile, checkWorkbook, ImportWorkbookError, MAX_IMPORT_FILE_SIZE, publicCheckResult } from "@/lib/excel-import";
import { verifyImportPreview, workbookSnapshot } from "@/lib/import-preview";
import { businessBatchSnapshot, createVehicle, updateVehicleFromImport, VersionConflictError } from "@/lib/vehicle-repository";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser("create");
    assertSameOrigin(req);
    const contentLengthHeader = req.headers.get("content-length");
    if (!contentLengthHeader) return NextResponse.json({ error: "LENGTH_REQUIRED", message: "上传请求必须包含 Content-Length" }, { status: 411 });
    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0) return NextResponse.json({ error: "INVALID_LENGTH", message: "上传请求长度无效" }, { status: 400 });
    if (contentLength > MAX_IMPORT_FILE_SIZE + 1_000_000) {
      return NextResponse.json({ error: "FILE_TOO_LARGE", message: "Excel 文件不能超过 10 MB" }, { status: 413 });
    }
    const form = await req.formData();
    const file = form.get("file");
    assertImportFile(file);
    const previewToken = form.get("previewToken");
    if (typeof previewToken !== "string") throw new ImportWorkbookError("PREVIEW_REQUIRED", "请先重新提交预校验", 400);
    const expectedSnapshot = await verifyImportPreview(previewToken, user.id);
    if (!expectedSnapshot) throw new ImportWorkbookError("INVALID_PREVIEW", "预校验已失效，请重新提交预校验", 400);
    const checked = await checkWorkbook(file);
    if (expectedSnapshot !== workbookSnapshot(checked.rows)) {
      return NextResponse.json({
        error: "VERSION_CONFLICT",
        message: "车辆数据在预校验后已发生变化，请重新预校验后再处理",
      }, { status: 409 });
    }
    const validRows = checked.rows.filter(row => !row.errors.length);
    const created: number[] = [];
    const updated: number[] = [];
    const failed: { row: number; vin?: string; errors: string[] }[] = [];
    const context = { actorId: user.id, ip: requestIp(req) };
    const destinationBatchSnapshots = new Map<string, string | null>();
    let hasVersionConflict = false;

    for (const row of validRows) {
      try {
        const expectedDestinationBatchSnapshot = row.destinationBatchKey && destinationBatchSnapshots.has(row.destinationBatchKey)
          ? destinationBatchSnapshots.get(row.destinationBatchKey) ?? null
          : row.destinationBatchSnapshot ?? null;
        if (row.existing) {
          if (!can(user.roleName, "correct")) throw new AuthorizationError(403, "当前账号没有批量更新车辆的权限");
          await requireVehicleInScope(user, row.existing.id);
          await requirePayloadWarehouseInScope(
            user,
            row.payload.warehouse ?? row.existing.warehouse,
            row.payload.warehouseLocation ?? row.existing.warehouseLocation,
          );
          const vehicle = await updateVehicleFromImport(row.existing.id, row.existing.version, row.payload, context, expectedDestinationBatchSnapshot);
          if (row.destinationBatchKey) destinationBatchSnapshots.set(row.destinationBatchKey, businessBatchSnapshot(vehicle.batch));
          updated.push(row.row);
        } else {
          await requirePayloadWarehouseInScope(user, row.payload.warehouse, row.payload.warehouseLocation, { required: true });
          const vehicle = await createVehicle(row.payload, `excel:${crypto.randomUUID()}`, context, expectedDestinationBatchSnapshot);
          if (row.destinationBatchKey) destinationBatchSnapshots.set(row.destinationBatchKey, businessBatchSnapshot(vehicle.batch));
          created.push(row.row);
        }
      } catch (error) {
        const databaseConflict = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2025");
        if (error instanceof VersionConflictError || databaseConflict) hasVersionConflict = true;
        const message = error instanceof AuthorizationError ? error.message
          : error instanceof VersionConflictError ? error.message
            : error instanceof ZodError ? `更新后的字段校验失败：${error.issues.map(issue => issue.message).join("；")}`
              : error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? "车架号在预校验后已被其他记录占用"
                : error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025" ? "车辆档案不存在或已被删除"
                  : "导入该行时数据库写入失败";
        failed.push({ row: row.row, vin: row.vin, errors: [message] });
      }
    }

    const preview = publicCheckResult(checked);
    return NextResponse.json({
      ...(hasVersionConflict ? { error: "VERSION_CONFLICT", message: "部分车辆在预校验后已被修改，请重新预校验后再处理" } : {}),
      data: {
        ...preview,
        importedRows: created.length + updated.length,
        createdRows: created.length,
        updatedRows: updated.length,
        failedRows: checked.invalidRows + failed.length,
        errors: [...preview.errors, ...failed].sort((left, right) => left.row - right.row),
      },
    }, { status: hasVersionConflict ? 409 : created.length ? 201 : 200 });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", message: error.message }, { status: error.status });
    if (error instanceof ImportWorkbookError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "IMPORT_FAILED", message: "导入失败，请稍后重试" }, { status: 503 });
  }
}
