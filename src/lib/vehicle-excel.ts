import * as XLSX from "xlsx";
import { inventoryDays, type BusinessType, type VehicleRecord } from "./domain";
import { normalizeCalendarDate } from "./datetime";

export const overseasExcelHeaders = [
  "提单号", "车架号", "车型", "HS#", "起运港", "目的港", "船名航次", "ETD", "ETA", "保税仓地点",
  "入保税仓库日期", "入库金额", "入库BOE号", "入库仓库名称", "所属客人", "商社通知放车日期", "客户通知做过户文件日期",
  "客户通知放车日期", "出库提货明细", "实际出库日期", "出库BOE号", "BOE抬头", "出库金额", "库存天数", "出库通知单交付给商社日期",
  "客户交付签收单日期", "外代交付签收单给商社日期", "备注",
] as const;

export const domesticExcelHeaders = [
  "车架号", "车型", "品牌", "生产商", "PO#", "仓库地点", "入仓库日期", "入库金额", "入库BOE号", "入库仓库名称", "所属客人",
  "商社通知放车日期", "出库提货明细", "实际出库日期", "出库BOE号", "BOE抬头", "出库金额", "库存天数", "出库通知单交付给商社日期",
  "客户交付签收单日期", "外代交付签收单给商社日期", "备注",
] as const;

type ExportRow = Record<string, string | number | undefined>;

function excelDate(value: string | undefined) {
  return value ? normalizeCalendarDate(value) : "";
}

function excelInventoryDays(inboundAt: string | undefined, outboundAt: string | undefined) {
  return inventoryDays(excelDate(inboundAt) || undefined, excelDate(outboundAt) || undefined);
}

function overseasRow(vehicle: VehicleRecord): ExportRow {
  return {
    提单号: vehicle.referenceNo,
    车架号: vehicle.vin,
    车型: vehicle.model,
    "HS#": vehicle.hsCode,
    起运港: vehicle.portOfLoad,
    目的港: vehicle.portOfDischarge,
    船名航次: vehicle.vesselVoyage,
    ETD: excelDate(vehicle.etd),
    ETA: excelDate(vehicle.eta),
    保税仓地点: vehicle.warehouseLocation,
    入保税仓库日期: excelDate(vehicle.inboundAt),
    入库金额: vehicle.inboundAmount,
    "入库BOE号": vehicle.inboundBoeNo,
    入库仓库名称: vehicle.warehouse,
    所属客人: vehicle.customer,
    商社通知放车日期: excelDate(vehicle.merchantReleaseAt),
    客户通知做过户文件日期: excelDate(vehicle.transferDocNoticeAt),
    客户通知放车日期: excelDate(vehicle.customerReleaseAt),
    出库提货明细: vehicle.pickupDetails,
    实际出库日期: excelDate(vehicle.outboundAt),
    "出库BOE号": vehicle.outboundBoeNo,
    "BOE抬头": vehicle.outboundBoeTitle,
    出库金额: vehicle.outboundAmount,
    库存天数: excelInventoryDays(vehicle.inboundAt, vehicle.outboundAt),
    出库通知单交付给商社日期: excelDate(vehicle.outboundNoticeDeliveredAt),
    客户交付签收单日期: excelDate(vehicle.customerReceiptDeliveredAt),
    外代交付签收单给商社日期: excelDate(vehicle.agentReceiptDeliveredAt),
    备注: vehicle.notes,
  };
}

function domesticRow(vehicle: VehicleRecord): ExportRow {
  return {
    车架号: vehicle.vin,
    车型: vehicle.model,
    品牌: vehicle.brand,
    生产商: vehicle.manufacturer,
    "PO#": vehicle.referenceNo,
    仓库地点: vehicle.warehouseLocation,
    入仓库日期: excelDate(vehicle.inboundAt),
    入库金额: vehicle.inboundAmount,
    "入库BOE号": vehicle.inboundBoeNo,
    入库仓库名称: vehicle.warehouse,
    所属客人: vehicle.customer,
    商社通知放车日期: excelDate(vehicle.merchantReleaseAt),
    出库提货明细: vehicle.pickupDetails,
    实际出库日期: excelDate(vehicle.outboundAt),
    "出库BOE号": vehicle.outboundBoeNo,
    "BOE抬头": vehicle.outboundBoeTitle,
    出库金额: vehicle.outboundAmount,
    库存天数: excelInventoryDays(vehicle.inboundAt, vehicle.outboundAt),
    出库通知单交付给商社日期: excelDate(vehicle.outboundNoticeDeliveredAt),
    客户交付签收单日期: excelDate(vehicle.customerReceiptDeliveredAt),
    外代交付签收单给商社日期: excelDate(vehicle.agentReceiptDeliveredAt),
    备注: vehicle.notes,
  };
}

function appendDetailSheet(book: XLSX.WorkBook, name: string, headers: readonly string[], rows: ExportRow[]) {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: [...headers] });
  sheet["!autofilter"] = { ref: sheet["!ref"] ?? `A1:${XLSX.utils.encode_col(headers.length - 1)}1` };
  sheet["!cols"] = headers.map(header => ({ wch: Math.max(12, Math.min(24, header.length * 2 + 4)) }));
  XLSX.utils.book_append_sheet(book, sheet, name);
}

export function createVehicleExportWorkbook(vehicles: readonly VehicleRecord[], requestedType?: BusinessType) {
  const book = XLSX.utils.book_new();
  const overseas = vehicles.filter(vehicle => vehicle.type === "overseas");
  const domestic = vehicles.filter(vehicle => vehicle.type === "domestic");

  if (overseas.length || requestedType === "overseas" || (!vehicles.length && !requestedType)) {
    appendDetailSheet(book, "海外仓", overseasExcelHeaders, overseas.map(overseasRow));
  }
  if (domestic.length || requestedType === "domestic" || (!vehicles.length && !requestedType)) {
    appendDetailSheet(book, "国内仓", domesticExcelHeaders, domestic.map(domesticRow));
  }

  book.Props = { Title: "车仓通筛选明细", Subject: `共 ${vehicles.length} 辆`, Author: "车仓通" };
  return book;
}
