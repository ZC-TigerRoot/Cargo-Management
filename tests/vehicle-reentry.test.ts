import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ prisma }));

import {
  reenterVehicles, toVehicleRecord, updateVehicle, updateVehicleFromImport, VehicleReentryError, VersionConflictError,
  type VehicleWithRelations,
} from "../src/lib/vehicle-repository";
import { inventoryDays } from "../src/lib/domain";
import { vehiclePayload } from "../src/lib/validators";
import { MAX_VEHICLE_NOTES_LENGTH } from "../src/lib/vehicle-notes";

function event(type: string, cycle = 1, payload = {}) {
  return {
    id: `${type}-${cycle}`, type, cycle, payload,
    occurredAt: new Date("2026-10-07T00:00:00.000Z"),
    createdAt: new Date("2026-10-07T00:00:00.000Z"),
    correctionOfId: null, actor: { name: "仓管" }, attachments: [],
  };
}

function vehicle(overrides: Record<string, unknown> = {}): VehicleWithRelations {
  return {
    id: "v1", vin: "VIN-1", version: 4, currentCycle: 1, updateSequence: BigInt(1),
    status: "COMPLETED", inboundAt: new Date("2026-10-01T00:00:00.000Z"),
    outboundAt: new Date("2026-10-07T00:00:00.000Z"), inventoryDays: 7,
    pickupDetails: "上一轮提货明细", notes: "原备注", model: "车型", brand: "品牌",
    extra: { businessType: "domestic" }, batch: null, customer: { name: "客户" },
    warehouse: { name: "国内仓", location: "上海" }, warehouseId: "wh1", batchId: "batch1",
    updatedAt: new Date("2026-10-07T00:00:00.000Z"),
    events: [
      event("INBOUND"), event("MERCHANT_RELEASE"), event("TRANSFER_DOC_NOTICE"),
      event("CUSTOMER_RELEASE"), event("OUTBOUND_NOTICE_DELIVERED"),
      event("CUSTOMER_RECEIPT_DELIVERED"), event("AGENT_RECEIPT_DELIVERED"),
      event("PICKUP_CREATED"),
      { ...event("DRIVER_SIGNED"), attachments: [{ id: "photo1", fileName: "签收照片.jpg", mimeType: "image/jpeg", size: 10 }] },
    ],
    ...overrides,
  } as unknown as VehicleWithRelations;
}

const input = { vehicles: [{ id: "v1", version: 4 }], inboundAt: "2026-10-21", reason: "整备完成返库" };

