import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  vehicle: { findMany: vi.fn() },
  auditLog: { findMany: vi.fn() },
}));

vi.mock("../src/lib/prisma", () => ({ prisma }));

import {
  businessBatchSnapshot,
  createVehicle,
  deleteVehicles,
  listVehicleAuditTrail,
  listVehicles,
  toVehicleRecord,
  updateVehicle,
  updateVehicleFromImport,
  VersionConflictError,
  type VehiclePayload,
  type VehicleUpdatePayload,
  type VehicleWithRelations,
} from "../src/lib/vehicle-repository";

function vehicle(overrides: Record<string, unknown> = {}): VehicleWithRelations {
  return {
    id: "vehicle-1",
    version: 1,
    updateSequence: BigInt(1),
    vin: "VIN-001",
    model: "测试车型",
    brand: null,
    hsCode: null,
    status: "IN_STOCK",
    inboundAt: null,
    inboundAmount: null,
    inboundBoeNo: null,
    outboundAt: null,
    outboundBoeNo: null,
    outboundBoeTitle: null,
    outboundAmount: null,
    pickupDetails: null,
    notes: null,
    extra: { businessType: "domestic", referenceNo: "PO-EXTRA", warehouse: "备用仓库", warehouseLocation: "上海" },
    batchId: null,
    customerId: null,
    warehouseId: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
    batch: null,
    customer: null,
    warehouse: null,
    events: [],
    ...overrides,
  } as unknown as VehicleWithRelations;
}

