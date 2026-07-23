import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { vehicleDeleteInput, vehicleInput, vehicleUpdateInput } from "@/lib/validators";
import { createVehicle, deleteVehicles, listVehicleAuditTrail, listVehicles, toVehicleRecord, updateVehicle, VersionConflictError } from "@/lib/vehicle-repository";
import { assertSameOrigin, AuthorizationError, requestIp, requirePayloadWarehouseInScope, requireUser, requireVehicleInScope, vehicleScopeWhere } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { removeLocalUpload } from "@/lib/local-upload";

function apiError(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", message: error.message }, { status: error.status });
  }
  if (error instanceof VersionConflictError) {
    return NextResponse.json({ error: "VERSION_CONFLICT", message: error.message }, { status: 409 });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "INVALID_JSON", message: "请求内容不是有效的 JSON" }, { status: 400 });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return NextResponse.json({ error: "VIN_ALREADY_EXISTS", message: "该车架号已存在" }, { status: 409 });
    if (error.code === "P2025") return NextResponse.json({ error: "NOT_FOUND", message: "车辆档案不存在" }, { status: 404 });
  }
  console.error(error);
  return NextResponse.json({ error: "DATABASE_ERROR", message: "数据库操作失败，请确认 PostgreSQL 和迁移已启动" }, { status: 503 });
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser("view");
    const id = req.nextUrl.searchParams.get("id") || undefined;
    const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 100) || undefined;
    const rows = await listVehicles({ id, q, scope: vehicleScopeWhere(user) });
    if (id && !rows.length) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    if (id) {
      const record = toVehicleRecord(rows[0]);
      record.auditTrail = await listVehicleAuditTrail(id);
      return NextResponse.json({ data: record, meta: { total: 1 } });
    }
    return NextResponse.json({ data: rows.map(toVehicleRecord), meta: { total: rows.length } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser("create");
    assertSameOrigin(req);
    const parsed = vehicleInput.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR", issues: parsed.error.flatten() }, { status: 422 });
    const { idempotencyKey, ...data } = parsed.data;
    await requirePayloadWarehouseInScope(user, data.warehouse, data.warehouseLocation, { required: true });
    const vehicle = await createVehicle(data, idempotencyKey, { actorId: user.id, ip: requestIp(req) });
    return NextResponse.json({ data: toVehicleRecord(vehicle), audit: { action: "VEHICLE_CREATED", actor: user.name } }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser("correct");
    assertSameOrigin(req);
    const parsed = vehicleUpdateInput.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR", issues: parsed.error.flatten() }, { status: 422 });
    const { id, version, ...data } = parsed.data;
    await requireVehicleInScope(user, id);
    await requirePayloadWarehouseInScope(user, data.warehouse, data.warehouseLocation);
    const vehicle = await updateVehicle(id, version, data, { actorId: user.id, ip: requestIp(req) });
    return NextResponse.json({ data: toVehicleRecord(vehicle), audit: { action: "VEHICLE_UPDATED", actor: user.name } });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser("delete");
    assertSameOrigin(req);
    const parsed = vehicleDeleteInput.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR", issues: parsed.error.flatten() }, { status: 422 });
    const ids = [...new Set(parsed.data.ids)];
    const deleted = await deleteVehicles(ids, { actorId: user.id, ip: requestIp(req) });
    const objectKeys = [...new Set(deleted.flatMap(item => item.objectKeys))];
    for (const objectKey of objectKeys) {
      if (await prisma.attachment.count({ where: { objectKey } })) continue;
      try {
        await removeLocalUpload(objectKey);
      } catch (error) {
        console.error("Failed to clean up deleted vehicle attachment", error);
      }
    }
    return NextResponse.json({ data: { id: ids[0], ids }, audit: { action: "VEHICLE_DELETED", actor: user.name } });
  } catch (error) {
    return apiError(error);
  }
}
