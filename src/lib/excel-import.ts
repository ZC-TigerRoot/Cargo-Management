import "server-only";

import * as XLSX from "xlsx";
import { prisma } from "./prisma";
import { vehiclePayload } from "./validators";
import type { VehiclePayload } from "./vehicle-repository";

export const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 10_000;

const commonTail = [
  "商社通知放车时间", "出库提货明细", "库存天数", "客户交付签收单日期", "外代交付签收单给商社时间", "备注",
];
const overseasHeaders = [
  "提单号", "车架号", "车型", "HS#", "起运港", "目的港", "船名航次", "ETD", "ETA", "保税仓地点",
  "入保税仓库时间", "入库金额", "入库BOE号", "入库仓库名称", "所属客人", "商社通知放车时间", "客户通知做过户文件时间",
  "客户通知放车时间", "出库提货明细", "实际出保税库时间", "出库BOE号", "BOE抬头", "出库金额", "库存天数", "出库通知单交付给商社日期",
  "客户交付签收单日期", "外代交付签收单给商社时间", "备注",
];
const domesticHeaders = [
  "车架号", "车型", "品牌", "生产商", "PO#", "仓库地点", "入仓库时间", "入库金额", "入库BOE号", "入库仓库名称", "所属客人",
  ...commonTail.slice(0, 2), "实际出保税库时间", "出库BOE号", "BOE抬头", "出库金额", ...commonTail.slice(2, 3), "出库通知单交付给商社",
  ...commonTail.slice(3),
];

export class ImportWorkbookError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

export type ImportRowIssue = { row: number; vin?: string; errors: string[] };
export type CheckedImportRow = ImportRowIssue & { referenceNo?: string; payload: VehiclePayload };
export type CheckedWorkbook = {
  fileName: string;
  businessType: "海外仓" | "国内仓";
  totalRows: number;
  validRows: number;
  invalidRows: number;
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

function cellDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S))) : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

function iso(value: unknown) {
  return cellDate(value)?.toISOString();
}

function payloadFor(row: Record<string, unknown>, overseas: boolean): VehiclePayload {
  const inboundHeader = overseas ? "入保税仓库时间" : "入仓库时间";
  const outboundNoticeHeader = overseas ? "出库通知单交付给商社日期" : "出库通知单交付给商社";
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
    etd: iso(row.ETD),
    eta: iso(row.ETA),
    manufacturer: text(row["生产商"]),
    warehouseLocation: text(row[overseas ? "保税仓地点" : "仓库地点"]),
    warehouse: text(row["入库仓库名称"]),
    warehouseTimezone: "Asia/Shanghai",
    customer: text(row["所属客人"]),
    inboundAt: iso(row[inboundHeader]),
    inboundAmount: text(row["入库金额"]),
    inboundBoeNo: text(row["入库BOE号"]),
    merchantReleaseAt: iso(row["商社通知放车时间"]),
    transferDocNoticeAt: iso(row["客户通知做过户文件时间"]),
    customerReleaseAt: iso(row["客户通知放车时间"]),
    pickupDetails: text(row["出库提货明细"]),
    outboundAt: iso(row["实际出保税库时间"]),
    outboundBoeNo: text(row["出库BOE号"]),
    outboundBoeTitle: text(row["BOE抬头"]),
    outboundAmount: text(row["出库金额"]),
    outboundNoticeDeliveredAt: iso(row[outboundNoticeHeader]),
    customerReceiptDeliveredAt: iso(row["客户交付签收单日期"]),
    agentReceiptDeliveredAt: iso(row["外代交付签收单给商社时间"]),
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

  const overseas = headers.includes("提单号");
  const domestic = headers.includes("PO#");
  if (overseas === domestic) throw new ImportWorkbookError("UNKNOWN_TEMPLATE", "模板必须且只能包含“提单号”或“PO#”列", 422);
  const expected = overseas ? overseasHeaders : domesticHeaders;
  const missingHeaders = expected.filter(header => !headers.includes(header));
  const ignoredColumns = [...new Set(["库存天数", ...headers.filter(header => !expected.includes(header))])];
  const normalizedRows = sourceRows.map(row => Object.fromEntries(expected.map(header => [header, row[header] ?? ""])));

  const seenVins = new Set<string>();
  const checked: CheckedImportRow[] = normalizedRows.map((row, index) => {
    const errors: string[] = [];
    const vin = text(row["车架号"])?.toUpperCase();
    if (!vin) errors.push("缺少车架号");
    else if (vin.length > 100) errors.push("车架号不能超过 100 个字符");
    else if (seenVins.has(vin)) errors.push("文件内车架号重复");
    if (vin) seenVins.add(vin);

    const inboundHeader = overseas ? "入保税仓库时间" : "入仓库时间";
    const inbound = cellDate(row[inboundHeader]);
    const outbound = cellDate(row["实际出保税库时间"]);
    if (text(row[inboundHeader]) && !inbound) errors.push("入库时间格式无效");
    if (text(row["实际出保税库时间"]) && !outbound) errors.push("实际出库时间格式无效");
    if (inbound && outbound && inbound > outbound) errors.push("入库时间晚于实际出库时间");
    for (const amountHeader of ["入库金额", "出库金额"]) {
      const value = text(row[amountHeader]);
      if (value && (!/^\d{1,16}(?:\.\d{1,2})?$/.test(value) || Number(value) < 0)) errors.push(`${amountHeader}格式无效`);
    }
    if (overseas) {
      const etd = cellDate(row.ETD);
      const eta = cellDate(row.ETA);
      if (text(row.ETD) && !etd) errors.push("ETD 格式无效");
      if (text(row.ETA) && !eta) errors.push("ETA 格式无效");
      if (etd && eta && etd > eta) errors.push("ETD 晚于 ETA");
    }

    let payload: VehiclePayload;
    try {
      payload = payloadFor(row, overseas);
    } catch {
      errors.push("字段内容无法转换为车辆数据");
      payload = vehiclePayload.parse({ type: overseas ? "overseas" : "domestic", warehouseTimezone: "Asia/Shanghai" });
    }
    return { row: index + 2, vin, referenceNo: text(row[overseas ? "提单号" : "PO#"]), errors, payload };
  });

  const vins = checked.flatMap(item => item.vin ? [item.vin] : []);
  const existing = vins.length ? await prisma.vehicle.findMany({
    where: { vin: { in: vins } },
    select: { vin: true, batch: { select: { type: true, referenceNo: true } } },
  }) : [];
  const existingByVin = new Map(existing.flatMap(vehicle => vehicle.vin ? [[vehicle.vin.toUpperCase(), vehicle] as const] : []));
  for (const item of checked) {
    if (!item.vin) continue;
    const vehicle = existingByVin.get(item.vin);
    if (!vehicle) continue;
    const expectedType = overseas ? "OVERSEAS" : "DOMESTIC";
    item.errors.push(vehicle.batch && (vehicle.batch.type !== expectedType || vehicle.batch.referenceNo !== item.referenceNo)
      ? "车架号已存在且业务批次冲突"
      : "车架号已存在");
  }

  const errors = checked.filter(item => item.errors.length).map(({ row, vin, errors: rowErrors }) => ({ row, vin, errors: rowErrors }));
  return {
    fileName: file.name,
    businessType: overseas ? "海外仓" : "国内仓",
    totalRows: sourceRows.length,
    validRows: sourceRows.length - errors.length,
    invalidRows: errors.length,
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
