import { describe, expect, it } from "vitest";
import type { VehicleRecord } from "../src/lib/domain";
import {
  createVehiclePivot,
  isMerchantUnreleased,
  isPhysicalInventory,
  recordsForPivotScope,
  summarizeVehicleInventory,
  vehiclePivotValue,
  vehicleReleaseStage,
} from "../src/lib/vehicle-statistics";

function record(overrides: Partial<VehicleRecord> = {}): VehicleRecord {
  return {
    id: "vehicle-1",
    version: 1,
    type: "domestic",
    warehouse: "中心仓",
    warehouseLocation: "上海",
    warehouseTimezone: "Asia/Shanghai",
    customer: "甲客户",
    status: "在库",
    inboundAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
    updateSequence: overrides.updateSequence ?? "1",
  };
}

const records = [
  record({ id: "unreleased" }),
  record({ id: "released", merchantReleaseAt: "2026-01-03" }),
  record({ id: "pickup", merchantReleaseAt: "2026-01-03", customerReleaseAt: "2026-01-04" }),
  record({ id: "notice", customer: "乙客户", merchantReleaseAt: "2026-01-03", outboundNoticeDeliveredAt: "2026-01-05" }),
  record({ id: "inconsistent", customer: undefined, warehouse: undefined, merchantReleaseAt: undefined, customerReleaseAt: "2026-01-04", outboundNoticeDeliveredAt: "2026-01-05" }),
  record({ id: "signed", history: [{ id: "signed-event", type: "DRIVER_SIGNED", title: "司机完成签收", occurredAt: "2026-01-06", recordedAt: "2026-01-06" }], status: "已完成" }),
  record({ id: "outbound", outboundAt: "2026-01-06", status: "待签收" }),
  record({ id: "unreleased" }),
];

describe("车辆库存透视统计", () => {
  it("按入库、实际出库和司机签收事实判断当前在库", () => {
    expect(isPhysicalInventory(record({ status: "异常" }))).toBe(true);
    expect(isMerchantUnreleased(record())).toBe(true);
    expect(isMerchantUnreleased(record({ merchantReleaseAt: "2026-01-02" }))).toBe(false);
    expect(isPhysicalInventory(record({ inboundAt: undefined }))).toBe(false);
    expect(isPhysicalInventory(record({ outboundAt: "2026-01-02" }))).toBe(false);
    expect(isPhysicalInventory(record({ history: [{ id: "signed", type: "DRIVER_SIGNED", title: "司机完成签收", occurredAt: "2026-01-02", recordedAt: "2026-01-02" }] }))).toBe(false);
  });

  it("汇总商社放车、提货、账龄及数据质量指标且按车辆 ID 去重", () => {
    const summary = summarizeVehicleInventory(records, new Date("2026-02-10T00:00:00.000Z"));

    expect(summary).toMatchObject({
      inventoryCount: 5,
      merchantUnreleasedCount: 2,
      merchantReleasedCount: 3,
      pendingPickupCount: 1,
      outboundNoticeCount: 2,
      overThirtyDaysCount: 5,
      missingCustomerCount: 1,
      missingWarehouseCount: 1,
      inconsistentReleaseSequenceCount: 1,
      signedWithoutOutboundCount: 1,
    });
    expect(summary.averageInventoryDays).toBe(41);
  });

  it("默认可生成客户乘放车进度的交叉表及行列总计", () => {
    const inventory = recordsForPivotScope(records, "inventory");
    const pivot = createVehiclePivot(inventory, "customer", "releaseStage", new Date("2026-02-10T00:00:00.000Z"));

    expect(pivot.columns).toEqual(["商社未放", "商社已放待下一步", "已放待提货", "出库通知已交付"]);
    expect(pivot.columnTotals).toEqual([2, 1, 1, 1]);
    expect(pivot.total).toBe(5);
    expect(pivot.rows.find(row => row.value === "甲客户")).toEqual({ value: "甲客户", cells: [1, 1, 1, 0], total: 3 });
    expect(pivot.rows.find(row => row.value === "乙客户")).toEqual({ value: "乙客户", cells: [0, 0, 0, 1], total: 1 });
    expect(pivot.rows.find(row => row.value === "未填写客户")).toEqual({ value: "未填写客户", cells: [1, 0, 0, 0], total: 1 });
  });

  it("支持切换统计范围并完整表示待入库和已离库节点", () => {
    const pending = record({ id: "pending", inboundAt: undefined, status: "待入库" });
    expect(recordsForPivotScope(records, "merchantUnreleased").map(vehicle => vehicle.id)).toEqual(["unreleased", "inconsistent"]);
    expect(recordsForPivotScope(records, "all")).toHaveLength(7);
    expect(vehicleReleaseStage(pending)).toBe("待入库");
    expect(vehicleReleaseStage(records.find(vehicle => vehicle.id === "signed")!)).toBe("已离库");
  });

  it("同名异地仓库保持为不同透视项", () => {
    const dubai = record({ id: "dubai", type: "overseas", warehouse: "MAXX", warehouseLocation: "迪拜" });
    const shanghai = record({ id: "shanghai", warehouse: "MAXX", warehouseLocation: "上海" });
    const pivot = createVehiclePivot([dubai, shanghai], "warehouse", "type");

    expect(pivot.rows.map(row => row.value)).toEqual(["MAXX · 迪拜", "MAXX · 上海"]);
    expect(pivot.columns).toEqual(["海外仓", "国内仓"]);
    expect(vehiclePivotValue(record({ warehouse: undefined, warehouseLocation: "宁波" }), "warehouse")).toBe("未填写仓库 · 宁波");
  });

  it("库存账龄在 7、15 和 30 天边界正确分档", () => {
    const now = new Date("2026-02-01T00:00:00.000Z");
    const cases = [
      ["2026-02-01", "0–7 天"],
      ["2026-01-26", "0–7 天"],
      ["2026-01-25", "8–15 天"],
      ["2026-01-18", "8–15 天"],
      ["2026-01-17", "16–30 天"],
      ["2026-01-03", "16–30 天"],
      ["2026-01-02", "31 天以上"],
    ] as const;

    for (const [inboundAt, expected] of cases) {
      expect(vehiclePivotValue(record({ inboundAt }), "inventoryAge", now)).toBe(expected);
    }
  });

  it("高基数行列会合并低频分类且保持总计不变", () => {
    const manyRecords = Array.from({ length: 105 }, (_, index) => record({
      id: `vehicle-${index}`,
      customer: `客户-${index}`,
      model: `车型-${index % 35}`,
    }));
    const pivot = createVehiclePivot(manyRecords, "customer", "model");

    expect(pivot.rows).toHaveLength(101);
    expect(pivot.columns).toHaveLength(31);
    expect(pivot.rows[pivot.rows.length - 1].value).toBe("其他（5 项）");
    expect(pivot.columns[pivot.columns.length - 1]).toBe("其他（5 项）");
    expect(pivot.groupedRowValues).toBe(5);
    expect(pivot.groupedColumnValues).toBe(5);
    expect(pivot.total).toBe(105);
    expect(pivot.columnTotals.reduce((sum, count) => sum + count, 0)).toBe(105);
  });
});
