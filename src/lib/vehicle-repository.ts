import { EventType, VehicleStatus as PrismaVehicleStatus, type Prisma } from "@prisma/client";
import type { VehicleEventRecord, VehicleRecord, VehicleStatus as DomainVehicleStatus } from "./domain";
import { defaultWarehouseTimezone } from "./datetime";
import { prisma } from "./prisma";
import type { z } from "zod";
import type { vehiclePayload, vehicleUpdateInput } from "./validators";

export const vehicleInclude = {
  batch: true,
  customer: true,
  warehouse: true,
  events: {
    orderBy: { createdAt: "asc" as const },
    include: { actor: { select: { name: true } } },
  },
} satisfies Prisma.VehicleInclude;

export type VehicleWithRelations = Prisma.VehicleGetPayload<{ include: typeof vehicleInclude }>;
export type VehiclePayload = z.infer<typeof vehiclePayload>;
export type VehicleUpdatePayload = Omit<z.infer<typeof vehicleUpdateInput>, "id" | "version">;
export type MutationContext = { actorId?: string; ip?: string };

export class VersionConflictError extends Error {
  constructor() {
    super("车辆记录已被其他用户更新，请刷新后重试");
  }
}

const eventFieldMap = {
  inboundAt: "INBOUND",
  merchantReleaseAt: "MERCHANT_RELEASE",
  transferDocNoticeAt: "TRANSFER_DOC_NOTICE",
  customerReleaseAt: "CUSTOMER_RELEASE",
  outboundAt: "OUTBOUND",
  outboundNoticeDeliveredAt: "OUTBOUND_NOTICE_DELIVERED",
  customerReceiptDeliveredAt: "CUSTOMER_RECEIPT_DELIVERED",
  agentReceiptDeliveredAt: "AGENT_RECEIPT_DELIVERED",
} as const satisfies Record<string, EventType>;

const eventTitles: Record<EventType, string> = {
  CREATED: "创建车辆档案",
  INBOUND: "车辆入库",
  MERCHANT_RELEASE: "商社通知放车",
  TRANSFER_DOC_NOTICE: "客户通知做过户文件",
  CUSTOMER_RELEASE: "客户通知放车",
  PICKUP_CREATED: "创建提货任务",
  OUTBOUND: "车辆实际出库",
  DRIVER_SIGNED: "司机完成签收",
  RECEIPT_DELIVERED: "签收单已交付",
  OUTBOUND_NOTICE_DELIVERED: "出库通知单交付商社",
  CUSTOMER_RECEIPT_DELIVERED: "客户交付签收单",
  AGENT_RECEIPT_DELIVERED: "外代交付签收单给商社",
  CORRECTION: "资料更正",
  EXCEPTION: "标记异常",
};

const statusNames: Record<PrismaVehicleStatus, DomainVehicleStatus> = {
  PENDING_INBOUND: "待入库",
  IN_STOCK: "在库",
  PENDING_RELEASE: "待放车",
  PENDING_PICKUP: "待提货",
  OUTBOUND: "已出库",
  PENDING_RECEIPT: "待签收",
  COMPLETED: "已完成",
  EXCEPTION: "异常",
};

const statusCodes: Record<DomainVehicleStatus, PrismaVehicleStatus> = {
  "待入库": "PENDING_INBOUND",
  "在库": "IN_STOCK",
  "待放车": "PENDING_RELEASE",
  "待提货": "PENDING_PICKUP",
  "已出库": "OUTBOUND",
  "待签收": "PENDING_RECEIPT",
  "已完成": "COMPLETED",
  "异常": "EXCEPTION",
};

function jsonObject(value: Prisma.JsonValue | undefined) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
}

function eventPayload(event: VehicleWithRelations["events"][number]) {
  return jsonObject(event.payload);
}

function effectiveEventAt(vehicle: VehicleWithRelations, field: keyof typeof eventFieldMap) {
  const type = eventFieldMap[field];
  let value: string | undefined;
  for (const event of vehicle.events) {
    if (event.type === type) value = event.occurredAt.toISOString();
    if (event.type === "CORRECTION") {
      const payload = eventPayload(event);
      if (payload.field === field && payload.eventType === type && payload.value === null) value = undefined;
    }
  }
  return value;
}