const minimalPayload = {
  type: "domestic",
  warehouseTimezone: "Asia/Shanghai",
} as VehiclePayload;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("车辆仓储映射与并发保护", () => {
  it("从关系和 extra 回退字段生成领域记录及附件时间线", () => {
    const record = toVehicleRecord(vehicle({
      status: "COMPLETED",
      batch: { type: "DOMESTIC", referenceNo: "PO-RELATION", portOfLoad: null, portOfDischarge: null, vesselVoyage: null, etd: null, eta: null, manufacturer: null },
      customer: { name: "测试客户" },
      warehouse: { name: "关系仓库", location: "宁波" },
      events: [
        {
          id: "event-1", type: "DRIVER_SIGNED", occurredAt: new Date("2026-07-03T01:00:00.000Z"), createdAt: new Date("2026-07-03T01:01:00.000Z"),
          actor: { name: "仓管员" }, correctionOfId: null,
          payload: { driverName: "张师傅", driverPhone: "13800138000" },
          attachments: [{ id: "attachment/1", fileName: "photo.jpg", mimeType: "image/jpeg", size: 123 }],
        },
      ],
    }));

    expect(record).toMatchObject({ type: "domestic", referenceNo: "PO-RELATION", customer: "测试客户", warehouse: "关系仓库", status: "已完成", updatedAt: "2026-07-02" });
    expect(record.history?.[0]).toMatchObject({
      title: "司机完成签收",
      occurredAt: "2026-07-03",
      recordedAt: "2026-07-03",
      actor: "仓管员",
      details: [{ label: "姓名", value: "张师傅" }, { label: "联系电话", value: "13800138000" }],
      attachments: [{ url: "/api/v1/attachments/attachment%2F1" }],
    });
  });

  it("清空业务日期后隐藏旧事件并保留撤销历史", () => {
    const record = toVehicleRecord(vehicle({
      events: [
        { id: "release", type: "MERCHANT_RELEASE", occurredAt: new Date("2026-07-03T00:00:00.000Z"), createdAt: new Date("2026-07-03T00:00:00.000Z"), actor: null, correctionOfId: null, payload: {}, attachments: [] },
        { id: "clear", type: "CORRECTION", occurredAt: new Date("2026-07-04T00:00:00.000Z"), createdAt: new Date("2026-07-04T00:00:00.000Z"), actor: null, correctionOfId: "release", payload: { field: "merchantReleaseAt", eventType: "MERCHANT_RELEASE", value: null }, attachments: [] },
      ],
    }));

    expect(record.merchantReleaseAt).toBeUndefined();
    expect(record.history?.[1]).toMatchObject({ title: "撤销：商社通知放车", reason: "清空错误的业务日期" });
  });

  it("把查询词和数据范围一起传入 Prisma", async () => {
    prisma.vehicle.findMany.mockResolvedValueOnce([]);
    await listVehicles({ q: "VIN-001", scope: { customerId: "customer-1" } });

    expect(prisma.vehicle.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        customerId: "customer-1",
        OR: expect.arrayContaining([{ vin: { contains: "VIN-001", mode: "insensitive" } }]),
      }),
      include: expect.objectContaining({
        events: expect.objectContaining({ orderBy: { recordSequence: "asc" } }),
      }),
      orderBy: { updateSequence: "desc" },
    }));
  });

  it("将审计快照转换成可读字段变更", async () => {
    prisma.auditLog.findMany.mockResolvedValueOnce([{ id: "audit-1", action: "VEHICLE_UPDATED", actor: { name: "管理员" }, actorLabel: null, createdAt: new Date("2026-07-04T00:00:00.000Z"), before: { vin: "OLD", notes: null, history: [] }, after: { vin: "NEW", notes: "已检查", history: ["ignored"] } }]);

    await expect(listVehicleAuditTrail("vehicle-1")).resolves.toEqual([expect.objectContaining({
      actor: "管理员",
      action: "修改车辆数据",
      changes: [
        { field: "vin", label: "车架号", before: "OLD", after: "NEW" },
        { field: "notes", label: "备注", before: undefined, after: "已检查" },
      ],
    })]);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { recordSequence: "asc" },
    }));
  });

  it("重复创建请求直接返回已有车辆", async () => {
    const existing = vehicle();
    const tx = { inventoryEvent: { findUnique: vi.fn().mockResolvedValue({ vehicle: existing }) } };
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    await expect(createVehicle(minimalPayload, "request-001")).resolves.toBe(existing);
  });

  it("新建车辆会写入创建事件和审计", async () => {
    const created = vehicle();
    const tx = {
      inventoryEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), createMany: vi.fn() },
      vehicle: { create: vi.fn().mockResolvedValue({ id: "vehicle-1" }), findUniqueOrThrow: vi.fn().mockResolvedValue(created) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    await expect(createVehicle(minimalPayload, "request-002", { actorId: "user-1", ip: "203.0.113.8" })).resolves.toBe(created);
    expect(tx.inventoryEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ vehicleId: "vehicle-1", type: "CREATED", idempotencyKey: "request-002", actorId: "user-1" }) });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "VEHICLE_CREATED", entityId: "vehicle-1", ip: "203.0.113.8" }) });
  });

  it("关联不同业务类型的车辆时不改写既有仓库的保税属性", async () => {
    const created = vehicle();
    const existingWarehouse = { id: "warehouse-1", name: "MAXX", location: "迪拜", bonded: true };
    const tx = {
      inventoryEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), createMany: vi.fn() },
      warehouse: {
        findUnique: vi.fn().mockResolvedValue(existingWarehouse),
        upsert: vi.fn().mockResolvedValue(existingWarehouse),
      },
      vehicle: { create: vi.fn().mockResolvedValue({ id: "vehicle-1" }), findUniqueOrThrow: vi.fn().mockResolvedValue(created) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    await createVehicle({
      ...minimalPayload,
      warehouse: "MAXX",
      warehouseLocation: "迪拜",
    }, "request-warehouse-master");

    expect(tx.warehouse.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ bonded: false }),
      update: {},
    }));
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("同一业务单号按目标仓库选择独立批次", async () => {
    const warehouse = { id: "warehouse-shanghai", name: "上海仓", location: "上海", bonded: false };
    const batch = {
      id: "batch-shanghai",
      type: "DOMESTIC" as const,
      referenceNo: "PO-SHARED",
      warehouseId: warehouse.id,
      warehouseKey: warehouse.id,
      portOfLoad: null,
      portOfDischarge: null,
      vesselVoyage: null,
      etd: null,
      eta: null,
      manufacturer: null,
    };
    const created = vehicle({ batch, batchId: batch.id, warehouse, warehouseId: warehouse.id });
    const tx = {
      inventoryEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), createMany: vi.fn() },
      warehouse: { findUnique: vi.fn().mockResolvedValue(warehouse), upsert: vi.fn().mockResolvedValue(warehouse) },
      businessBatch: { findUnique: vi.fn().mockResolvedValue(batch), upsert: vi.fn().mockResolvedValue(batch) },
      vehicle: { create: vi.fn().mockResolvedValue({ id: "vehicle-1" }), findUniqueOrThrow: vi.fn().mockResolvedValue(created) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    await createVehicle({
      ...minimalPayload,
      referenceNo: "PO-SHARED",
      warehouse: warehouse.name,
      warehouseLocation: warehouse.location,
    }, "request-warehouse-batch");

    const batchWhere = {
      type_referenceNo_warehouseKey: {
        type: "DOMESTIC",
        referenceNo: "PO-SHARED",
        warehouseKey: warehouse.id,
      },
    };
    expect(tx.businessBatch.findUnique).toHaveBeenCalledWith({ where: batchWhere });
    expect(tx.businessBatch.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: batchWhere,
      create: expect.objectContaining({ warehouseId: warehouse.id, warehouseKey: warehouse.id }),
    }));
  });

  it("创建时按出库通知单交付日期推断已出库", async () => {
    const created = vehicle({ status: "OUTBOUND" });
    const tx = {
      inventoryEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), createMany: vi.fn() },
      vehicle: { create: vi.fn().mockResolvedValue({ id: "vehicle-1" }), findUniqueOrThrow: vi.fn().mockResolvedValue(created) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    await createVehicle({
      ...minimalPayload,
      inboundAt: "2026-07-01",
      outboundNoticeDeliveredAt: "2026-07-05",
    }, "request-outbound-notice");

    expect(tx.vehicle.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "OUTBOUND" }) });
  });

  it("版本不匹配时拒绝更新且不写数据", async () => {
    const tx = { vehicle: { findUniqueOrThrow: vi.fn().mockResolvedValue(vehicle({ version: 2 })) } };
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    await expect(updateVehicle("vehicle-1", 1, minimalPayload as VehicleUpdatePayload)).rejects.toBeInstanceOf(VersionConflictError);
  });

  it("Excel 更新只覆盖有值字段并按合并后的数据推进状态", async () => {
    const existing = vehicle({
      status: "IN_STOCK",
      inboundAt: new Date("2026-07-01T00:00:00.000Z"),
      model: "原车型",
      notes: "原备注",
      extra: { businessType: "domestic" },
    });
    const updated = vehicle({ version: 2, status: "PENDING_RELEASE" });
    const tx = {
      vehicle: {
        findUniqueOrThrow: vi.fn().mockResolvedValueOnce(existing).mockResolvedValueOnce(updated),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryEvent: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    await expect(updateVehicleFromImport("vehicle-1", 1, {
      ...minimalPayload,
      merchantReleaseAt: "2026-07-03",
    })).resolves.toBe(updated);

    expect(tx.vehicle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        model: "原车型",
        notes: "原备注",
        inboundAt: new Date("2026-07-01T00:00:00.000Z"),
        status: "PENDING_RELEASE",
      }),
    }));
  });

  it("Excel 更新使用原值校验跨字段日期顺序", async () => {
    const existing = vehicle({
      status: "PENDING_RECEIPT",
      outboundAt: new Date("2026-07-05T00:00:00.000Z"),
      extra: { businessType: "domestic" },
    });
    const tx = { vehicle: { findUniqueOrThrow: vi.fn().mockResolvedValue(existing) } };
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    await expect(updateVehicleFromImport("vehicle-1", 1, {
      ...minimalPayload,
      inboundAt: "2026-07-10",
    })).rejects.toThrow("实际出库日期不能早于入库日期");
  });

  it("Excel 更新拒绝覆盖预校验后变化的共享批次", async () => {
    const existing = vehicle({
      extra: { businessType: "domestic" },
      batch: {
        id: "batch-1",
        type: "DOMESTIC",
        referenceNo: "PO-001",
        portOfLoad: null,
        portOfDischarge: null,
        vesselVoyage: null,
        etd: new Date("2026-07-01T00:00:00.000Z"),
        eta: null,
        manufacturer: null,
      },
    });
    const tx = {
      vehicle: { findUniqueOrThrow: vi.fn().mockResolvedValue(existing) },
      businessBatch: { findUnique: vi.fn().mockResolvedValue(existing.batch) },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    await expect(updateVehicleFromImport(
      "vehicle-1",
      1,
      { ...minimalPayload, referenceNo: "PO-001" },
      {},
      businessBatchSnapshot({ ...existing.batch!, etd: new Date("2026-06-30T00:00:00.000Z") }),
    )).rejects.toBeInstanceOf(VersionConflictError);
  });

  it("Excel 新增车辆时不以空白字段清空已有批次主数据", async () => {
    const existingBatch = {
      id: "batch-1",
      type: "DOMESTIC" as const,
      referenceNo: "PO-001",
      portOfLoad: null,
      portOfDischarge: null,
      vesselVoyage: null,
      etd: null,
      eta: null,
      manufacturer: "原生产商",
    };
    const created = vehicle({ batch: existingBatch });
    const tx = {
      inventoryEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), createMany: vi.fn() },
      businessBatch: {
        findUnique: vi.fn().mockResolvedValue(existingBatch),
        upsert: vi.fn().mockResolvedValue(existingBatch),
      },
      vehicle: { create: vi.fn().mockResolvedValue({ id: "vehicle-1" }), findUniqueOrThrow: vi.fn().mockResolvedValue(created) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    await createVehicle(
      { ...minimalPayload, referenceNo: "PO-001", vin: "VIN-NEW" },
      "excel:new-vehicle",
      {},
      businessBatchSnapshot(existingBatch),
    );

    expect(tx.businessBatch.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ manufacturer: undefined, etd: undefined, eta: undefined }),
    }));
  });

  it("数据库串行化冲突转换为车辆版本冲突", async () => {
    prisma.$transaction.mockRejectedValueOnce({ code: "P2034" });

    await expect(updateVehicle("vehicle-1", 1, minimalPayload)).rejects.toBeInstanceOf(VersionConflictError);
  });

  it("状态变更使用乐观锁并记录异常事件", async () => {
    const existing = vehicle({ version: 1, status: "IN_STOCK" });
    const updated = vehicle({ version: 2, status: "EXCEPTION" });
    const tx = {
      vehicle: {
        findUniqueOrThrow: vi.fn().mockResolvedValueOnce(existing).mockResolvedValueOnce(updated),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryEvent: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const data = { ...minimalPayload, status: "异常", statusReason: "发现车身划痕" } as VehicleUpdatePayload;
    await expect(updateVehicle("vehicle-1", 1, data, { actorId: "user-1" })).resolves.toBe(updated);
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "vehicle-1", version: 1 }, data: expect.objectContaining({ status: "EXCEPTION", version: { increment: 1 } }) }));
    expect(tx.inventoryEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "EXCEPTION", payload: expect.objectContaining({ from: "在库", to: "异常", reason: "发现车身划痕" }) }) });
  });

  function updateTx(existing: VehicleWithRelations, updated: VehicleWithRelations) {
    return {
      vehicle: {
        findUniqueOrThrow: vi.fn().mockResolvedValueOnce(existing).mockResolvedValueOnce(updated),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryEvent: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
  }

  it("补充业务日期时按规则自动推进状态", async () => {
    const existing = vehicle({ status: "IN_STOCK", inboundAt: new Date("2026-07-01T00:00:00.000Z") });
    const updated = vehicle({ version: 2, status: "PENDING_RELEASE" });
    const tx = updateTx(existing, updated);
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const data = { ...minimalPayload, inboundAt: "2026-07-01", merchantReleaseAt: "2026-07-03" } as VehicleUpdatePayload;
    await expect(updateVehicle("vehicle-1", 1, data)).resolves.toBe(updated);
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING_RELEASE" }) }));
    expect(tx.inventoryEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "CORRECTION", payload: expect.objectContaining({ source: "auto-infer", from: "在库", to: "待放车" }) }) });
  });

  it("人工标记的异常状态在补充数据时保持不变", async () => {
    const existing = vehicle({ status: "EXCEPTION", inboundAt: new Date("2026-07-01T00:00:00.000Z") });
    const updated = vehicle({ version: 2, status: "EXCEPTION" });
    const tx = updateTx(existing, updated);
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const data = { ...minimalPayload, inboundAt: "2026-07-01", merchantReleaseAt: "2026-07-03" } as VehicleUpdatePayload;
    await expect(updateVehicle("vehicle-1", 1, data)).resolves.toBe(updated);
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "EXCEPTION" }) }));
    expect(tx.inventoryEvent.create).not.toHaveBeenCalledWith({ data: expect.objectContaining({ payload: expect.objectContaining({ field: "status" }) }) });
  });

  it("司机签收后的已完成不被补充数据覆盖", async () => {
    const existing = vehicle({
      status: "COMPLETED",
      events: [
        { id: "signed", type: "DRIVER_SIGNED", occurredAt: new Date("2026-07-05T00:00:00.000Z"), createdAt: new Date("2026-07-05T00:01:00.000Z"), actor: null, correctionOfId: null, payload: {}, attachments: [] },
      ],
    });
    const updated = vehicle({ version: 2, status: "COMPLETED" });
    const tx = updateTx(existing, updated);
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const data = { ...minimalPayload, outboundAt: "2026-07-05" } as VehicleUpdatePayload;
    await expect(updateVehicle("vehicle-1", 1, data)).resolves.toBe(updated);
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }));
  });

  it("创建提货任务后补充实际出库日期自动推进到待签收", async () => {
    const existing = vehicle({
      status: "PENDING_PICKUP",
      inboundAt: new Date("2026-07-01T00:00:00.000Z"),
      events: [
        { id: "pickup", type: "PICKUP_CREATED", occurredAt: new Date("2026-07-02T00:00:00.000Z"), createdAt: new Date("2026-07-02T00:00:00.000Z"), actor: null, correctionOfId: null, payload: {}, attachments: [] },
      ],
    });
    const updated = vehicle({ version: 2, status: "PENDING_RECEIPT" });
    const tx = updateTx(existing, updated);
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const data = { ...minimalPayload, inboundAt: "2026-07-01", outboundAt: "2026-07-06" } as VehicleUpdatePayload;
    await expect(updateVehicle("vehicle-1", 1, data)).resolves.toBe(updated);
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING_RECEIPT" }) }));
    expect(tx.inventoryEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "CORRECTION", payload: expect.objectContaining({ source: "auto-infer", from: "待提货", to: "待签收" }) }) });
  });

  it("补充出库通知单交付日期自动推进到已出库", async () => {
    const existing = vehicle({
      status: "PENDING_PICKUP",
      inboundAt: new Date("2026-07-01T00:00:00.000Z"),
      events: [
        { id: "pickup", type: "PICKUP_CREATED", occurredAt: new Date("2026-07-02T00:00:00.000Z"), createdAt: new Date("2026-07-02T00:00:00.000Z"), actor: null, correctionOfId: null, payload: {}, attachments: [] },
      ],
    });
    const updated = vehicle({ version: 2, status: "OUTBOUND" });
    const tx = updateTx(existing, updated);
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const data = { ...minimalPayload, inboundAt: "2026-07-01", outboundNoticeDeliveredAt: "2026-07-05" } as VehicleUpdatePayload;
    await expect(updateVehicle("vehicle-1", 1, data)).resolves.toBe(updated);
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "OUTBOUND" }) }));
    expect(tx.inventoryEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "CORRECTION", payload: expect.objectContaining({ source: "auto-infer", from: "待提货", to: "已出库" }) }) });
  });

  it("实际出库后客户签收单未交付时保持待签收", async () => {
    const existing = vehicle({
      status: "OUTBOUND",
      inboundAt: new Date("2026-07-01T00:00:00.000Z"),
      events: [
        { id: "notice", type: "OUTBOUND_NOTICE_DELIVERED", occurredAt: new Date("2026-07-04T00:00:00.000Z"), createdAt: new Date("2026-07-04T00:00:00.000Z"), actor: null, correctionOfId: null, payload: {}, attachments: [] },
      ],
    });
    const updated = vehicle({ version: 2, status: "PENDING_RECEIPT" });
    const tx = updateTx(existing, updated);
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const data = {
      ...minimalPayload,
      inboundAt: "2026-07-01",
      outboundNoticeDeliveredAt: "2026-07-04",
      outboundAt: "2026-07-06",
    } as VehicleUpdatePayload;
    await expect(updateVehicle("vehicle-1", 1, data)).resolves.toBe(updated);
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING_RECEIPT" }) }));
    expect(tx.inventoryEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "CORRECTION", payload: expect.objectContaining({ source: "auto-infer", from: "已出库", to: "待签收" }) }) });
  });

  it("清空实际出库日期后状态随数据回退", async () => {
    const existing = vehicle({ status: "PENDING_RECEIPT", inboundAt: new Date("2026-07-01T00:00:00.000Z"), outboundAt: new Date("2026-07-04T00:00:00.000Z") });
    const updated = vehicle({ version: 2, status: "IN_STOCK" });
    const tx = updateTx(existing, updated);
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const data = { ...minimalPayload, inboundAt: "2026-07-01" } as VehicleUpdatePayload;
    await expect(updateVehicle("vehicle-1", 1, data)).resolves.toBe(updated);
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "IN_STOCK" }) }));
  });

  it("批量删除使用集合操作并为每辆车保留审计记录", async () => {
    const vehicles = [vehicle({ id: "vehicle-1" }), vehicle({ id: "vehicle-2", vin: "VIN-002" })];
    const tx = {
      vehicle: {
        findMany: vi.fn().mockResolvedValue(vehicles),
        findUniqueOrThrow: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      attachment: {
        findMany: vi.fn().mockResolvedValue([
          { objectKey: "vehicle-1/photo.jpg", vehicleId: "vehicle-1", inventoryEvent: null },
          { objectKey: "vehicle-2/photo.jpg", vehicleId: null, inventoryEvent: { vehicleId: "vehicle-2" } },
        ]),
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      pickupItem: {
        findMany: vi.fn().mockResolvedValue([{ pickupTaskId: "pickup-1" }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      pickupTask: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => callback(tx));

    await expect(deleteVehicles(["vehicle-1", "vehicle-2"], { actorId: "user-1" })).resolves.toEqual([
      expect.objectContaining({ record: expect.objectContaining({ id: "vehicle-1" }), objectKeys: ["vehicle-1/photo.jpg"] }),
      expect.objectContaining({ record: expect.objectContaining({ id: "vehicle-2" }), objectKeys: ["vehicle-2/photo.jpg"] }),
    ]);
    expect(tx.vehicle.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([
      expect.objectContaining({ action: "VEHICLE_DELETED", entityId: "vehicle-1", actorId: "user-1" }),
      expect.objectContaining({ action: "VEHICLE_DELETED", entityId: "vehicle-2", actorId: "user-1" }),
    ]) });
  });
});