function transaction(existing: VehicleWithRelations[], changed = existing.map(item => vehicle({
  ...item, currentCycle: item.currentCycle + 1, version: item.version + 1,
  inboundAt: new Date("2026-10-21T00:00:00.000Z"), outboundAt: null, inventoryDays: null,
  pickupDetails: null, status: "IN_STOCK",
  events: [...item.events, event("INBOUND", item.currentCycle + 1, { source: "reentry", reason: input.reason })],
}))) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    vehicle: { findMany: vi.fn().mockResolvedValueOnce(existing).mockResolvedValueOnce(changed), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    inventoryEvent: { createMany: vi.fn().mockResolvedValue({ count: existing.length }) },
    auditLog: { createMany: vi.fn().mockResolvedValue({ count: existing.length }) },
  };
  prisma.$transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(tx));
  return tx;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T01:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("车辆批量再次入库", () => {
  it("新轮次清空当前业务日期，旧流程、签收照片和完整前后快照仍保留", async () => {
    const old = vehicle();
    const tx = transaction([old]);
    const [result] = await reenterVehicles(input, { actorId: "user1", ip: "127.0.0.1" }, { warehouseId: { in: ["wh1"] } });
    const record = toVehicleRecord(result);

    expect(record).toMatchObject({ currentCycle: 2, status: "在库", inboundAt: "2026-10-21", notes: "原备注", customer: "客户", warehouse: "国内仓" });
    for (const field of ["merchantReleaseAt", "transferDocNoticeAt", "customerReleaseAt", "outboundAt", "outboundNoticeDeliveredAt", "customerReceiptDeliveredAt", "agentReceiptDeliveredAt", "inventoryDays", "pickupDetails"] as const) {
      expect(record[field], field).toBeUndefined();
    }
    expect(inventoryDays(record.inboundAt, record.outboundAt, new Date("2026-10-23T00:00:00.000Z"), record.inventoryDays)).toBe(3);
    expect(record.history).toHaveLength(old.events.length + 1);
    expect(record.history?.find(item => item.type === "DRIVER_SIGNED")).toMatchObject({ cycle: 1, attachments: [{ id: "photo1", url: "/api/v1/attachments/photo1" }] });
    expect(record.history?.at(-1)).toMatchObject({ cycle: 2, title: "车辆再次入库", reason: input.reason });
    expect(tx.vehicle.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { AND: [{ id: { in: ["v1"] } }, { warehouseId: { in: ["wh1"] } }] } }));
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith({
      where: { id: "v1", version: 4, currentCycle: 1 },
      data: { currentCycle: { increment: 1 }, inboundAt: new Date("2026-10-21T00:00:00.000Z"), outboundAt: null, inventoryDays: null, pickupDetails: null, status: "IN_STOCK", version: { increment: 1 } },
    });
    expect(tx.inventoryEvent.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ cycle: 2, type: "INBOUND", payload: expect.objectContaining({ source: "reentry", previousCycle: 1, reason: input.reason }) })] });
    expect(tx.auditLog.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      action: "VEHICLE_REENTERED", actorId: "user1", reason: input.reason,
      before: expect.objectContaining({ currentCycle: 1, status: "已完成", outboundAt: "2026-10-07", customerReceiptDeliveredAt: "2026-10-07", inventoryDays: 7 }),
      after: expect.objectContaining({ currentCycle: 2, status: "在库", inboundAt: "2026-10-21" }),
    })] });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", timeout: 30_000 });
  });

  it("按车辆 ID 追加各自的新备注，返回累计备注并在审计和本轮事件保留记录", async () => {
    const existing = [vehicle({ id: "v2", notes: "第二车原备注" }), vehicle({ notes: "第一车原备注" })];
    const fragments: Record<string, string> = { v1: "第一车新备注", v2: "第二车新备注" };
    const expectedNotes: Record<string, string> = {
      v1: "第一车原备注\n\n【第 2 轮入库 · 2026-10-21】\n第一车新备注",
      v2: "第二车原备注\n\n【第 2 轮入库 · 2026-10-21】\n第二车新备注",
    };
    const updated = existing.map(item => vehicle({
      ...item, currentCycle: 2, version: 5, inboundAt: new Date("2026-10-21T00:00:00.000Z"),
      outboundAt: null, inventoryDays: null, pickupDetails: null, status: "IN_STOCK",
      notes: expectedNotes[item.id],
      events: [...item.events, event("INBOUND", 2, { source: "reentry", reason: input.reason, notes: fragments[item.id] })],
    }));
    const tx = transaction(existing, updated);
    const result = await reenterVehicles({
      ...input,
      vehicles: [{ id: "v1", version: 4, notes: "  第一车新备注  " }, { id: "v2", version: 4, notes: "第二车新备注" }],
    });

    expect(result.map(toVehicleRecord)).toMatchObject([
      { id: "v1", currentCycle: 2, notes: expectedNotes.v1 },
      { id: "v2", currentCycle: 2, notes: expectedNotes.v2 },
    ]);
    expect(tx.vehicle.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: "v1", version: 4, currentCycle: 1 }, data: expect.objectContaining({ notes: expectedNotes.v1 }),
    }));
    expect(tx.vehicle.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: "v2", version: 4, currentCycle: 1 }, data: expect.objectContaining({ notes: expectedNotes.v2 }),
    }));
    expect(tx.auditLog.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([
      expect.objectContaining({ entityId: "v1", before: expect.objectContaining({ notes: "第一车原备注" }), after: expect.objectContaining({ notes: expectedNotes.v1 }) }),
      expect.objectContaining({ entityId: "v2", before: expect.objectContaining({ notes: "第二车原备注" }), after: expect.objectContaining({ notes: expectedNotes.v2 }) }),
    ]) });
    expect(tx.inventoryEvent.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([
      expect.objectContaining({ vehicleId: "v1", cycle: 2, payload: expect.objectContaining({ notes: "第一车新备注" }) }),
      expect.objectContaining({ vehicleId: "v2", cycle: 2, payload: expect.objectContaining({ notes: "第二车新备注" }) }),
    ]) });
    expect(toVehicleRecord(result[0]).history?.at(-1)).toMatchObject({
      cycle: 2, title: "车辆再次入库", details: [{ label: "本轮备注", value: "第一车新备注" }],
    });
  });

  it.each([undefined, "", " \n \t "])("未提供非空新备注（%j）时保留原备注", async notes => {
    const tx = transaction([vehicle()]);
    const [result] = await reenterVehicles({ ...input, vehicles: [{ id: "v1", version: 4, ...(notes === undefined ? {} : { notes }) }] });

    expect(toVehicleRecord(result).notes).toBe("原备注");
    expect(tx.vehicle.updateMany.mock.calls[0][0].data).not.toHaveProperty("notes");
    expect(tx.auditLog.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      before: expect.objectContaining({ notes: "原备注" }), after: expect.objectContaining({ notes: "原备注" }),
    })] });
    expect(tx.inventoryEvent.createMany.mock.calls[0][0].data[0].payload).not.toHaveProperty("notes");
  });

  it("第三轮仍在之前两轮备注之后追加，即使本次文字与旧备注相同", async () => {
    const previousNotes = "相同备注\n\n【第 2 轮入库 · 2026-10-20】\n相同备注";
    const expectedNotes = `${previousNotes}\n\n【第 3 轮入库 · 2026-10-21】\n相同备注`;
    const old = vehicle({ currentCycle: 2, notes: previousNotes });
    const tx = transaction([old], [vehicle({ ...old, currentCycle: 3, version: 5, notes: expectedNotes })]);

    const [result] = await reenterVehicles({ ...input, vehicles: [{ ...input.vehicles[0], notes: "相同备注" }] });

    expect(toVehicleRecord(result).notes).toBe(expectedNotes);
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "v1", version: 4, currentCycle: 2 }, data: expect.objectContaining({ notes: expectedNotes }),
    }));
    expect(tx.inventoryEvent.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      cycle: 3, payload: expect.objectContaining({ previousCycle: 2, notes: "相同备注" }),
    })] });
  });

  it("允许累计备注含轮次标注后恰好达到 32767 字符，不截断任一段", async () => {
    const suffix = "\n\n【第 2 轮入库 · 2026-10-21】\n本轮备注";
    const previousNotes = "原".repeat(MAX_VEHICLE_NOTES_LENGTH - suffix.length);
    const expectedNotes = `${previousNotes}${suffix}`;
    const old = vehicle({ notes: previousNotes });
    const tx = transaction([old], [vehicle({ ...old, currentCycle: 2, notes: expectedNotes })]);

    const [result] = await reenterVehicles({ ...input, vehicles: [{ ...input.vehicles[0], notes: "本轮备注" }] });

    expect(toVehicleRecord(result).notes).toHaveLength(MAX_VEHICLE_NOTES_LENGTH);
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ notes: expectedNotes }) }));
  });

  it("后面的车辆累计备注超限时，在任何车辆写入之前整批拒绝", async () => {
    const suffix = "\n\n【第 2 轮入库 · 2026-10-21】\n超限的新备注";
    const tx = transaction([vehicle(), vehicle({ id: "v2", vin: "VIN-2", notes: "原".repeat(MAX_VEHICLE_NOTES_LENGTH - suffix.length + 1) })]);

    await expect(reenterVehicles({
      ...input, vehicles: [{ id: "v1", version: 4, notes: "可追加的新备注" }, { id: "v2", version: 4, notes: "超限的新备注" }],
    })).rejects.toMatchObject({ code: "NOTES_TOO_LONG", status: 422 });

    expect(tx.vehicle.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryEvent.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.createMany).not.toHaveBeenCalled();
  });

  it("本轮事件片段不随之后的累计备注修改而变化", () => {
    const originalEvent = event("INBOUND", 2, { source: "reentry", notes: "入库时录入的备注" });
    const edited = vehicle({ currentCycle: 2, notes: "之后人工整理的累计备注", events: [originalEvent] });

    expect(toVehicleRecord(edited)).toMatchObject({
      notes: "之后人工整理的累计备注",
      history: [{ details: [{ label: "本轮备注", value: "入库时录入的备注" }] }],
    });
  });

  it.each([
    event("INBOUND", 2, { source: "record-edit", notes: "普通事件资料" }),
    event("CORRECTION", 2, { source: "reentry", notes: "其他类型事件资料" }),
    event("INBOUND", 2, { source: "reentry", notes: " \n " }),
  ])("仅显示再次入库事件中的非空备注片段（%j）", entry => {
    expect(toVehicleRecord(vehicle({ events: [entry] })).history?.[0].details).toEqual([]);
  });

  it("任意车辆越权或不存在时整批拒绝，未开始写入", async () => {
    const tx = transaction([]);
    await expect(reenterVehicles(input, {}, { warehouseId: { in: [] } })).rejects.toMatchObject({ code: "VEHICLE_NOT_ACCESSIBLE", status: 403 });
    expect(tx.vehicle.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryEvent.createMany).not.toHaveBeenCalled();
  });

  it("先校验全部车辆再更新，后面的车辆版本冲突不会提前改动第一台", async () => {
    const tx = transaction([vehicle(), vehicle({ id: "v2", version: 5 })]);
    await expect(reenterVehicles({ ...input, vehicles: [{ ...input.vehicles[0], notes: "新备注" }, { id: "v2", version: 4, notes: "第二车新备注" }] })).rejects.toBeInstanceOf(VersionConflictError);
    expect(tx.vehicle.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.createMany).not.toHaveBeenCalled();
  });

  it.each(["IN_STOCK", "PENDING_INBOUND", "PENDING_PICKUP", "EXCEPTION"])("拒绝将 %s 车辆重复或越级返库", async status => {
    const tx = transaction([vehicle({ status })]);
    await expect(reenterVehicles(input)).rejects.toMatchObject({ code: "VEHICLE_NOT_AVAILABLE", status: 409 });
    expect(tx.vehicle.updateMany).not.toHaveBeenCalled();
  });

  it.each(["OUTBOUND", "PENDING_RECEIPT", "COMPLETED"])("允许 %s 车辆开启下一轮次", async status => {
    transaction([vehicle({ status })]);
    expect(await reenterVehicles(input)).toHaveLength(1);
  });

  it("拒绝早于上一轮出库的日期", async () => {
    const tx = transaction([vehicle()]);
    await expect(reenterVehicles({ ...input, inboundAt: "2026-10-06" })).rejects.toMatchObject({ code: "INVALID_INBOUND_DATE", status: 422 });
    expect(tx.vehicle.updateMany).not.toHaveBeenCalled();
  });

  it("上一轮仅司机签收而未填实际出库日期时，同样拒绝倒置的返库日期", async () => {
    const tx = transaction([vehicle({ outboundAt: null })]);
    await expect(reenterVehicles({ ...input, inboundAt: "2026-10-06" })).rejects.toMatchObject({ code: "INVALID_INBOUND_DATE", status: 422 });
    expect(tx.vehicle.updateMany).not.toHaveBeenCalled();
  });

  it("未来日期和重复选择在事务前拒绝", async () => {
    await expect(reenterVehicles({ ...input, inboundAt: "2026-10-22" })).rejects.toBeInstanceOf(VehicleReentryError);
    await expect(reenterVehicles({ ...input, vehicles: [...input.vehicles, ...input.vehicles] })).rejects.toBeInstanceOf(VehicleReentryError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("写入时并发冲突必须抛错退出事务，不能写成功审计", async () => {
    const tx = transaction([vehicle()]);
    tx.vehicle.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(reenterVehicles({ ...input, vehicles: [{ ...input.vehicles[0], notes: "新备注" }] })).rejects.toBeInstanceOf(VersionConflictError);
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "v1", version: 4, currentCycle: 1 }, data: expect.objectContaining({ notes: "原备注\n\n【第 2 轮入库 · 2026-10-21】\n新备注" }),
    }));
    expect(tx.inventoryEvent.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.createMany).not.toHaveBeenCalled();
  });

  it("序列化冲突转为版本冲突", async () => {
    prisma.$transaction.mockRejectedValueOnce({ code: "P2034" });
    await expect(reenterVehicles(input)).rejects.toBeInstanceOf(VersionConflictError);
  });

  it.each(["40001", "40P01"])("锁行时 PostgreSQL 冲突 %s 同样返回版本冲突", async code => {
    prisma.$transaction.mockRejectedValueOnce({ code: "P2010", meta: { code } });
    await expect(reenterVehicles(input)).rejects.toBeInstanceOf(VersionConflictError);
  });

  it("可反复返库，第三轮日期不受第二轮更正或第一轮签收影响", async () => {
    const old = vehicle({ currentCycle: 2, events: [...vehicle().events, event("MERCHANT_RELEASE", 2)] });
    transaction([old]);
    const [result] = await reenterVehicles(input);
    expect(toVehicleRecord(result)).toMatchObject({ currentCycle: 3, status: "在库", merchantReleaseAt: undefined });
  });
});

