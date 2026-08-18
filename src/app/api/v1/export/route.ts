import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { CHINA_TIME_ZONE, localInputValue } from "@/lib/datetime";
import { AuthorizationError, requireUser, vehicleScopeWhere } from "@/lib/auth";
import { listVehicles, toVehicleRecord } from "@/lib/vehicle-repository";
import { filterVehicleRecords, vehicleFiltersFromSearchParams } from "@/lib/vehicle-filters";
import { createVehicleExportWorkbook } from "@/lib/vehicle-excel";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser("export");
    const filters = vehicleFiltersFromSearchParams(req.nextUrl.searchParams);
    const allVehicles = (await listVehicles({ scope: vehicleScopeWhere(user) })).map(toVehicleRecord);
    const vehicles = filterVehicleRecords(allVehicles, filters);
    const book = createVehicleExportWorkbook(vehicles, filters.type.length === 1 ? filters.type[0] : undefined);
    const data = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const stamp = localInputValue(new Date().toISOString(), CHINA_TIME_ZONE).replace(/[-:T]/g, "").slice(0, 12);
    return new NextResponse(data, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=cargo-filtered-${stamp}.xlsx`,
      "Cache-Control": "private, no-store",
      "X-Export-Count": String(vehicles.length),
    } });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", message: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "导出失败，请确认数据库已启动" }, { status: 503 });
  }
}
