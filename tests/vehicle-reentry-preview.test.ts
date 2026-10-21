import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { VehicleRecord } from "../src/lib/domain";
import { matchReentryVins, parseReentryVins, readReentryWorkbook, reentryDateIssue } from "../src/lib/vehicle-reentry-preview";

const completed: VehicleRecord = { id: "v1", version: 2, updateSequence: "1", vin: "LFV12345678900001", type: "domestic", status: "已完成", currentCycle: 1, warehouse: "上海仓", warehouseTimezone: "Asia/Shanghai", updatedAt: "2026-10-07" };

function workbookBytes(workbook: XLSX.WorkBook) {
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("批量再次入库名单预览", () => {
  it("粘贴车架号可使用换行、逗号或分号，并规范大小写", () => {
    expect(parseReentryVins("车架号\nlfv12345678900001， LFV12345678900002;LFV12345678900003\n"))
      .toEqual(["LFV12345678900001", "LFV12345678900002", "LFV12345678900003"]);
  });

  it("从完整台账匹配，不依赖当前列表筛选，并保留乐观锁版本", () => {
    const preview = matchReentryVins(["lfv12345678900001"], [completed]);
    expect(preview).toEqual([{ vin: completed.vin, vehicle: completed, issue: undefined }]);
    expect(preview[0].vehicle?.version).toBe(2);
  });

  it("重复、未知、系统歧义和状态不符均不得作为可提交行", () => {
    const inStock = { ...completed, id: "v2", vin: "STOCK", status: "在库" as const };
    const ambiguous = { ...completed, id: "v3", vin: "AMBIGUOUS" };
    const records = [completed, inStock, ambiguous, { ...ambiguous, id: "v4" }];
    const preview = matchReentryVins([completed.vin!, completed.vin!.toLowerCase(), "UNKNOWN", "STOCK", "AMBIGUOUS"], records);
    expect(preview.map(row => row.issue)).toEqual([
      "名单中车架号重复", "名单中车架号重复", "未找到对应车辆档案",
      "当前为“在库”，仅已出库、待签收、已完成车辆可再次入库",
      "系统中存在多个同车架号档案，请在台账中明确选择车辆",
    ]);
  });

  it("Excel 只读取可见工作表车架号，不采纳旧日期和状态", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["车架号"], ["HIDDEN"]]), "隐藏汇总");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["国内车辆返库名单"], ["车架号", "入库日期", "状态"], [completed.vin, "2000-01-01", "已完成"]]), "国内仓储");
    workbook.Workbook = { Sheets: [{ name: "隐藏汇总", Hidden: 1 }, { name: "国内仓储", Hidden: 0 }] };
    expect(await readReentryWorkbook(workbookBytes(workbook))).toEqual({ vins: [completed.vin], sheetNames: ["国内仓储"] });
  });

  it("多个可见表中的重复 VIN 会进入预览校验", async () => {
    const workbook = XLSX.utils.book_new();
    for (const name of ["名单1", "名单2"]) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["VIN"], [completed.vin]]), name);
    const { vins } = await readReentryWorkbook(workbookBytes(workbook));
    expect(matchReentryVins(vins, [completed]).every(row => row.issue === "名单中车架号重复")).toBe(true);
  });

  it("没有车架号列或超过单批上限的工作簿不能使用", async () => {
    const missing = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(missing, XLSX.utils.aoa_to_sheet([["车型"], ["汽车"]]), "数据");
    await expect(readReentryWorkbook(workbookBytes(missing))).rejects.toThrow("未找到");
    const tooMany = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(tooMany, XLSX.utils.aoa_to_sheet([["VIN"], ...Array.from({ length: 501 }, (_, index) => [`VIN${index}`])]), "数据");
    await expect(readReentryWorkbook(workbookBytes(tooMany))).rejects.toThrow("500");
  });

  it("日期预览拒绝早于上轮出库或本轮签收的返库日，并忽略更早轮次签收", () => {
    expect(reentryDateIssue({ ...completed, outboundAt: "2026-10-07" }, "2026-10-06")).toBeDefined();
    expect(reentryDateIssue({ ...completed, outboundAt: "2026-10-07" }, "2026-10-07")).toBeUndefined();
    const history = [{ id: "signed", type: "DRIVER_SIGNED", cycle: 1, title: "签收", occurredAt: "2026-10-07", recordedAt: "2026-10-07" }];
    expect(reentryDateIssue({ ...completed, history }, "2026-10-06")).toBeDefined();
    expect(reentryDateIssue({ ...completed, currentCycle: 2, history }, "2026-10-06")).toBeUndefined();
  });
});