describe("返库后继续自动推进当前轮次", () => {
  it.each([false, true])("累计备注超过 5000 字符后仍能普通编辑或空白备注增量导入（导入：%s）", async fromImport => {
    const notes = "旧备注".repeat(2_000) + "\n\n【第 2 轮入库 · 2026-10-21】\n新备注";
    const existing = vehicle({
      currentCycle: 2, status: "IN_STOCK", inboundAt: new Date("2026-10-21T00:00:00.000Z"),
      outboundAt: null, pickupDetails: null, inventoryDays: null, customer: null, warehouse: null,
      notes, extra: { businessType: "domestic" },
    });
    const tx = {
      vehicle: { findUniqueOrThrow: vi.fn().mockResolvedValue(existing), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      inventoryEvent: { create: vi.fn() }, auditLog: { create: vi.fn() },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(tx));
    const data = vehiclePayload.parse({
      type: "domestic", warehouseTimezone: "Asia/Shanghai", inboundAt: "2026-10-21", merchantReleaseAt: "2026-10-21",
      ...(fromImport ? {} : { notes }),
    });

    await (fromImport ? updateVehicleFromImport : updateVehicle)("v1", 4, data);

    expect(tx.vehicle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ notes }) }));
  });

  it("旧司机签收和提货事件不影响本轮放车，新增业务事件绑定本轮", async () => {
    const existing = vehicle({ currentCycle: 2, status: "IN_STOCK", inboundAt: new Date("2026-10-21T00:00:00.000Z"), outboundAt: null, pickupDetails: null, inventoryDays: null });
    const updated = vehicle({ ...existing, status: "PENDING_RELEASE", version: 5 });
    const tx = {
      vehicle: { findUniqueOrThrow: vi.fn().mockResolvedValueOnce(existing).mockResolvedValueOnce(updated), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      inventoryEvent: { create: vi.fn() }, auditLog: { create: vi.fn() },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(tx));
    await updateVehicle("v1", 4, vehiclePayload.parse({ type: "domestic", warehouseTimezone: "Asia/Shanghai", inboundAt: "2026-10-21", merchantReleaseAt: "2026-10-21" }));
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING_RELEASE" }) }));
    expect(tx.inventoryEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ cycle: 2, type: "MERCHANT_RELEASE", correctionOfId: undefined }) });
  });

  it("普通增量导入只合并本轮资料，空白出库日期不恢复旧轮次数据", async () => {
    const existing = vehicle({ currentCycle: 2, status: "IN_STOCK", inboundAt: new Date("2026-10-21T00:00:00.000Z"), outboundAt: null, pickupDetails: null, inventoryDays: null, customer: null, warehouse: null, extra: { businessType: "domestic" } });
    const tx = {
      vehicle: { findUniqueOrThrow: vi.fn().mockResolvedValue(existing), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      inventoryEvent: { create: vi.fn() }, auditLog: { create: vi.fn() },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(tx));
    await updateVehicleFromImport("v1", 4, vehiclePayload.parse({ type: "domestic", warehouseTimezone: "Asia/Shanghai", merchantReleaseAt: "2026-10-21" }));
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING_RELEASE", inboundAt: new Date("2026-10-21T00:00:00.000Z"), outboundAt: null, inventoryDays: null, pickupDetails: null }) }));
    expect(tx.inventoryEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ cycle: 2, type: "MERCHANT_RELEASE", correctionOfId: undefined }) });
  });
});
