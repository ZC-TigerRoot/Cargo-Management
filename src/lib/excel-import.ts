import "server-only";

import * as XLSX from "xlsx";
import { fromPrismaDate, isCalendarDate } from "./datetime";
import { prisma } from "./prisma";
import { vehiclePayload } from "./validators";
import { businessBatchSnapshot, type VehiclePayload } from "./vehicle-repository";
import { domesticExcelHeaders, overseasExcelHeaders } from "./vehicle-excel";

export const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 10_000;

export class ImportWorkbookError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

export type ImportRowIssue = { row: number; vin?: string; errors: string[] };
export type CheckedImportRow = ImportRowIssue & {
  referenceNo?: string;
  destinationReferenceNo?: string;
  destinationBatchKey?: string;
  destinationBatchSnapshot?: string | null;
  payload: VehiclePayload;
  existing?: { id: string; version: number; warehouse?: string; warehouseLocation?: string };
};
export type CheckedWorkbook = {
  fileName: string;
  businessType: "海外仓" | "国内仓";
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createRows: number;
  updateRows: number;
  missingHeaders: string[];
  ignoredColumns: string[];
  errors: ImportRowIssue[];
  rows: CheckedImportRow[];
};

function text(value: unknown) {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

const DATE_TEXT = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):?(\d{2}))?)?$/;
const HEADER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  入保税仓库日期: ["入保税仓库时间"],
  入仓库日期: ["入仓库时间"],
  库存日期: ["库存时间"],
  商社通知放车日期: ["商社通知放车时间"],
  客户通知做过户文件日期: ["客户通知做过户文件时间"],
  客户通知放车日期: ["客户通知放车时间"],
  实际出库日期: ["实际出保税库时间"],
  出库通知单交付给商社日期: ["出库通知单交付给商社"],
  外代交付签收单给商社日期: ["外代交付签收单给商社时间"],
};

function calendarDate(value: unknown, date1904 = false) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const date = `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    return isCalendarDate(date) ? date : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value, { date1904 });
    if (!parsed) return undefined;
    const date = `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    return isCalendarDate(date) ? date : undefined;
  }
  if (typeof value !== "string") return undefined;
  const match = DATE_TEXT.exec(value.trim());
  if (!match || !isCalendarDate(match[1])) return undefined;
  if (match[2] && (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59)) return undefined;
  if (match[5] && (Number(match[5]) > 14 || Number(match[6]) > 59 || Number(match[5]) === 14 && Number(match[6]) > 0)) return undefined;
  return match[1];
}

function extraText(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate ? candidate : undefined;
}

function batchKey(type: "OVERSEAS" | "DOMESTIC", referenceNo: string, warehouse?: string, warehouseLocation?: string) {
  return JSON.stringify([type, referenceNo, warehouse ?? null, warehouseLocation ?? null]);
}

function payloadFor(row: Record<string, unknown>, overseas: boolean, date1904: boolean): VehiclePayload {
  const inboundHeader = overseas ? "入保税仓库日期" : "入仓库日期";
  return vehiclePayload.parse({
    type: overseas ? "overseas" : "domestic",
    vin: text(row["车架号"]),
    model: text(row["车型"]),
    brand: text(row["品牌"]),
    referenceNo: text(row[overseas ? "提单号" : "PO#"]),
    hsCode: text(row["HS#"]),
    portOfLoad: text(row["起运港"]),
    portOfDischarge: text(row["目的港"]),
    vesselVoyage: text(row["船名航次"]),
    etd: calendarDate(row.ETD, date1904),
    eta: calendarDate(row.ETA, date1904),
    manufacturer: text(row["生产商"]),
    warehouseLocation: text(row[overseas ? "保税仓地点" : "仓库地点"]),
    warehouse: text(row["入库仓库名称"]),
    warehouseTimezone: "Asia/Shanghai",
    customer: text(row["所属客人"]),
    inboundAt: calendarDate(row[inboundHeader], date1904),
    inventoryAt: calendarDate(row["库存日期"], date1904),
    inboundAmount: text(row["入库金额"]),
    inboundBoeNo: text(row["入库BOE号"]),
    merchantReleaseAt: calendarDate(row["商社通知放车日期"], date1904),
    transferDocNoticeAt: calendarDate(row["客户通知做过户文件日期"], date1904),
    customerReleaseAt: calendarDate(row["客户通知放车日期"], date1904),
    pickupDetails: text(row["出库提货明细"]),
    outboundAt: calendarDate(row["实际出库日期"], date1904),
    outboundBoeNo: text(row["出库BOE号"]),
    outboundBoeTitle: text(row["BOE抬头"]),
    outboundAmount: text(row["出库金额"]),
    outboundNoticeDeliveredAt: calendarDate(row["出库通知单交付给商社日期"], date1904),
    customerReceiptDeliveredAt: calendarDate(row["客户交付签收单日期"], date1904),
    agentReceiptDeliveredAt: calendarDate(row["外代交付签收单给商社日期"], date1904),
    notes: text(row["备注"]),
  });
}