function eventHistory(vehicle: VehicleWithRelations): VehicleEventRecord[] {
  return vehicle.events.map(event => {
    const payload = eventPayload(event);
    const correctedType = typeof payload.eventType === "string" && payload.eventType in eventTitles
      ? payload.eventType as EventType
      : undefined;
    const cleared = event.type === "CORRECTION" && payload.value === null && correctedType;
    return {
      id: event.id,
      type: event.type,
      title: cleared ? `撤销：${eventTitles[correctedType]}` : eventTitles[event.type],
      occurredAt: event.occurredAt.toISOString(),
      recordedAt: event.createdAt.toISOString(),
      actor: event.actor?.name,
      correctionOfId: event.correctionOfId ?? undefined,
      reason: typeof payload.reason === "string" ? payload.reason : cleared ? "清空错误的业务时间" : undefined,
    };
  });
}

export function toVehicleRecord(vehicle: VehicleWithRelations): VehicleRecord {
  const type = vehicle.batch?.type === "DOMESTIC" ? "domestic" : "overseas";
  const extra = jsonObject(vehicle.extra);
  return {
    id: vehicle.id,
    version: vehicle.version,
    vin: vehicle.vin,
    model: vehicle.model,
    brand: vehicle.brand ?? undefined,
    type,
    referenceNo: vehicle.batch?.referenceNo ?? "",
    hsCode: vehicle.hsCode ?? undefined,
    portOfLoad: vehicle.batch?.portOfLoad ?? undefined,
    portOfDischarge: vehicle.batch?.portOfDischarge ?? undefined,
    vesselVoyage: vehicle.batch?.vesselVoyage ?? undefined,
    etd: vehicle.batch?.etd?.toISOString(),
    eta: vehicle.batch?.eta?.toISOString(),
    manufacturer: vehicle.batch?.manufacturer ?? undefined,
    warehouseLocation: vehicle.warehouse?.location ?? "",
    warehouse: vehicle.warehouse?.name ?? "",
    warehouseTimezone: typeof extra.warehouseTimezone === "string" ? extra.warehouseTimezone : defaultWarehouseTimezone(type),
    customer: vehicle.customer?.name ?? "",
    status: statusNames[vehicle.status] ?? "待入库",
    inboundAt: vehicle.inboundAt?.toISOString(),
    merchantReleaseAt: effectiveEventAt(vehicle, "merchantReleaseAt"),
    transferDocNoticeAt: effectiveEventAt(vehicle, "transferDocNoticeAt"),
    customerReleaseAt: effectiveEventAt(vehicle, "customerReleaseAt"),
    pickupDetails: vehicle.pickupDetails ?? undefined,
    outboundAt: vehicle.outboundAt?.toISOString(),
    outboundNoticeDeliveredAt: effectiveEventAt(vehicle, "outboundNoticeDeliveredAt"),
    customerReceiptDeliveredAt: effectiveEventAt(vehicle, "customerReceiptDeliveredAt"),
    agentReceiptDeliveredAt: effectiveEventAt(vehicle, "agentReceiptDeliveredAt"),
    updatedAt: vehicle.updatedAt.toISOString(),
    notes: vehicle.notes ?? undefined,
    history: eventHistory(vehicle),
  };
}

function prismaStatus(data: VehiclePayload): PrismaVehicleStatus {
  if (data.agentReceiptDeliveredAt || data.customerReceiptDeliveredAt) return "COMPLETED";
  if (data.outboundAt) return "PENDING_RECEIPT";
  if (data.customerReleaseAt || data.pickupDetails) return "PENDING_PICKUP";
  if (data.merchantReleaseAt) return "PENDING_RELEASE";
  if (data.inboundAt) return "IN_STOCK";
  return "PENDING_INBOUND";
}

