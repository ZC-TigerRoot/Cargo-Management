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
    const filtered = filterVehicleRecords(vehicles, { ...createVehicleFilters(), model: ["宋 PLUS DM-i"] });
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
    expect(overseasHeader).toEqual(expect.arrayContaining([
      "入保税仓库日期",
      "商社通知放车日期",
      "客户通知做过户文件日期",
      "客户通知放车日期",
      "实际出库日期",
      "外代交付签收单给商社日期",
    ]));
    expect(domesticHeader).toEqual(expect.arrayContaining([
      "入仓库日期",
      "商社通知放车日期",
      "实际出库日期",
      "出库通知单交付给商社日期",
      "外代交付签收单给商社日期",
    ]));
    const exportedHeaders = [...overseasHeader, ...domesticHeader];
    for (const legacyHeader of [
      "入保税仓库时间",
      "入仓库时间",
      "商社通知放车时间",
      "客户通知做过户文件时间",
      "客户通知放车时间",
      "实际出保税库时间",
      "出库通知单交付给商社",
      "外代交付签收单给商社时间",
    ]) expect(exportedHeaders).not.toContain(legacyHeader);
    expect(book.SheetNames).not.toContain("筛选统计");
  });

  it("所有日期列只导出 YYYY-MM-DD", () => {
    const overseas = vehicles.find(vehicle => vehicle.type === "overseas")!;
    const domestic = vehicles.find(vehicle => vehicle.type === "domestic")!;
    const book = createVehicleExportWorkbook([
      {
        ...overseas,
        etd: "2026-07-01",
        eta: "2026-07-02",
        inboundAt: "2026-07-03",
        inventoryAt: "2026-07-03",
        merchantReleaseAt: "2026-07-04",
        transferDocNoticeAt: "2026-07-05",
        customerReleaseAt: "2026-07-06",
        outboundAt: "2026-07-07",
        outboundNoticeDeliveredAt: "2026-07-08",
        customerReceiptDeliveredAt: "2026-07-09",
        agentReceiptDeliveredAt: "2026-07-10",
      },
      {
        ...domestic,
        inboundAt: "2026-08-01",
        inventoryAt: "2026-08-01",
        merchantReleaseAt: "2026-08-02",
        outboundAt: "2026-08-03",
        outboundNoticeDeliveredAt: "2026-08-04",
        customerReceiptDeliveredAt: "2026-08-05",
        agentReceiptDeliveredAt: "2026-08-06",
      },
    ]);

    expect(sheetRows(book, "海外仓")[0]).toMatchObject({
      ETD: "2026-07-01",
      ETA: "2026-07-02",
      入保税仓库日期: "2026-07-03",
      库存日期: "2026-07-03",
      商社通知放车日期: "2026-07-04",
      客户通知做过户文件日期: "2026-07-05",
      客户通知放车日期: "2026-07-06",
      实际出库日期: "2026-07-07",
      出库通知单交付给商社日期: "2026-07-08",
      客户交付签收单日期: "2026-07-09",
      外代交付签收单给商社日期: "2026-07-10",
    });
    expect(sheetRows(book, "国内仓")[0]).toMatchObject({
      入仓库日期: "2026-08-01",
      库存日期: "2026-08-01",
      商社通知放车日期: "2026-08-02",
      实际出库日期: "2026-08-03",
      出库通知单交付给商社日期: "2026-08-04",
      客户交付签收单日期: "2026-08-05",
      外代交付签收单给商社日期: "2026-08-06",
    });
  });

  it("筛选结果跨业务类型时分别保留各自的导入格式", () => {
    const filtered = filterVehicleRecords(vehicles, { ...createVehicleFilters(), brand: ["比亚迪"] });
    const book = createVehicleExportWorkbook(filtered);

    expect(book.SheetNames).toEqual(["海外仓", "国内仓"]);
    expect(sheetRows(book, "海外仓").every(row => row.品牌 === undefined || row.车型 === "宋 PLUS DM-i")).toBe(true);
    expect(sheetRows(book, "国内仓").every(row => row.品牌 === "比亚迪")).toBe(true);
  });
});
