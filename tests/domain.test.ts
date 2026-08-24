import { describe, expect, it } from "vitest";
import { can, inventoryDays, transitions, vehicleInventoryDays } from "../src/lib/domain";
import { driverSubmission, vehicleDeleteInput, vehicleInput, vehicleUpdateInput } from "../src/lib/validators";
import { addCalendarDays, chinaToday, fromPrismaDate, localInputValue, toPrismaDate, zonedLocalToIso } from "../src/lib/datetime";
import { matchesPickupSearch, pickupTaskMatchesSearch, pickupVehicleSearchValues } from "../src/lib/pickup-search";

describe("库存领域规则", () => {
  it("同日入出库计为一天", () => expect(inventoryDays("2026-07-01", "2026-07-01")).toBe(1));
  it("出库后按首尾日期计算库存天数", () => expect(inventoryDays("2026-07-01", "2026-07-11", new Date("2026-08-01"))).toBe(11));
  it("在库天数按当前日期计算", () => expect(inventoryDays("2026-07-01", undefined, new Date("2026-07-03T00:00:00Z"))).toBe(3));
  it("填写库存日期后从库存日期计算并随当前日期递增", () => {
    expect(vehicleInventoryDays({ inboundAt: "2026-07-01", inventoryAt: "2026-07-25" }, new Date("2026-08-01T00:00:00Z"))).toBe(8);
    expect(vehicleInventoryDays({ inboundAt: "2026-07-01", inventoryAt: "2026-07-25", outboundAt: "2026-07-31" }, new Date("2026-08-01T00:00:00Z"))).toBe(7);
  });
  it("货代和管理员可导出，客户与仓管不可导出", () => {
    expect(can("forwarder", "export")).toBe(true);
    expect(can("warehouse", "export")).toBe(false);
    expect(can("customer", "export")).toBe(false);
  });
  it("只有管理员可以管理用户", () => {
    expect(can("admin", "manageUsers")).toBe(true);
    expect(can("forwarder", "manageUsers")).toBe(false);
    expect(can("warehouse", "manageUsers")).toBe(false);
    expect(can("customer", "manageUsers")).toBe(false);
  });
  it("只有管理员可以修改提货链接域名", () => {
    expect(can("admin", "managePublicUrl")).toBe(true);
    expect(can("forwarder", "managePublicUrl")).toBe(false);
  });
  it("只有管理员可以删除车辆", () => {
    expect(can("admin", "delete")).toBe(true);
    expect(can("forwarder", "delete")).toBe(false);
    expect(can("warehouse", "delete")).toBe(false);
    expect(can("customer", "delete")).toBe(false);
  });
  it("事件推导状态", () => expect(transitions.DRIVER_SIGNED).toBe("已完成"));
});

describe("司机提车凭证校验", () => {
  const base = {
    idempotencyKey: "driver-submit-001",
    driverName: "张师傅",
    driverPhone: "138 0013 8000",
  };

  it("不要求客户端提交 pickupAt", () => {
    expect(driverSubmission.parse(base)).toEqual(base);
  });

  it("剔除 pickupAt 和 Base64 图片等未知字段", () => {
    const result = driverSubmission.parse({
      ...base,
      pickupAt: "2026-07-15T08:00:00.000Z",
      photoDataUrl: "data:image/jpeg;base64,AQ==",
    });
    expect(result).toEqual(base);
    expect(result).not.toHaveProperty("pickupAt");
    expect(result).not.toHaveProperty("photoDataUrl");
  });

  it("姓名和联系电话均为必填", () => {
    expect(driverSubmission.safeParse({ ...base, driverName: "" }).success).toBe(false);
    expect(driverSubmission.safeParse({ ...base, driverPhone: "" }).success).toBe(false);
  });

  it("拒绝无效联系电话", () => {
    expect(driverSubmission.safeParse({ ...base, driverPhone: "abc123" }).success).toBe(false);
  });
});

describe("车辆删除校验", () => {
  it("兼容单条删除并规范成数组", () => {
    expect(vehicleDeleteInput.parse({ id: "vehicle-001" })).toEqual({ ids: ["vehicle-001"] });
  });

  it("接受批量删除且拒绝空数组", () => {
    expect(vehicleDeleteInput.parse({ ids: ["vehicle-001", "vehicle-002"] })).toEqual({ ids: ["vehicle-001", "vehicle-002"] });
    expect(vehicleDeleteInput.safeParse({ ids: [] }).success).toBe(false);
  });

  it("批量删除数量不设上限", () => {
    const ids = Array.from({ length: 715 }, (_, index) => `vehicle-${index + 1}`);
    expect(vehicleDeleteInput.parse({ ids })).toEqual({ ids });
  });
});

