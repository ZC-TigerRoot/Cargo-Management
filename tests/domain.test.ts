import { describe, expect, it } from "vitest";
import { can, inventoryDays, transitions } from "../src/lib/domain";
import { driverSubmission, vehicleInput, vehicleUpdateInput } from "../src/lib/validators";
import { localInputValue, zonedLocalToIso } from "../src/lib/datetime";

describe("库存领域规则", () => {
  it("出库后库存天数固定", () => expect(inventoryDays("2026-07-01T00:00:00Z", "2026-07-11T00:00:00Z", new Date("2026-08-01"))).toBe(10));
  it("在库天数按当前时间计算", () => expect(inventoryDays("2026-07-01T00:00:00Z", undefined, new Date("2026-07-03T00:00:00Z"))).toBe(2));
  it("货代和管理员可导出，客户与仓管不可导出", () => {
    expect(can("forwarder", "export")).toBe(true);
    expect(can("warehouse", "export")).toBe(false);
    expect(can("customer", "export")).toBe(false);
  });
  it("事件推导状态", () => expect(transitions.DRIVER_SIGNED).toBe("已完成"));
});

describe("司机提车凭证校验", () => {
  const base = {
    pickupAt: "2026-07-15T08:00:00.000Z",
    idempotencyKey: "driver-submit-001",
  };

  it("只上传图片即可提交", () => {
    expect(driverSubmission.safeParse({ ...base, photoDataUrl: "data:image/jpeg;base64,AQ==" }).success).toBe(true);
  });

  it("未上传图片时拒绝提交", () => {
    expect(driverSubmission.safeParse(base).success).toBe(false);
  });
});

describe("车辆录入校验", () => {
  const base = {
    vin: "L6T79S2E8RA102847",
    model: "宋 PLUS DM-i",
    type: "overseas" as const,
    referenceNo: "BL-2026-0712",
    warehouseLocation: "Dubai Logistics District",
    warehouse: "迪拜杰贝阿里保税仓",
    warehouseTimezone: "Asia/Shanghai",
    customer: "海湾汽车贸易",
    idempotencyKey: "test-request-001",
  };

  it("接受完整海外仓字段", () => {
    const result = vehicleInput.safeParse({
      ...base,
      hsCode: "870380",
      portOfLoad: "上海港",
      portOfDischarge: "杰贝阿里港",
      vesselVoyage: "COSCO / 071E",
      etd: "2026-06-05T00:00:00.000Z",
      eta: "2026-06-21T04:00:00.000Z",
      inboundAt: "2026-06-23T05:30:00.000Z",
      merchantReleaseAt: "2026-07-08T10:20:00.000Z",
      transferDocNoticeAt: "2026-07-09T06:15:00.000Z",
      customerReleaseAt: "2026-07-10T06:15:00.000Z",
      pickupDetails: "提取一辆",
      outboundAt: "2026-07-12T11:30:00.000Z",
      outboundNoticeDeliveredAt: "2026-07-12T12:00:00.000Z",
      customerReceiptDeliveredAt: "2026-07-12T12:30:00.000Z",
      agentReceiptDeliveredAt: "2026-07-13T05:00:00.000Z",
      notes: "随车钥匙两把",
    });
    expect(result.success).toBe(true);
  });

  it("拒绝早于入库时间的出库时间", () => {
    const result = vehicleInput.safeParse({
      ...base,
      inboundAt: "2026-07-12T00:00:00.000Z",
      outboundAt: "2026-07-11T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("允许更新当前车辆状态", () => {
    const vehicle = Object.fromEntries(Object.entries(base).filter(([key]) => key !== "idempotencyKey"));
    const result = vehicleUpdateInput.safeParse({
      ...vehicle,
      id: "vehicle-001",
      version: 1,
      status: "异常",
      statusReason: "右后视镜划痕，等待客户确认",
    });
    expect(result.success).toBe(true);
  });

  it("拒绝未知车辆状态", () => {
    const vehicle = Object.fromEntries(Object.entries(base).filter(([key]) => key !== "idempotencyKey"));
    const result = vehicleUpdateInput.safeParse({ ...vehicle, id: "vehicle-001", version: 1, status: "运输中" });
    expect(result.success).toBe(false);
  });

  it("状态变更必须填写原因", () => {
    const vehicle = Object.fromEntries(Object.entries(base).filter(([key]) => key !== "idempotencyKey"));
    expect(vehicleUpdateInput.safeParse({ ...vehicle, id: "vehicle-001", version: 1, status: "异常" }).success).toBe(false);
  });

  it("规范化小写 VIN", () => {
    const result = vehicleInput.parse({ ...base, vin: "l6t79s2e8ra102847" });
    expect(result.vin).toBe("L6T79S2E8RA102847");
  });

  it("接受非 17 位车架号及新的出入库字段", () => {
    const result = vehicleInput.safeParse({
      ...base,
      vin: "TEST-CHASSIS-001",
      inboundAmount: "1200.50",
      inboundBoeNo: "BOE-IN-001",
      outboundBoeNo: "BOE-OUT-001",
      outboundBoeTitle: "测试客户",
      outboundAmount: "1350.00",
    });
    expect(result.success).toBe(true);
  });
});

describe("系统时区", () => {
  it("统一按中国标准时间解释录入值", () => {
    const instant = zonedLocalToIso("2026-07-14T09:30", "Asia/Shanghai");
    expect(instant).toBe("2026-07-14T01:30:00.000Z");
    expect(localInputValue(instant, "Asia/Shanghai")).toBe("2026-07-14T09:30");
  });
});
