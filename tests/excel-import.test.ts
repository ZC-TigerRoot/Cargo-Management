import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

const findVehicles = vi.hoisted(() => vi.fn());
const findBatches = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/prisma", () => ({ prisma: { vehicle: { findMany: findVehicles }, businessBatch: { findMany: findBatches } } }));

import {
  assertImportFile,
  checkWorkbook,
  ImportWorkbookError,
  MAX_IMPORT_FILE_SIZE,
  publicCheckResult,
} from "../src/lib/excel-import";
import { domesticExcelHeaders, overseasExcelHeaders } from "../src/lib/vehicle-excel";

function workbookFile(headers: readonly string[], rows: Record<string, unknown>[], name = "vehicles.xlsx") {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows, { header: [...headers] });
  XLSX.utils.book_append_sheet(book, sheet, "车辆");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx", cellDates: true });
  return new File([bytes], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

beforeEach(() => {
  vi.clearAllMocks();
  findVehicles.mockResolvedValue([]);
  findBatches.mockResolvedValue([]);
});

describe("Excel 导入预校验", () => {
  it("拒绝缺失、超限和非 Excel 文件", () => {
    expect(() => assertImportFile(null)).toThrowError(ImportWorkbookError);
    const oversized = new File(["x"], "large.xlsx");
    Object.defineProperty(oversized, "size", { value: MAX_IMPORT_FILE_SIZE + 1 });
    expect(() => assertImportFile(oversized)).toThrowError(expect.objectContaining({ code: "FILE_TOO_LARGE", status: 413 }));
    expect(() => assertImportFile(new File(["x"], "vehicles.csv"))).toThrowError(expect.objectContaining({ code: "INVALID_FILE_TYPE" }));
  });

  it("拒绝无法判断业务类型和同时包含两种单号的模板", async () => {
    await expect(checkWorkbook(workbookFile(["车架号", "车型"], [{ 车架号: "VIN-1" }]))).rejects.toMatchObject({ code: "UNKNOWN_TEMPLATE" });
    await expect(checkWorkbook(workbookFile(["车架号", "提单号", "PO#"], [{ 车架号: "VIN-1" }]))).rejects.toMatchObject({ code: "UNKNOWN_TEMPLATE" });
  });

  it("将有效国内仓工作簿转换成规范车辆数据", async () => {
    findBatches.mockResolvedValueOnce([{
      id: "batch-1",
      type: "DOMESTIC",
      referenceNo: "PO-001",
      portOfLoad: null,
      portOfDischarge: null,
      vesselVoyage: null,
      etd: null,
      eta: null,
      manufacturer: "测试生产商",
    }]);
    const file = workbookFile(domesticExcelHeaders, [{
      车架号: "test-vin-001",
      车型: "测试车型",
      品牌: "测试品牌",
      "PO#": "PO-001",
      入仓库时间: new Date("2026-07-01T01:00:00.000Z"),
      实际出保税库时间: new Date("2026-07-03T01:00:00.000Z"),
      入库金额: "1200.50",
      出库金额: 1300,
    }]);

    const result = await checkWorkbook(file);

    expect(result).toMatchObject({ businessType: "国内仓", totalRows: 1, validRows: 1, invalidRows: 0, missingHeaders: [] });
    expect(result.rows[0].payload).toMatchObject({
      type: "domestic",
      vin: "TEST-VIN-001",
      referenceNo: "PO-001",
      inboundAmount: "1200.50",
      outboundAmount: "1300",
    });
    expect(result.rows[0]).toMatchObject({ destinationReferenceNo: "PO-001", destinationBatchKey: '["DOMESTIC","PO-001"]' });
    expect(result.rows[0].destinationBatchSnapshot).toEqual(expect.any(String));
    expect(findVehicles).toHaveBeenCalledWith(expect.objectContaining({ where: { vin: { in: ["TEST-VIN-001"] } } }));
  });

  it("逐行报告缺失、重复、时间顺序和金额格式问题", async () => {
    const file = workbookFile(overseasExcelHeaders, [
      {
        提单号: "BL-001",
        车架号: "DUPLICATE-VIN",
        ETD: "2026-07-05",
        ETA: "2026-07-01",
        入保税仓库时间: "2026-07-10",
        实际出保税库时间: "2026-07-02",
        入库金额: "-1",
      },
      { 提单号: "BL-001", 车架号: "duplicate-vin", ETA: "not-a-date", 出库金额: "12.345" },
      { 提单号: "BL-001", 车架号: "" },
    ]);

    const result = await checkWorkbook(file);

    expect(result.invalidRows).toBe(3);
    expect(result.errors[0].errors).toEqual(expect.arrayContaining(["入库时间晚于实际出库时间", "入库金额格式无效", "ETD 晚于 ETA"]));
    expect(result.errors[1].errors).toEqual(expect.arrayContaining(["文件内车架号重复", "ETA 格式无效", "出库金额格式无效"]));
    expect(result.errors[2].errors).toContain("缺少车架号");
  });

  it("将同批次已有车辆识别为更新，并拒绝批次冲突且隐藏内部行数据", async () => {
    findVehicles.mockResolvedValueOnce([
      { id: "vehicle-same", version: 3, vin: "VIN-SAME", extra: {}, batch: { id: "batch-1", type: "DOMESTIC", referenceNo: "PO-001" } },
      { id: "vehicle-conflict", version: 2, vin: "VIN-CONFLICT", extra: {}, batch: { id: "batch-2", type: "OVERSEAS", referenceNo: "BL-OLD" } },
    ]);
    const result = await checkWorkbook(workbookFile(domesticExcelHeaders, [
      { 车架号: "VIN-SAME", "PO#": "PO-001" },
      { 车架号: "VIN-CONFLICT", "PO#": "PO-002" },
    ]));

    expect(result).toMatchObject({ validRows: 1, invalidRows: 1, createRows: 0, updateRows: 1 });
    expect(result.rows[0].existing).toMatchObject({ id: "vehicle-same", version: 3 });
    expect(result.errors[0]).toMatchObject({ vin: "VIN-CONFLICT", errors: ["车架号已存在且业务批次冲突"] });
    expect(publicCheckResult(result)).not.toHaveProperty("rows");
  });

  it("使用已有字段预校验增量更新后的时间顺序", async () => {
    findVehicles.mockResolvedValueOnce([{
      id: "vehicle-1",
      version: 2,
      vin: "VIN-001",
      extra: {},
      inboundAt: null,
      outboundAt: new Date("2026-07-05T00:00:00.000Z"),
      warehouse: null,
      batch: { id: "batch-1", type: "DOMESTIC", referenceNo: "PO-001", etd: null, eta: null },
    }]);

    const result = await checkWorkbook(workbookFile(domesticExcelHeaders, [{
      车架号: "VIN-001",
      "PO#": "PO-001",
      入仓库时间: "2026-07-10",
    }]));

    expect(result).toMatchObject({ validRows: 0, invalidRows: 1, createRows: 0, updateRows: 0 });
    expect(result.errors[0].errors).toContain("入库时间晚于实际出库时间");
  });
});
