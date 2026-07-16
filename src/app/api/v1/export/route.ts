import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { inventoryDays, vehicleStatuses } from "@/lib/domain";
import { businessDate, CHINA_TIME_ZONE, localInputValue } from "@/lib/datetime";
import { AuthorizationError, requireUser, vehicleScopeWhere } from "@/lib/auth";
import { listVehicles, toVehicleRecord } from "@/lib/vehicle-repository";
import { EMPTY_FACET_VALUE, filterVehicleRecords, inventoryAgeLabels, vehicleFiltersFromSearchParams } from "@/lib/vehicle-filters";

const filterLabels = {
  q: "跨字段关键词", type: "业务类型", status: "状态", warehouse: "仓库", warehouseLocation: "仓库地点", customer: "客户",
  model: "车型", brand: "品牌", referenceNo: "提单号 / PO#", vin: "车架号", inboundBoeNo: "入库 BOE 号",
  outboundBoeNo: "出库 BOE 号", outboundBoeTitle: "BOE 抬头", inventoryAge: "库存账龄", inboundFrom: "入库日期从",
  inboundTo: "入库日期至", outboundFrom: "出库日期从", outboundTo: "出库日期至", updatedFrom: "最后修改日期从",
  updatedTo: "最后修改日期至", inboundAmountMin: "最低入库金额", inboundAmountMax: "最高入库金额",
  outboundAmountMin: "最低出库金额", outboundAmountMax: "最高出库金额",
} as const;

function displayFilterValue(key: keyof typeof filterLabels, value: string) {
  if (value === EMPTY_FACET_VALUE) return "未填写";
  if (key === "type") return value === "overseas" ? "海外仓" : "国内仓";
  if (key === "inventoryAge") return inventoryAgeLabels[value as keyof typeof inventoryAgeLabels] ?? value;
  return value;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser("export");
    const filters = vehicleFiltersFromSearchParams(req.nextUrl.searchParams);
    const allVehicles = (await listVehicles({ scope: vehicleScopeWhere(user) })).map(toVehicleRecord);
    const vehicles = filterVehicleRecords(allVehicles, filters);
    const overseas = vehicles.filter(vehicle => vehicle.type === "overseas").map(vehicle => ({
      提单号: vehicle.referenceNo,
      车架号: vehicle.vin,
      车型: vehicle.model,
      "HS#": vehicle.hsCode,
      起运港: vehicle.portOfLoad,
      目的港: vehicle.portOfDischarge,
      船名航次: vehicle.vesselVoyage,
      ETD: businessDate(vehicle.etd, vehicle.warehouseTimezone),
      ETA: businessDate(vehicle.eta, vehicle.warehouseTimezone),
      保税仓地点: vehicle.warehouseLocation,
      入保税仓库时间: businessDate(vehicle.inboundAt, vehicle.warehouseTimezone),
      入库金额: vehicle.inboundAmount,
      "入库BOE号": vehicle.inboundBoeNo,
      入库仓库名称: vehicle.warehouse,
      所属客人: vehicle.customer,
      商社通知放车时间: businessDate(vehicle.merchantReleaseAt, vehicle.warehouseTimezone),
      客户通知做过户文件时间: businessDate(vehicle.transferDocNoticeAt, vehicle.warehouseTimezone),
      客户通知放车时间: businessDate(vehicle.customerReleaseAt, vehicle.warehouseTimezone),
      出库提货明细: vehicle.pickupDetails,
      实际出保税库时间: businessDate(vehicle.outboundAt, vehicle.warehouseTimezone),
      "出库BOE号": vehicle.outboundBoeNo,
      "BOE抬头": vehicle.outboundBoeTitle,
      出库金额: vehicle.outboundAmount,
      库存天数: inventoryDays(vehicle.inboundAt, vehicle.outboundAt),
      出库通知单交付给商社日期: businessDate(vehicle.outboundNoticeDeliveredAt, vehicle.warehouseTimezone),
      客户交付签收单日期: businessDate(vehicle.customerReceiptDeliveredAt, vehicle.warehouseTimezone),
      外代交付签收单给商社时间: businessDate(vehicle.agentReceiptDeliveredAt, vehicle.warehouseTimezone),
      备注: vehicle.notes,
    }));
    const domestic = vehicles.filter(vehicle => vehicle.type === "domestic").map(vehicle => ({
      车架号: vehicle.vin,
      车型: vehicle.model,
      品牌: vehicle.brand,
      生产商: vehicle.manufacturer,
      "PO#": vehicle.referenceNo,
      仓库地点: vehicle.warehouseLocation,
      入仓库时间: businessDate(vehicle.inboundAt, vehicle.warehouseTimezone),
      入库金额: vehicle.inboundAmount,
      "入库BOE号": vehicle.inboundBoeNo,
      入库仓库名称: vehicle.warehouse,
      所属客人: vehicle.customer,
      商社通知放车时间: businessDate(vehicle.merchantReleaseAt, vehicle.warehouseTimezone),
      出库提货明细: vehicle.pickupDetails,
      实际出保税库时间: businessDate(vehicle.outboundAt, vehicle.warehouseTimezone),
      "出库BOE号": vehicle.outboundBoeNo,
      "BOE抬头": vehicle.outboundBoeTitle,
      出库金额: vehicle.outboundAmount,
      库存天数: inventoryDays(vehicle.inboundAt, vehicle.outboundAt),
      出库通知单交付给商社: businessDate(vehicle.outboundNoticeDeliveredAt, vehicle.warehouseTimezone),
      客户交付签收单日期: businessDate(vehicle.customerReceiptDeliveredAt, vehicle.warehouseTimezone),
      外代交付签收单给商社时间: businessDate(vehicle.agentReceiptDeliveredAt, vehicle.warehouseTimezone),
      备注: vehicle.notes,
    }));

    const book = XLSX.utils.book_new();
    const summaryRows: (string | number)[][] = [
      ["筛选统计", "数量"],
      ["筛选结果", vehicles.length],
      ["海外仓", vehicles.filter(vehicle => vehicle.type === "overseas").length],
      ["国内仓", vehicles.filter(vehicle => vehicle.type === "domestic").length],
      ...vehicleStatuses.map(status => [status, vehicles.filter(vehicle => vehicle.status === status).length] as [string, number]),
      [],
      ["当前筛选条件", "值"],
      ...Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [filterLabels[key as keyof typeof filterLabels], displayFilterValue(key as keyof typeof filterLabels, value)]),
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet["!cols"] = [{ wch: 22 }, { wch: 34 }];
    XLSX.utils.book_append_sheet(book, summarySheet, "筛选统计");
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(overseas), "海外仓");
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(domestic), "国内仓");
    book.Props = { Title: "车仓通筛选结果", Subject: `共 ${vehicles.length} 辆`, Author: "车仓通" };
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