async function upsertRelations(tx: Prisma.TransactionClient, data: VehiclePayload) {
  const type = data.type === "overseas" ? "OVERSEAS" : "DOMESTIC";
  const [batch, customer, warehouse] = await Promise.all([
    tx.businessBatch.upsert({
      where: { type_referenceNo: { type, referenceNo: data.referenceNo } },
      create: {
        type,
        referenceNo: data.referenceNo,
        portOfLoad: data.portOfLoad,
        portOfDischarge: data.portOfDischarge,
        vesselVoyage: data.vesselVoyage,
        etd: data.etd ? new Date(data.etd) : undefined,
        eta: data.eta ? new Date(data.eta) : undefined,
        manufacturer: data.manufacturer,
      },
      update: {
        portOfLoad: data.portOfLoad ?? null,
        portOfDischarge: data.portOfDischarge ?? null,
        vesselVoyage: data.vesselVoyage ?? null,
        etd: data.etd ? new Date(data.etd) : null,
        eta: data.eta ? new Date(data.eta) : null,
        manufacturer: data.manufacturer ?? null,
      },
    }),
    tx.customer.upsert({ where: { name: data.customer }, create: { name: data.customer }, update: {} }),
    tx.warehouse.upsert({
      where: { name_location: { name: data.warehouse, location: data.warehouseLocation } },
      create: { name: data.warehouse, location: data.warehouseLocation, bonded: data.type === "overseas" },
      update: { bonded: data.type === "overseas" },
    }),
  ]);
  return { batch, customer, warehouse };
}

function datedEvents(data: VehiclePayload, actorId?: string) {
  return (Object.entries(eventFieldMap) as [keyof typeof eventFieldMap, EventType][])
    .flatMap(([field, type]) => data[field] ? [{ type, occurredAt: new Date(data[field]!), actorId }] : []);
}

function auditSnapshot(record: VehicleRecord): Prisma.InputJsonValue {
  const snapshot = { ...record };
  delete snapshot.history;
  return JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;
}

export async function createVehicle(data: VehiclePayload, idempotencyKey: string, context: MutationContext = {}) {
  return prisma.$transaction(async tx => {
    const previous = await tx.inventoryEvent.findUnique({
      where: { idempotencyKey },
      include: { vehicle: { include: vehicleInclude } },
    });
    if (previous) return previous.vehicle;

    const { batch, customer, warehouse } = await upsertRelations(tx, data);
    const vehicle = await tx.vehicle.create({
      data: {
        vin: data.vin,
        model: data.model,
        brand: data.brand,
        hsCode: data.hsCode,
        status: prismaStatus(data),
        inboundAt: data.inboundAt ? new Date(data.inboundAt) : undefined,
        outboundAt: data.outboundAt ? new Date(data.outboundAt) : undefined,
        pickupDetails: data.pickupDetails,
        notes: data.notes,
        extra: { warehouseTimezone: data.warehouseTimezone },
        batchId: batch.id,
        customerId: customer.id,
        warehouseId: warehouse.id,
      },
    });
    await tx.inventoryEvent.create({
      data: { vehicleId: vehicle.id, type: "CREATED", occurredAt: new Date(), idempotencyKey, actorId: context.actorId },
    });
    const events = datedEvents(data, context.actorId);
    if (events.length) await tx.inventoryEvent.createMany({ data: events.map(event => ({ ...event, vehicleId: vehicle.id })) });
    const created = await tx.vehicle.findUniqueOrThrow({ where: { id: vehicle.id }, include: vehicleInclude });
    await tx.auditLog.create({
      data: { actorId: context.actorId, action: "VEHICLE_CREATED", entityType: "Vehicle", entityId: vehicle.id, after: auditSnapshot(toVehicleRecord(created)), ip: context.ip },
    });
    return created;
  });
}

function sameDate(left?: string, right?: string) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return new Date(left).getTime() === new Date(right).getTime();
}

