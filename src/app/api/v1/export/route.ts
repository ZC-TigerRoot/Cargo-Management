import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { inventoryDays } from "@/lib/domain";
import { listVehicles, toVehicleRecord } from "@/lib/vehicle-repository";

const showDate = (value?: string) => value ? new Date(value).toISOString() : "";

export async function GET() {
  try {
    const vehicles = (await listVehicles()).map(toVehicleRecord);
    const overseas = vehicles.filter(vehicle => vehicle.type === "overseas").map(vehicle => ({
      提单号: vehicle.referenceNo,
      车架号: vehicle.vin,
      车型: vehicle.model,
      "HS#": vehicle.hsCode,
      起运港: vehicle.portOfLoad,
      目的港: vehicle.portOfDischarge,
      船名航次: vehicle.vesselVoyage,
      ETD: showDate(vehicle.etd),
      ETA: showDate(vehicle.eta),
      保税仓地点: vehicle.warehouseLocation,
      入保税仓库时间: showDate(vehicle.inboundAt),
      入库仓库名称: vehicle.warehouse,
      所属客人: vehicle.customer,
      商社通知放车时间: showDate(vehicle.merchantReleaseAt),
      客户通知做过户文件时间: showDate(vehicle.transferDocNoticeAt),
      客户通知放车时间: showDate(vehicle.customerReleaseAt),
      出库提货明细: vehicle.pickupDetails,
      实际出保税库时间: showDate(vehicle.outboundAt),
      库存天数: inventoryDays(vehicle.inboundAt, vehicle.outboundAt),
      出库通知单交付给商社日期: showDate(vehicle.outboundNoticeDeliveredAt),
      客户交付签收单日期: showDate(vehicle.customerReceiptDeliveredAt),
      外代交付签收单给商社时间: showDate(vehicle.agentReceiptDeliveredAt),
      备注: vehicle.notes,
    }));
    const domestic = vehicles.filter(vehicle => vehicle.type === "domestic").map(vehicle => ({
      车架号: vehicle.vin,
      车型: vehicle.model,
      品牌: vehicle.brand,
      生产商: vehicle.manufacturer,
      "PO#": vehicle.referenceNo,
      仓库地点: vehicle.warehouseLocation,
      入仓库时间: showDate(vehicle.inboundAt),
      入库仓库名称: vehicle.warehouse,
      所属客人: vehicle.customer,
      商社通知放车时间: showDate(vehicle.merchantReleaseAt),
      出库提货明细: vehicle.pickupDetails,
      实际出保税库时间: showDate(vehicle.outboundAt),
      库存天数: inventoryDays(vehicle.inboundAt, vehicle.outboundAt),
      出库通知单交付给商社: showDate(vehicle.outboundNoticeDeliveredAt),
      客户交付签收单日期: showDate(vehicle.customerReceiptDeliveredAt),
      外代交付签收单给商社时间: showDate(vehicle.agentReceiptDeliveredAt),
      备注: vehicle.notes,
    }));

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(overseas), "海外仓");
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(domestic), "国内仓");
    const data = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(data, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=cargo-inventory.xlsx",
    } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "导出失败，请确认数据库已启动" }, { status: 503 });
  }
}