describe("提货二维码搜索", () => {
  const vehicle = {
    id: "vehicle-001",
    version: 1,
    updateSequence: "1",
    vin: "LC0CE4CC5R0123456",
    model: "BYD TANG L EV",
    brand: "BYD",
    type: "domestic" as const,
    referenceNo: "PO-2026-0716",
    warehouse: "上海临港仓",
    warehouseLocation: "上海",
    warehouseTimezone: "Asia/Shanghai",
    customer: "远洋汽车",
    inboundBoeNo: "BOE-IN-0716",
    status: "在库" as const,
    updatedAt: "2026-07-16",
  };

  it("可按多个单据信息关键词匹配车辆", () => {
    const values = pickupVehicleSearchValues(vehicle);
    expect(matchesPickupSearch(values, "PO-2026 BYD")).toBe(true);
    expect(matchesPickupSearch(values, "远洋 临港")).toBe(true);
    expect(matchesPickupSearch(values, "不存在的单号")).toBe(false);
  });

  it("已有二维码任务可回查车辆台账中的单号和 BOE", () => {
    const task = { taskNo: "PU-20260716-001", vehicles: [{ id: vehicle.id, vin: vehicle.vin, model: vehicle.model }] };
    const records = new Map([[vehicle.id, vehicle]]);
    expect(pickupTaskMatchesSearch(task, records, "PU-20260716")).toBe(true);
    expect(pickupTaskMatchesSearch(task, records, "PO-2026-0716")).toBe(true);
    expect(pickupTaskMatchesSearch(task, records, "BOE-IN-0716")).toBe(true);
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
      etd: "2026-06-05",
      eta: "2026-06-21",
      inboundAt: "2026-06-23",
      merchantReleaseAt: "2026-07-08",
      transferDocNoticeAt: "2026-07-09",
      customerReleaseAt: "2026-07-10",
      pickupDetails: "提取一辆",
      outboundAt: "2026-07-12",
      outboundNoticeDeliveredAt: "2026-07-12",
      customerReceiptDeliveredAt: "2026-07-12",
      agentReceiptDeliveredAt: "2026-07-13",
      notes: "随车钥匙两把",
    });
    expect(result.success).toBe(true);
  });

  it("业务日期仅接受有效的 YYYY-MM-DD", () => {
    expect(vehicleInput.safeParse({ ...base, inboundAt: "2026-07-12" }).success).toBe(true);
    expect(vehicleInput.safeParse({ ...base, inboundAt: "2026-07-12T00:00:00.000Z" }).success).toBe(false);
    expect(vehicleInput.safeParse({ ...base, inboundAt: "2026-02-29" }).success).toBe(false);
    expect(vehicleInput.safeParse({ ...base, inboundAt: "2026-04-31" }).success).toBe(false);
  });

  it("拒绝早于入库日期的出库日期", () => {
    const result = vehicleInput.safeParse({
      ...base,
      inboundAt: "2026-07-12",
      outboundAt: "2026-07-11",
    });
    expect(result.success).toBe(false);
  });

  it("拒绝晚于实际出库日期的库存日期", () => {
    const result = vehicleInput.safeParse({
      ...base,
      inventoryAt: "2026-07-12",
      outboundAt: "2026-07-11",
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

  it("允许手工创建仅包含业务类型的空白车辆记录", () => {
    const result = vehicleInput.safeParse({
      type: "domestic",
      warehouseTimezone: "Asia/Shanghai",
      idempotencyKey: "manual-empty-001",
    });
    expect(result.success).toBe(true);
  });

  it("拒绝超长业务文本和幂等键", () => {
    expect(vehicleInput.safeParse({ ...base, notes: "x".repeat(5_001) }).success).toBe(false);
    expect(vehicleInput.safeParse({ ...base, idempotencyKey: "x".repeat(129) }).success).toBe(false);
  });
});

describe("系统时区", () => {
  it("以中国零点作为日历日期边界", () => {
    expect(chinaToday(new Date("2026-07-29T15:59:59.999Z"))).toBe("2026-07-29");
    expect(chinaToday(new Date("2026-07-29T16:00:00.000Z"))).toBe("2026-07-30");
  });

  it("在 Prisma 边界无损转换和增减日历日期", () => {
    expect(fromPrismaDate(toPrismaDate("2028-02-29"))).toBe("2028-02-29");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("统一按中国标准时间解释录入值", () => {
    const instant = zonedLocalToIso("2026-07-14T09:30", "Asia/Shanghai");
    expect(instant).toBe("2026-07-14T01:30:00.000Z");
    expect(localInputValue(instant, "Asia/Shanghai")).toBe("2026-07-14T09:30");
  });
});
