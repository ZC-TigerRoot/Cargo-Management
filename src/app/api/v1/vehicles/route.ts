import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { vehicleInput, vehicleUpdateInput } from "@/lib/validators";
import { createVehicle, listVehicles, toVehicleRecord, updateVehicle } from "@/lib/vehicle-repository";

function databaseError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return NextResponse.json({ error: "VIN_ALREADY_EXISTS", message: "该车架号已存在" }, { status: 409 });
  }
  console.error(error);
  return NextResponse.json({ error: "DATABASE_ERROR", message: "数据库操作失败，请确认 PostgreSQL 和迁移已启动" }, { status: 503 });
}

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id") || undefined;
    const q = req.nextUrl.searchParams.get("q") || undefined;
    const rows = await listVehicles({ id, q });
    if (id && !rows.length) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ data: id ? toVehicleRecord(rows[0]) : rows.map(toVehicleRecord), meta: { total: rows.length } });
  } catch (error) {
    return databaseError(error);
  }
}

export async function POST(req: NextRequest) {
  const parsed = vehicleInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR", issues: parsed.error.flatten() }, { status: 422 });
  }
  try {
    const { idempotencyKey, ...data } = parsed.data;
    const vehicle = await createVehicle(data, idempotencyKey);
    return NextResponse.json({ data: toVehicleRecord(vehicle), audit: { action: "VEHICLE_CREATED" } }, { status: 201 });
  } catch (error) {
    return databaseError(error);
  }
}

export async function PATCH(req: NextRequest) {
  const parsed = vehicleUpdateInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR", issues: parsed.error.flatten() }, { status: 422 });
  }
  try {
    const { id, ...data } = parsed.data;
    const vehicle = await updateVehicle(id, data);
    return NextResponse.json({ data: toVehicleRecord(vehicle), audit: { action: "VEHICLE_UPDATED" } });
  } catch (error) {
    return databaseError(error);
  }
}
