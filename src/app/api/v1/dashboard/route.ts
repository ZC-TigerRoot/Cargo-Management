import { NextResponse } from "next/server";
import { AuthorizationError, requireUser, vehicleScopeWhere } from "@/lib/auth";
import { listVehicles, toVehicleRecord } from "@/lib/vehicle-repository";
import { chinaToday } from "@/lib/datetime";

export async function GET() {
  try {
    const user = await requireUser("view");
    const vehicles = (await listVehicles({ scope: vehicleScopeWhere(user) })).map(toVehicleRecord);
    const today = chinaToday();
    return NextResponse.json({ data: {
      total: vehicles.length,
      inStock: vehicles.filter(vehicle => vehicle.status === "在库").length,
      pendingPickup: vehicles.filter(vehicle => vehicle.status === "待提货").length,
      exceptions: vehicles.filter(vehicle => vehicle.status === "异常").length,
      outboundToday: vehicles.filter(vehicle => vehicle.outboundAt === today).length,
    } });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: "UNAUTHENTICATED", message: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "无法读取实时看板" }, { status: 503 });
  }
}