async function appendDateCorrections(tx: Prisma.TransactionClient, existing: VehicleWithRelations, data: VehicleUpdatePayload, context: MutationContext) {
  for (const [field, type] of Object.entries(eventFieldMap) as [keyof typeof eventFieldMap, EventType][]) {
    const previous = field === "inboundAt" ? existing.inboundAt?.toISOString()
      : field === "outboundAt" ? existing.outboundAt?.toISOString()
        : effectiveEventAt(existing, field);
    const next = data[field];
    if (sameDate(previous, next)) continue;
    const corrected = [...existing.events].reverse().find(event => event.type === type);
    if (next) {
      await tx.inventoryEvent.create({
        data: {
          vehicleId: existing.id,
          type,
          occurredAt: new Date(next),
          correctionOfId: corrected?.id,
          actorId: context.actorId,
          payload: { source: "record-edit", field, previousValue: previous ?? null },
        },
      });
    } else if (previous) {
      await tx.inventoryEvent.create({
        data: {
          vehicleId: existing.id,
          type: "CORRECTION",
          occurredAt: new Date(),
          correctionOfId: corrected?.id,
          actorId: context.actorId,
          payload: { source: "record-edit", field, eventType: type, value: null, previousValue: previous },
        },
      });
    }
  }
}

export async function updateVehicle(id: string, expectedVersion: number, data: VehicleUpdatePayload, context: MutationContext = {}) {
  return prisma.$transaction(async tx => {
    const existing = await tx.vehicle.findUniqueOrThrow({ where: { id }, include: vehicleInclude });
    if (existing.version !== expectedVersion) throw new VersionConflictError();
    const before = toVehicleRecord(existing);
    const { batch, customer, warehouse } = await upsertRelations(tx, data);
    const nextStatus = data.status ? statusCodes[data.status] : existing.status;
    const extra = { ...jsonObject(existing.extra), warehouseTimezone: data.warehouseTimezone } as Prisma.InputJsonObject;
    const result = await tx.vehicle.updateMany({
      where: { id, version: expectedVersion },
      data: {
        vin: data.vin,
        model: data.model,
        brand: data.brand ?? null,
        hsCode: data.hsCode ?? null,
        status: nextStatus,
        inboundAt: data.inboundAt ? new Date(data.inboundAt) : null,
        outboundAt: data.outboundAt ? new Date(data.outboundAt) : null,
        pickupDetails: data.pickupDetails ?? null,
        notes: data.notes ?? null,
        extra,
        batchId: batch.id,
        customerId: customer.id,
        warehouseId: warehouse.id,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new VersionConflictError();

    await appendDateCorrections(tx, existing, data, context);
    if (existing.status !== nextStatus) {
      await tx.inventoryEvent.create({
        data: {
          vehicleId: id,
          type: nextStatus === "EXCEPTION" ? "EXCEPTION" : "CORRECTION",
          occurredAt: new Date(),
          actorId: context.actorId,
          payload: { source: "status-edit", field: "status", from: statusNames[existing.status], to: statusNames[nextStatus], reason: data.statusReason! },
        },
      });
    }
    const updated = await tx.vehicle.findUniqueOrThrow({ where: { id }, include: vehicleInclude });
    await tx.auditLog.create({
      data: {
        actorId: context.actorId,
        action: "VEHICLE_UPDATED",
        entityType: "Vehicle",
        entityId: id,
        before: auditSnapshot(before),
        after: auditSnapshot(toVehicleRecord(updated)),
        reason: data.statusReason,
        ip: context.ip,
      },
    });
    return updated;
  });
}

export async function listVehicles({ id, q }: { id?: string; q?: string } = {}) {
  return prisma.vehicle.findMany({
    where: {
      ...(id ? { id } : {}),
      ...(q ? {
        OR: [
          { vin: { contains: q, mode: "insensitive" as const } },
          { model: { contains: q, mode: "insensitive" as const } },
          { batch: { referenceNo: { contains: q, mode: "insensitive" as const } } },
          { customer: { name: { contains: q, mode: "insensitive" as const } } },
        ],
      } : {}),
    },
    include: vehicleInclude,
    orderBy: { updatedAt: "desc" },
  });
}
