import { describe, expect, it } from "vitest";
import { vehicles } from "../src/lib/demo-data";
import {
  createVehicleFilters,
  EMPTY_FACET_VALUE,
  filterVehicleRecords,
  vehicleExportUrl,
  vehicleFacetOptions,
  vehicleFiltersFromSearchParams,
} from "../src/lib/vehicle-filters";

describe("车辆独立筛选与统计", () => {
  it("可组合业务、状态、仓库、品牌和单号条件", () => {
    const filters = {
      ...createVehicleFilters(),
      type: "domestic" as const,
      status: "异常" as const,
      warehouse: "宁波北仑仓",
      brand: "比亚迪",
      referenceNo: "240701",
    };
    expect(filterVehicleRecords(vehicles, filters).map(vehicle => vehicle.id)).toEqual(["v5"]);
  });

  it("跨字段搜索支持多个关键词同时匹配", () => {
    const filters = { ...createVehicleFilters(), q: "比亚迪 BL-2026-0712 海湾" };
    expect(filterVehicleRecords(vehicles, filters).map(vehicle => vehicle.id)).toEqual(["v1"]);
  });

  it("可分别筛选日期、金额和未填写字段", () => {
    const dateFilters = { ...createVehicleFilters(), inboundFrom: "2026-07-01", inboundTo: "2026-07-01" };
    expect(filterVehicleRecords(vehicles, dateFilters).map(vehicle => vehicle.id)).toEqual(["v5"]);

    const amountFilters = { ...createVehicleFilters(), inboundAmountMin: "12000", inboundAmountMax: "13000" };
    expect(filterVehicleRecords(vehicles, amountFilters).map(vehicle => vehicle.id)).toEqual(["v1"]);

    const missingBrandFilters = { ...createVehicleFilters(), brand: EMPTY_FACET_VALUE };
    const recordsWithMissingBrand = [...vehicles, { ...vehicles[0], id: "missing-brand", brand: undefined }];
    expect(filterVehicleRecords(recordsWithMissingBrand, missingBrandFilters).map(vehicle => vehicle.id)).toEqual(["missing-brand"]);
  });

  it("字段选项数量会保留其他筛选条件并忽略自身条件", () => {
    const filters = { ...createVehicleFilters(), customer: "新程汽车", status: "异常" as const };
    expect(vehicleFacetOptions(vehicles, filters, "status")).toEqual([
      { value: "待签收", count: 1 },
      { value: "异常", count: 1 },
    ]);
  });

  it("导出链接可无损还原当前筛选条件", () => {
    const filters = {
      ...createVehicleFilters(),
      type: "overseas" as const,
      status: "在库" as const,
      warehouse: "迪拜杰贝阿里保税仓",
      inboundFrom: "2026-06-01",
      inboundAmountMin: "10000.50",
    };
    const url = new URL(vehicleExportUrl(filters), "https://cargo.example.com");
    expect(vehicleFiltersFromSearchParams(url.searchParams)).toEqual(filters);
  });
});
