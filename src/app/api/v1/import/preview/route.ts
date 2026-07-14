import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

const commonTail = [
  "商社通知放车时间", "出库提货明细", "库存天数", "客户交付签收单日期", "外代交付签收单给商社时间", "备注",
];
const overseasHeaders = [
  "提单号", "车架号", "车型", "HS#", "起运港", "目的港", "船名航次", "ETD", "ETA", "保税仓地点",
  "入保税仓库时间", "入库仓库名称", "所属客人", "商社通知放车时间", "客户通知做过户文件时间",
  "客户通知放车时间", "出库提货明细", "实际出保税库时间", "库存天数", "出库通知单交付给商社日期",
  "客户交付签收单日期", "外代交付签收单给商社时间", "备注",
];
const domesticHeaders = [
  "车架号", "车型", "品牌", "生产商", "PO#", "仓库地点", "入仓库时间", "入库仓库名称", "所属客人",
  ...commonTail.slice(0, 2), "实际出保税库时间", ...commonTail.slice(2, 3), "出库通知单交付给商社",
  ...commonTail.slice(3),
];

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

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "FILE_REQUIRED", message: "请选择 Excel 文件" }, { status: 400 });

  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
    const headers = rows[0] ? Object.keys(rows[0]) : [];
    const overseas = headers.includes("提单号") || headers.some(header => overseasHeaders.slice(3, 10).includes(header));
    const domestic = headers.includes("PO#") || headers.includes("生产商");
    if (!overseas && !domestic) {
      return NextResponse.json({ error: "UNKNOWN_TEMPLATE", message: "无法识别模板：请包含“提单号”或“PO#”列" }, { status: 422 });
    }

    const expected = overseas ? overseasHeaders : domesticHeaders;
    const missingHeaders = expected.filter(header => !headers.includes(header));
    const outboundHeader = "实际出保税库时间";
    const seenVins = new Set<string>();
    const invalid = rows.map((row, index) => {
      const errors: string[] = [];
      const vin = String(row["车架号"] ?? "").trim();
      if (!vin) errors.push("缺少车架号");
      else if (vin.length !== 17) errors.push("车架号不是 17 位");
      else if (seenVins.has(vin)) errors.push("文件内车架号重复");
      if (vin) seenVins.add(vin);

      const inbound = cellDate(row[overseas ? "入保税仓库时间" : "入仓库时间"]);
      const outbound = cellDate(row[outboundHeader]);
      if (row[overseas ? "入保税仓库时间" : "入仓库时间"] && !inbound) errors.push("入库时间格式无效");
      if (row[outboundHeader] && !outbound) errors.push("实际出库时间格式无效");
      if (inbound && outbound && inbound > outbound) errors.push("入库时间晚于实际出库时间");
      if (overseas) {
        const etd = cellDate(row.ETD);
        const eta = cellDate(row.ETA);
        if (row.ETD && !etd) errors.push("ETD 格式无效");
        if (row.ETA && !eta) errors.push("ETA 格式无效");
        if (etd && eta && etd > eta) errors.push("ETD 晚于 ETA");
      }
      return { row: index + 2, vin: row["车架号"], errors };
    }).filter(item => item.errors.length);

    return NextResponse.json({ data: {
      fileName: file.name,
      businessType: overseas ? "海外仓" : "国内仓",
      totalRows: rows.length,
      validRows: rows.length - invalid.length,
      invalidRows: invalid.length,
      missingHeaders,
      errors: invalid.slice(0, 100),
    } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "INVALID_WORKBOOK", message: "无法读取 Excel 文件，请确认文件未损坏" }, { status: 422 });
  }
}
