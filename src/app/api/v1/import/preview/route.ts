import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { Prisma } from "@prisma/client";
import { assertSameOrigin, AuthorizationError, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ROWS = 10_000;
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
  try {
    await requireUser("create");
    assertSameOrigin(req);
    const contentLengthHeader = req.headers.get("content-length");
    if (!contentLengthHeader) return NextResponse.json({ error: "LENGTH_REQUIRED", message: "上传请求必须包含 Content-Length" }, { status: 411 });
    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0) return NextResponse.json({ error: "INVALID_LENGTH", message: "上传请求长度无效" }, { status: 400 });
    if (contentLength > MAX_FILE_SIZE + 1_000_000) return NextResponse.json({ error: "FILE_TOO_LARGE", message: "Excel 文件不能超过 10 MB" }, { status: 413 });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "FILE_REQUIRED", message: "请选择 Excel 文件" }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "FILE_TOO_LARGE", message: "Excel 文件不能超过 10 MB" }, { status: 413 });
    if (!/\.xlsx?$/i.test(file.name)) return NextResponse.json({ error: "INVALID_FILE_TYPE", message: "仅支持 .xlsx 或 .xls 文件" }, { status: 415 });

    const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true, dense: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return NextResponse.json({ error: "EMPTY_WORKBOOK", message: "工作簿不包含可读取的工作表" }, { status: 422 });
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
    const headers = (matrix[0] ?? []).map(value => String(value ?? "").trim()).filter(Boolean);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
    if (rows.length > MAX_ROWS) return NextResponse.json({ error: "TOO_MANY_ROWS", message: `单次最多预校验 ${MAX_ROWS} 行` }, { status: 413 });

    const overseas = headers.includes("提单号");
    const domestic = headers.includes("PO#");
    if (overseas === domestic) return NextResponse.json({ error: "UNKNOWN_TEMPLATE", message: "模板必须且只能包含“提单号”或“PO#”列" }, { status: 422 });
    const expected = overseas ? overseasHeaders : domesticHeaders;
    const missingHeaders = expected.filter(header => !headers.includes(header));
    const normalizedRows = rows.map(row => Object.fromEntries(expected.map(header => [header, row[header] ?? ""])));

    const seenVins = new Set<string>();
    const checked = normalizedRows.map((row, index) => {
      const errors: string[] = [];
      const vin = String(row["车架号"] ?? "").trim().toUpperCase();
      if (!vin) errors.push("缺少车架号");
      else if (vin.length > 100) errors.push("车架号不能超过 100 个字符");
      else if (seenVins.has(vin)) errors.push("文件内车架号重复");
      if (vin) seenVins.add(vin);

      const inboundHeader = overseas ? "入保税仓库时间" : "入仓库时间";
      const outboundHeader = "实际出保税库时间";
      const inbound = cellDate(row[inboundHeader]);
      const outbound = cellDate(row[outboundHeader]);
      if (row[inboundHeader] && !inbound) errors.push("入库时间格式无效");
      if (row[outboundHeader] && !outbound) errors.push("实际出库时间格式无效");
      if (inbound && outbound && inbound > outbound) errors.push("入库时间晚于实际出库时间");
      for (const amountHeader of ["入库金额", "出库金额"]) {
        const value = row[amountHeader];
        if (value !== null && value !== undefined && String(value).trim() &&
          (!/^\d{1,16}(?:\.\d{1,2})?$/.test(String(value).trim()) || Number(value) < 0)) errors.push(`${amountHeader}格式无效`);
      }
      if (overseas) {
        const etd = cellDate(row.ETD);
        const eta = cellDate(row.ETA);
        if (row.ETD && !etd) errors.push("ETD 格式无效");
        if (row.ETA && !eta) errors.push("ETA 格式无效");
        if (etd && eta && etd > eta) errors.push("ETD 晚于 ETA");
      }
      return { row: index + 2, vin, referenceNo: String(row[overseas ? "提单号" : "PO#"] ?? "").trim(), errors };
    });

    const vins = checked.map(item => item.vin).filter(Boolean);
    const existing = vins.length ? await prisma.vehicle.findMany({
      where: { vin: { in: vins } },
      select: { vin: true, batch: { select: { type: true, referenceNo: true } } },
    }) : [];
    const existingByVin = new Map(existing.map(vehicle => [vehicle.vin.toUpperCase(), vehicle]));
    for (const item of checked) {
      const vehicle = existingByVin.get(item.vin);
      if (!vehicle) continue;
      const expectedType = overseas ? "OVERSEAS" : "DOMESTIC";
      item.errors.push(vehicle.batch?.type !== expectedType || vehicle.batch.referenceNo !== item.referenceNo
        ? "车架号已存在且业务批次冲突"
        : "车架号已存在");
    }
    const invalid = checked.filter(item => item.errors.length);
    return NextResponse.json({ data: {
      fileName: file.name,
      businessType: overseas ? "海外仓" : "国内仓",
      totalRows: rows.length,
      validRows: rows.length - invalid.length,
      invalidRows: invalid.length,
      missingHeaders,
      errors: invalid.slice(0, 100).map(({ row, vin, errors }) => ({ row, vin, errors })),
    } });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", message: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Prisma.PrismaClientInitializationError) {
      console.error(error);
      return NextResponse.json({ error: "DATABASE_ERROR", message: "数据库暂时不可用" }, { status: 503 });
    }
    console.error(error);
    return NextResponse.json({ error: "INVALID_WORKBOOK", message: "无法读取 Excel 文件，请确认文件未损坏" }, { status: 422 });
  }
}
