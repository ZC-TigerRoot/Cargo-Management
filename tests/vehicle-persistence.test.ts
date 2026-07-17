import { describe, expect, it } from "vitest";
import { vehicleScalarData } from "../src/lib/vehicle-persistence";
import { vehicleStatusCodes, vehicleStatusNames } from "../src/lib/vehicle-status";
import { vehiclePayload } from "../src/lib/validators";

describe("车辆持久化映射", () => {
  it("把缺省可选字段规范成 null，使编辑时可以清空字段", () => {
    const payload = vehiclePayload.parse({
      type: "domestic",
      warehouseTimezone: "Asia/Shanghai",
    });

    expect(vehicleScalarData(payload)).toEqual({
      vin: null,
      model: null,
      brand: null,
      hsCode: null,
      inboundAt: null,
      inboundAmount: null,
      inboundBoeNo: null,
      outboundAt: null,
      outboundBoeNo: null,
      outboundBoeTitle: null,
      outboundAmount: null,
      pickupDetails: null,
      notes: null,
    });
  });

  it("集中转换日期和标量字段，创建与更新共用同一规则", () => {
    const payload = vehiclePayload.parse({
      type: "overseas",
      warehouseTimezone: "Asia/Shanghai",
      vin: "test-vin-001",
      model: "测试车型",
      inboundAt: "2026-07-17T01:30:00.000Z",
      inboundAmount: "1200.50",
    });
    const data = vehicleScalarData(payload);

    expect(data.vin).toBe("TEST-VIN-001");
    expect(data.model).toBe("测试车型");
    expect(data.inboundAt?.toISOString()).toBe("2026-07-17T01:30:00.000Z");
    expect(data.inboundAmount).toBe("1200.50");
  });

  it("数据库状态码和中文领域状态保持双向一致", () => {
    for (const [code, name] of Object.entries(vehicleStatusNames)) {
      expect(vehicleStatusCodes[name]).toBe(code);
    }
  });
});
