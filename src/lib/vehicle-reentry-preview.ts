import type { VehicleRecord } from "./domain";

export const MAX_REENTRY_VEHICLES = 500;
export const MAX_REENTRY_FILE_SIZE = 10 * 1024 * 1024;
const eligibleStatuses = new Set(["已出库", "待签收", "已完成"]);
const vinHeaders = new Set(["车架号", "车架号码", "车辆识别代号", "VIN"]);

export type ReentryPreviewRow = { vin: string; vehicle?: VehicleRecord; notes?: string; issue?: string };

export function normalizeReentryVin(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export function parseReentryVins(value: string) {
  return value.split(/[\s,，;；]+/).map(normalizeReentryVin).filter(vin => vin && !vinHeaders.has(vin));
}

export function reentryStatusIssue(vehicle: VehicleRecord) {
  return eligibleStatuses.has(vehicle.status) ? undefined : `当前为“${vehicle.status}”，仅已出库、待签收、已完成车辆可再次入库`;
}

export function reentryDateIssue(vehicle: VehicleRecord, inboundAt: string) {
  const dates = [vehicle.inboundAt, vehicle.outboundAt, ...(vehicle.history ?? [])
    .filter(event => event.type === "DRIVER_SIGNED" && (event.cycle ?? 1) === (vehicle.currentCycle ?? 1))
    .map(event => event.occurredAt)].filter((date): date is string => Boolean(date));
  return dates.some(date => date > inboundAt) ? "再次入库日期早于上一轮入库、实际出库或司机签收日期" : undefined;
}

export function matchReentryVins(vins: string[], records: VehicleRecord[], notesByVin: ReadonlyMap<string, string> = new Map()): ReentryPreviewRow[] {
  const normalizedVins = vins.map(normalizeReentryVin);
  const recordsByVin = new Map<string, VehicleRecord[]>();
  for (const vehicle of records) {
    const vin = normalizeReentryVin(vehicle.vin);
    if (vin) recordsByVin.set(vin, [...(recordsByVin.get(vin) ?? []), vehicle]);
  }
  const counts = new Map<string, number>();
  for (const vin of normalizedVins) counts.set(vin, (counts.get(vin) ?? 0) + 1);
  return normalizedVins.map(vin => {
    const matches = recordsByVin.get(vin) ?? [];
    const vehicle = matches.length === 1 ? matches[0] : undefined;
    const issue = (counts.get(vin) ?? 0) > 1 ? "名单中车架号重复"
      : matches.length > 1 ? "系统中存在多个同车架号档案，请在台账中明确选择车辆"
      : !vehicle ? "未找到对应车辆档案"
      : reentryStatusIssue(vehicle);
    const notes = notesByVin.get(vin);
    return { vin, vehicle, issue, ...(notes ? { notes } : {}) };
  });
}

export async function readReentryWorkbook(data: ArrayBuffer): Promise<{ vins: string[]; notesByVin: Map<string, string>; sheetNames: string[] }> {
  const XLSX = await import("xlsx");
  let workbook: import("xlsx").WorkBook;
  try {
    workbook = XLSX.read(data, { dense: true });
  } catch {
    throw new Error("无法读取 Excel 文件，请确认文件未损坏");
  }
  const vins: string[] = [];
  const notesByVin = new Map<string, string>();
  const sheetNames: string[] = [];
  for (const name of workbook.SheetNames) {
    if (workbook.Workbook?.Sheets?.find(sheet => sheet.name === name)?.Hidden) continue;
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    const headerRow = matrix.slice(0, 20).findIndex(row => row.some(value => vinHeaders.has(normalizeReentryVin(value))));
    if (headerRow < 0) continue;
    const vinColumns = matrix[headerRow].flatMap((value, index) => vinHeaders.has(normalizeReentryVin(value)) ? [index] : []);
    if (vinColumns.length !== 1) throw new Error(`工作表“${name}”包含多个车架号列，请保留一列后重试`);
    const notesColumns = matrix[headerRow].flatMap((value, index) => String(value ?? "").trim() === "备注" ? [index] : []);
    if (notesColumns.length > 1) throw new Error(`工作表“${name}”包含多个备注列，请保留一列后重试`);
    sheetNames.push(name);
    for (const row of matrix.slice(headerRow + 1)) {
      const vin = normalizeReentryVin(row[vinColumns[0]]);
      if (!vin || vinHeaders.has(vin)) continue;
      vins.push(vin);
      const notes = notesColumns.length ? String(row[notesColumns[0]] ?? "").trim() : "";
      if (notes.length > 5_000) throw new Error(`工作表“${name}”中车辆 ${vin} 的备注不能超过 5000 个字符`);
      if (notes) notesByVin.set(vin, notes);
      if (vins.length > MAX_REENTRY_VEHICLES) throw new Error(`单次最多再次入库 ${MAX_REENTRY_VEHICLES} 台车辆`);
    }
  }
  if (!sheetNames.length) throw new Error("可见工作表中未找到“车架号”或 VIN 列");
  if (!vins.length) throw new Error("车架号列中没有可读取的车辆");
  return { vins, notesByVin, sheetNames };
}
