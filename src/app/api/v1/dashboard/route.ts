import { NextResponse } from "next/server";
import { AuthorizationError, requireUser } from "@/lib/auth";
import { listVehicles, toVehicleRecord } from "@/lib/vehicle-repository";

export async function GET() {
  try {
    await requireUser("view");
    const vehicles = (await listVehicles()).map(toVehicleRecord);
    return NextResponse.json({ data: {
      total: vehicles.length,
      inStock: vehicles.filter(vehicle => vehicle.status === "在库").length,
      pendingPickup: vehicles.filter(vehicle => vehicle.status === "待提货").length,
      exceptions: vehicles.filter(vehicle => vehicle.status === "异常").length,
      outboundToday: vehicles.filter(vehicle => {
        if (!vehicle.outboundAt) return false;
        const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: vehicle.warehouseTimezone });
        return formatter.format(new Date(vehicle.outboundAt)) === formatter.format(new Date());
      }).length,
    } });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: "UNAUTHENTICATED", message: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "无法读取实时看板" }, { status: 503 });
  }
}