export function assertImportFile(file: FormDataEntryValue | null): asserts file is File {
  if (!(file instanceof File)) throw new ImportWorkbookError("FILE_REQUIRED", "请选择 Excel 文件", 400);
  if (file.size > MAX_IMPORT_FILE_SIZE) throw new ImportWorkbookError("FILE_TOO_LARGE", "Excel 文件不能超过 10 MB", 413);
  if (!/\.xlsx?$/i.test(file.name)) throw new ImportWorkbookError("INVALID_FILE_TYPE", "仅支持 .xlsx 或 .xls 文件", 415);
}

export async function checkWorkbook(file: File): Promise<CheckedWorkbook> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true, dense: true });
  } catch {
    throw new ImportWorkbookError("INVALID_WORKBOOK", "无法读取 Excel 文件，请确认文件未损坏", 422);
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new ImportWorkbookError("EMPTY_WORKBOOK", "工作簿不包含可读取的工作表", 422);
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  const headers = (matrix[0] ?? []).map(value => String(value ?? "").trim()).filter(Boolean);
  const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
  if (sourceRows.length > MAX_IMPORT_ROWS) throw new ImportWorkbookError("TOO_MANY_ROWS", `单次最多校验和导入 ${MAX_IMPORT_ROWS} 行`, 413);
  const date1904 = workbook.Workbook?.WBProps?.date1904 === true;

  const overseas = headers.includes("提单号");
  const domestic = headers.includes("PO#");
  if (overseas === domestic) throw new ImportWorkbookError("UNKNOWN_TEMPLATE", "模板必须且只能包含“提单号”或“PO#”列", 422);
  const expected: readonly string[] = overseas ? overseasExcelHeaders : domesticExcelHeaders;
  const acceptedHeaders = (header: string) => [header, ...(HEADER_ALIASES[header] ?? [])];
  const recognizedHeaders = new Set(expected.flatMap(acceptedHeaders));
  const sourceHeaders = new Map(expected.map(header => [
    header,
    acceptedHeaders(header).find(candidate => headers.includes(candidate)) ?? header,
  ] as const));
  const optionalHeaders = new Set(["库存日期"]);
  const missingHeaders = expected.filter(header => !optionalHeaders.has(header) && !acceptedHeaders(header).some(candidate => headers.includes(candidate)));
  const ignoredColumns = [...new Set(["库存天数", ...headers.filter(header => !recognizedHeaders.has(header))])];
  const normalizedRows = sourceRows.map(row => Object.fromEntries(expected.map(header => [
    header,
    row[sourceHeaders.get(header) ?? header] ?? "",
  ])));
  const inboundHeader = overseas ? "入保税仓库日期" : "入仓库日期";
  const outboundNoticeHeader = "出库通知单交付给商社日期";
  const dateColumns: [string, string][] = [
    [inboundHeader, "入库日期格式无效"],
    ["库存日期", "库存日期格式无效"],
    ["商社通知放车日期", "商社通知放车日期格式无效"],
    ["实际出库日期", "实际出库日期格式无效"],
    [outboundNoticeHeader, `${outboundNoticeHeader}格式无效`],
    ["客户交付签收单日期", "客户交付签收单日期格式无效"],
    ["外代交付签收单给商社日期", "外代交付签收单给商社日期格式无效"],
  ];
  if (overseas) dateColumns.push(
    ["ETD", "ETD 格式无效"],
    ["ETA", "ETA 格式无效"],
    ["客户通知做过户文件日期", "客户通知做过户文件日期格式无效"],
    ["客户通知放车日期", "客户通知放车日期格式无效"],
  );

  const seenVins = new Set<string>();
  const checked: CheckedImportRow[] = normalizedRows.map((row, index) => {
    const errors: string[] = [];
    const vin = text(row["车架号"])?.toUpperCase();
    if (!vin) errors.push("缺少车架号");
    else if (vin.length > 100) errors.push("车架号不能超过 100 个字符");
    else if (seenVins.has(vin)) errors.push("文件内车架号重复");
    if (vin) seenVins.add(vin);

    const parsedDates = new Map(dateColumns.map(([header, error]) => {
      const parsed = calendarDate(row[header], date1904);
      if (text(row[header]) && !parsed) errors.push(error);
      return [header, parsed] as const;
    }));
    const inbound = parsedDates.get(inboundHeader);
    const inventoryAt = parsedDates.get("库存日期");
    const outbound = parsedDates.get("实际出库日期");
    if (inbound && outbound && inbound > outbound) errors.push("入库日期晚于实际出库日期");
    if (inventoryAt && outbound && inventoryAt > outbound) errors.push("库存日期晚于实际出库日期");
    for (const amountHeader of ["入库金额", "出库金额"]) {
      const value = text(row[amountHeader]);
      if (value && (!/^\d{1,16}(?:\.\d{1,2})?$/.test(value) || Number(value) < 0)) errors.push(`${amountHeader}格式无效`);
    }
    if (overseas) {
      const etd = parsedDates.get("ETD");
      const eta = parsedDates.get("ETA");
      if (etd && eta && etd > eta) errors.push("ETD 晚于 ETA");
    }

    let payload: VehiclePayload;
    try {
      payload = payloadFor(row, overseas, date1904);
    } catch {
      errors.push("字段内容无法转换为车辆数据");
      payload = vehiclePayload.parse({ type: overseas ? "overseas" : "domestic", warehouseTimezone: "Asia/Shanghai" });
    }
    const referenceNo = text(row[overseas ? "提单号" : "PO#"]);
    return { row: index + 2, vin, referenceNo, destinationReferenceNo: referenceNo, errors, payload };
  });

  const expectedType = overseas ? "OVERSEAS" : "DOMESTIC";
  const vins = checked.flatMap(item => item.vin ? [item.vin] : []);
  const existing = vins.length ? await prisma.vehicle.findMany({
    where: { vin: { in: vins } },
    select: {
      id: true,
      version: true,
      vin: true,
      extra: true,
      inboundAt: true,
      inventoryAt: true,
      outboundAt: true,
      warehouse: { select: { name: true, location: true } },
      batch: {
        select: {
          id: true,
          type: true,
          referenceNo: true,
          warehouseId: true,
          warehouseKey: true,
          portOfLoad: true,
          portOfDischarge: true,
          vesselVoyage: true,
          etd: true,
          eta: true,
          manufacturer: true,
        },
      },
    },
  }) : [];
  const existingByVin = new Map(existing.flatMap(vehicle => vehicle.vin ? [[vehicle.vin.toUpperCase(), vehicle] as const] : []));
  for (const item of checked) {
    if (!item.vin) continue;
    const vehicle = existingByVin.get(item.vin);
    if (!vehicle) continue;
    const existingType = vehicle.batch?.type
      ?? (extraText(vehicle.extra, "businessType") === "domestic" ? "DOMESTIC" : extraText(vehicle.extra, "businessType") === "overseas" ? "OVERSEAS" : undefined);
    const existingReferenceNo = vehicle.batch?.referenceNo ?? extraText(vehicle.extra, "referenceNo");
    item.destinationReferenceNo ??= existingReferenceNo;
    item.existing = {
      id: vehicle.id,
      version: vehicle.version,
      warehouse: vehicle.warehouse?.name ?? extraText(vehicle.extra, "warehouse"),
      warehouseLocation: vehicle.warehouse?.location ?? extraText(vehicle.extra, "warehouseLocation"),
    };
    if ((existingType && existingType !== expectedType) || (item.referenceNo && existingReferenceNo && item.referenceNo !== existingReferenceNo)) {
      item.errors.push("车架号已存在且业务批次冲突");
      continue;
    }
    const inboundAt = item.payload.inboundAt ?? (vehicle.inboundAt ? fromPrismaDate(vehicle.inboundAt) : undefined);
    const inventoryAt = item.payload.inventoryAt ?? (vehicle.inventoryAt ? fromPrismaDate(vehicle.inventoryAt) : undefined);
    const outboundAt = item.payload.outboundAt ?? (vehicle.outboundAt ? fromPrismaDate(vehicle.outboundAt) : undefined);
    if (inboundAt && outboundAt && inboundAt > outboundAt && !item.errors.includes("入库日期晚于实际出库日期")) {
      item.errors.push("入库日期晚于实际出库日期");
    }
    if (inventoryAt && outboundAt && inventoryAt > outboundAt && !item.errors.includes("库存日期晚于实际出库日期")) {
      item.errors.push("库存日期晚于实际出库日期");
    }
    const etd = item.payload.etd ?? (vehicle.batch?.etd ? fromPrismaDate(vehicle.batch.etd) : calendarDate(extraText(vehicle.extra, "etd")));
    const eta = item.payload.eta ?? (vehicle.batch?.eta ? fromPrismaDate(vehicle.batch.eta) : calendarDate(extraText(vehicle.extra, "eta")));
    if (etd && eta && etd > eta && !item.errors.includes("ETD 晚于 ETA")) item.errors.push("ETD 晚于 ETA");
  }

  const destinationReferences = [...new Set(checked.flatMap(item => item.destinationReferenceNo ? [item.destinationReferenceNo] : []))];
  const destinationBatches = destinationReferences.length ? await prisma.businessBatch.findMany({
    where: { type: expectedType, referenceNo: { in: destinationReferences } },
    select: {
      id: true,
      type: true,
      referenceNo: true,
      warehouseId: true,
      warehouseKey: true,
      warehouse: { select: { name: true, location: true } },
      portOfLoad: true,
      portOfDischarge: true,
      vesselVoyage: true,
      etd: true,
      eta: true,
      manufacturer: true,
    },
  }) : [];
  const destinationByKey = new Map(destinationBatches.map(batch => [
    batchKey(batch.type, batch.referenceNo, batch.warehouse?.name, batch.warehouse?.location),
    batch,
  ]));
  for (const item of checked) {
    if (!item.destinationReferenceNo) {
      item.destinationBatchSnapshot = null;
      continue;
    }
    const destinationWarehouse = item.payload.warehouse ?? item.existing?.warehouse;
    const destinationWarehouseLocation = item.payload.warehouseLocation ?? item.existing?.warehouseLocation;
    item.destinationBatchKey = batchKey(expectedType, item.destinationReferenceNo, destinationWarehouse, destinationWarehouseLocation);
    item.destinationBatchSnapshot = businessBatchSnapshot(destinationByKey.get(item.destinationBatchKey));
  }

  const errors = checked.filter(item => item.errors.length).map(({ row, vin, errors: rowErrors }) => ({ row, vin, errors: rowErrors }));
  const validRows = checked.filter(item => !item.errors.length);
  return {
    fileName: file.name,
    businessType: overseas ? "海外仓" : "国内仓",
    totalRows: sourceRows.length,
    validRows: validRows.length,
    invalidRows: errors.length,
    createRows: validRows.filter(item => !item.existing).length,
    updateRows: validRows.filter(item => item.existing).length,
    missingHeaders,
    ignoredColumns,
    errors,
    rows: checked,
  };
}

export function publicCheckResult(result: CheckedWorkbook) {
  const { rows, ...data } = result;
  void rows;
  return data;
}
