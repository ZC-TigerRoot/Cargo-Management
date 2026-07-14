import { describe, expect, it } from "vitest";
import { can, inventoryDays, transitions } from "../src/lib/domain";
describe("库存领域规则",()=>{it("出库后库存天数固定",()=>expect(inventoryDays("2026-07-01T00:00:00Z","2026-07-11T00:00:00Z",new Date("2026-08-01"))).toBe(10));it("在库天数按当前时间计算",()=>expect(inventoryDays("2026-07-01T00:00:00Z",undefined,new Date("2026-07-03T00:00:00Z"))).toBe(2));it("只允许操作管理导出",()=>{expect(can("operator","export")).toBe(true);expect(can("warehouse","export")).toBe(false);expect(can("viewer","export")).toBe(false)});it("事件推导状态",()=>expect(transitions.DRIVER_SIGNED).toBe("已完成"))});

