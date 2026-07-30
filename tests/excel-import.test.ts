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

const legacyHeaderAliases: Readonly<Record<string, string>> = {
  入保税仓库日期: "入保税仓库时间",
  入仓库日期: "入仓库时间",
  商社通知放车日期: "商社通知放车时间",
  客户通知做过户文件日期: "客户通知做过户文件时间",
  客户通知放车日期: "客户通知放车时间",
  实际出库日期: "实际出保税库时间",
  出库通知单交付给商社日期: "出库通知单交付给商社",
  外代交付签收单给商社日期: "外代交付签收单给商社时间",
};
const legacyOverseasExcelHeaders = overseasExcelHeaders.map(header => legacyHeaderAliases[header] ?? header);
const legacyDomesticExcelHeaders = domesticExcelHeaders.map(header => legacyHeaderAliases[header] ?? header);

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

  it("兼容旧版国内仓表头并转换成规范车辆数据", async () => {
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
    const file = workbookFile(legacyDomesticExcelHeaders, [{
      车架号: "test-vin-001",
      车型: "测试车型",
      品牌: "测试品牌",
      "PO#": "PO-001",
      入仓库时间: new Date(2026, 6, 1, 23, 30),
      商社通知放车时间: 46205.5,
      实际出保税库时间: "2026-07-03T23:59:59.999-11:00",
      出库通知单交付给商社: "2026-07-04 08:30",
      客户交付签收单日期: "2026-07-05T00:00Z",
      外代交付签收单给商社时间: 46209.25,
      入库金额: "1200.50",
      出库金额: 1300,
    }]);

    const result = await checkWorkbook(file);

    expect(result).toMatchObject({
      businessType: "国内仓",
      totalRows: 1,
      validRows: 1,
      invalidRows: 0,
      missingHeaders: [],
      ignoredColumns: ["库存天数"],
    });
    expect(result.rows[0].payload).toMatchObject({
      type: "domestic",
      vin: "TEST-VIN-001",
      referenceNo: "PO-001",
      inboundAt: "2026-07-01",
      merchantReleaseAt: "2026-07-02",
      outboundAt: "2026-07-03",
      outboundNoticeDeliveredAt: "2026-07-04",
      customerReceiptDeliveredAt: "2026-07-05",
      agentReceiptDeliveredAt: "2026-07-06",
      inboundAmount: "1200.50",
      outboundAmount: "1300",
    });
    expect(result.rows[0]).toMatchObject({ destinationReferenceNo: "PO-001", destinationBatchKey: '["DOMESTIC","PO-001",null,null]' });
    expect(result.rows[0].destinationBatchSnapshot).toEqual(expect.any(String));
    expect(findVehicles).toHaveBeenCalledWith(expect.objectContaining({ where: { vin: { in: ["TEST-VIN-001"] } } }));
  });

  it("同时存在新旧表头时优先使用规范日期列", async () => {
    const result = await checkWorkbook(workbookFile(
      [...domesticExcelHeaders, "入仓库时间", "实际出保税库时间"],
      [{
        车架号: "VIN-CANONICAL-DATES",
        "PO#": "PO-CANONICAL-DATES",
        入仓库日期: "2026-07-01",
        入仓库时间: "2026-07-10",
        实际出库日期: "2026-07-03",
        实际出保税库时间: "2026-07-12",
      }],
    ));

    expect(result).toMatchObject({ validRows: 1, invalidRows: 0, missingHeaders: [], ignoredColumns: ["库存天数"] });
    expect(result.rows[0].payload).toMatchObject({ inboundAt: "2026-07-01", outboundAt: "2026-07-03" });
  });

  it("逐行报告缺失、重复、时间顺序和金额格式问题", async () => {
    const file = workbookFile(legacyOverseasExcelHeaders, [
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

    expect(result).toMatchObject({ missingHeaders: [], ignoredColumns: ["库存天数"] });
    expect(result.invalidRows).toBe(3);
    expect(result.errors[0].errors).toEqual(expect.arrayContaining(["入库日期晚于实际出库日期", "入库金额格式无效", "ETD 晚于 ETA"]));
    expect(result.errors[1].errors).toEqual(expect.arrayContaining(["文件内车架号重复", "ETA 格式无效", "出库金额格式无效"]));
    expect(result.errors[2].errors).toContain("缺少车架号");
  });

  it("严格校验所有映射的日期列", async () => {
    const result = await checkWorkbook(workbookFile(overseasExcelHeaders, [{
      提单号: "BL-INVALID-DATES",
      车架号: "VIN-INVALID-DATES",
      ETD: "2026-7-01",
      ETA: "2026-02-30",
      入保税仓库日期: "07/01/2026",
      商社通知放车日期: "2026-07-01 24:00",
      客户通知做过户文件日期: "2026-07-01T12:60",
      客户通知放车日期: "2026-07-01T12:00:60",
      实际出库日期: "July 1, 2026",
      出库通知单交付给商社日期: "2026-07-01T12:00+15:00",
      客户交付签收单日期: "2026-07-01T12:00+08:60",
      外代交付签收单给商社日期: "2026-07-01T12:00:00.",
    }]));

    expect(result).toMatchObject({ validRows: 0, invalidRows: 1 });
    expect(result.errors[0].errors).toHaveLength(10);
    expect(result.errors[0].errors).toEqual(expect.arrayContaining([
      "ETD 格式无效",
      "ETA 格式无效",
      "入库日期格式无效",
      "商社通知放车日期格式无效",
      "客户通知做过户文件日期格式无效",
      "客户通知放车日期格式无效",
      "实际出库日期格式无效",
      "出库通知单交付给商社日期格式无效",
      "客户交付签收单日期格式无效",
      "外代交付签收单给商社日期格式无效",
    ]));
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
      outboundAt: new Date(Date.UTC(2026, 6, 5)),
      warehouse: null,
      batch: { id: "batch-1", type: "DOMESTIC", referenceNo: "PO-001", etd: null, eta: null },
    }]);

    const result = await checkWorkbook(workbookFile(domesticExcelHeaders, [{
      车架号: "VIN-001",
      "PO#": "PO-001",
      入仓库日期: "2026-07-10",
    }]));

    expect(result).toMatchObject({ validRows: 0, invalidRows: 1, createRows: 0, updateRows: 0 });
    expect(result.errors[0].errors).toContain("入库日期晚于实际出库日期");
  });

  it("相同业务单号只使用目标仓库的批次快照", async () => {
    findBatches.mockResolvedValueOnce([
      {
        id: "batch-shanghai",
        type: "DOMESTIC",
        referenceNo: "PO-SHARED",
        warehouseId: "warehouse-shanghai",
        warehouseKey: "warehouse-shanghai",
        warehouse: { name: "上海仓", location: "上海" },
        portOfLoad: null,
        portOfDischarge: null,
        vesselVoyage: null,
        etd: null,
        eta: null,
        manufacturer: "上海批次生产商",
      },
      {
        id: "batch-ningbo",
        type: "DOMESTIC",
        referenceNo: "PO-SHARED",
        warehouseId: "warehouse-ningbo",
        warehouseKey: "warehouse-ningbo",
        warehouse: { name: "宁波仓", location: "宁波" },
        portOfLoad: null,
        portOfDischarge: null,
        vesselVoyage: null,
        etd: null,
        eta: null,
        manufacturer: "宁波批次生产商",
      },
    ]);
    const result = await checkWorkbook(workbookFile(domesticExcelHeaders, [
      { 车架号: "VIN-SHANGHAI", "PO#": "PO-SHARED", 入库仓库名称: "上海仓", 仓库地点: "上海" },
      { 车架号: "VIN-NINGBO", "PO#": "PO-SHARED", 入库仓库名称: "宁波仓", 仓库地点: "宁波" },
    ]));

    expect(result.rows[0].destinationBatchKey).toBe('["DOMESTIC","PO-SHARED","上海仓","上海"]');
    expect(result.rows[1].destinationBatchKey).toBe('["DOMESTIC","PO-SHARED","宁波仓","宁波"]');
    expect(result.rows[0].destinationBatchSnapshot).not.toBe(result.rows[1].destinationBatchSnapshot);
    expect(result.rows[0].destinationBatchSnapshot).toContain("batch-shanghai");
    expect(result.rows[1].destinationBatchSnapshot).toContain("batch-ningbo");
  });
});
