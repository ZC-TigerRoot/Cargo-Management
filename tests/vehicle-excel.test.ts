import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { vehicles } from "../src/lib/demo-data";
import { createVehicleFilters, filterVehicleRecords } from "../src/lib/vehicle-filters";
import { createVehicleExportWorkbook, domesticExcelHeaders, overseasExcelHeaders } from "../src/lib/vehicle-excel";

function sheetRows(book: XLSX.WorkBook, name: string) {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[name], { defval: "" });
}

describe("车辆明细 Excel 导出", () => {
  it("车型筛选后只导出命中车型的明细和对应业务工作表", () => {
    const filtered = filterVehicleRecords(vehicles, { ...createVehicleFilters(), model: "宋 PLUS DM-i" });
    const book = createVehicleExportWorkbook(filtered);

    expect(book.SheetNames).toEqual(["海外仓"]);
    expect(sheetRows(book, "海外仓")).toHaveLength(1);
    expect(sheetRows(book, "海外仓")[0]).toMatchObject({ 车型: "宋 PLUS DM-i", 车架号: vehicles[0].vin });
  });

  it("明细表头与导入模板完全一致", () => {
    const book = createVehicleExportWorkbook(vehicles);
    const overseasHeader = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["海外仓"], { header: 1 })[0];
    const domesticHeader = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["国内仓"], { header: 1 })[0];

    expect(overseasHeader).toEqual(overseasExcelHeaders);
    expect(domesticHeader).toEqual(domesticExcelHeaders);
    expect(book.SheetNames).not.toContain("筛选统计");
  });

  it("筛选结果跨业务类型时分别保留各自的导入格式", () => {
    const filtered = filterVehicleRecords(vehicles, { ...createVehicleFilters(), brand: "比亚迪" });
    const book = createVehicleExportWorkbook(filtered);

    expect(book.SheetNames).toEqual(["海外仓", "国内仓"]);
    expect(sheetRows(book, "海外仓").every(row => row.品牌 === undefined || row.车型 === "宋 PLUS DM-i")).toBe(true);
    expect(sheetRows(book, "国内仓").every(row => row.品牌 === "比亚迪")).toBe(true);
  });
});
