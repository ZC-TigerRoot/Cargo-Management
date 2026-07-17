import type { EventType, Prisma, VehicleStatus as PrismaVehicleStatus } from "@prisma/client";
import type { VehicleAuditRecord, VehicleEventRecord, VehicleRecord } from "./domain";
import { CHINA_TIME_ZONE } from "./datetime";
import { prisma } from "./prisma";
import { vehicleScalarData } from "./vehicle-persistence";
import { vehicleStatusCodes, vehicleStatusNames } from "./vehicle-status";
import type { z } from "zod";
import type { vehiclePayload, vehicleUpdateInput } from "./validators";

export const vehicleInclude = {
  batch: true,
  customer: true,
  warehouse: true,
  events: {
    orderBy: { createdAt: "asc" as const },
    include: {
      actor: { select: { name: true } },
      attachments: { select: { id: true, fileName: true, mimeType: true, size: true } },
    },
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

function jsonObject(value: Prisma.JsonValue | undefined) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
}

function extraText(value: Prisma.JsonValue | undefined, key: string) {
  const candidate = jsonObject(value)[key];
  return typeof candidate === "string" && candidate ? candidate : undefined;
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
      actor: event.actor?.name ?? (typeof payload.actorLabel === "string" ? payload.actorLabel : undefined),
      correctionOfId: event.correctionOfId ?? undefined,
      reason: typeof payload.reason === "string" ? payload.reason : cleared ? "清空错误的业务时间" : undefined,
      details: [
        typeof payload.driverLabel === "string" ? { label: "司机名称", value: payload.driverLabel } : undefined,
        typeof payload.driverName === "string" ? { label: "姓名", value: payload.driverName } : undefined,
        typeof payload.driverPhone === "string" ? { label: "联系电话", value: payload.driverPhone } : undefined,
      ].filter((item): item is { label: string; value: string } => Boolean(item)),
      attachments: event.attachments.map(attachment => ({
        ...attachment,
        url: `/api/v1/attachments/${encodeURIComponent(attachment.id)}`,
      })),
    };
  });
}

export function toVehicleRecord(vehicle: VehicleWithRelations): VehicleRecord {
  const type = vehicle.batch?.type === "DOMESTIC" || extraText(vehicle.extra, "businessType") === "domestic" ? "domestic" : "overseas";
  return {
    id: vehicle.id,
    version: vehicle.version,
    vin: vehicle.vin ?? undefined,
    model: vehicle.model ?? undefined,
    brand: vehicle.brand ?? undefined,
    type,
    referenceNo: vehicle.batch?.referenceNo ?? extraText(vehicle.extra, "referenceNo"),
    hsCode: vehicle.hsCode ?? undefined,
    portOfLoad: vehicle.batch?.portOfLoad ?? extraText(vehicle.extra, "portOfLoad"),
    portOfDischarge: vehicle.batch?.portOfDischarge ?? extraText(vehicle.extra, "portOfDischarge"),
    vesselVoyage: vehicle.batch?.vesselVoyage ?? extraText(vehicle.extra, "vesselVoyage"),
    etd: vehicle.batch?.etd?.toISOString() ?? extraText(vehicle.extra, "etd"),
    eta: vehicle.batch?.eta?.toISOString() ?? extraText(vehicle.extra, "eta"),
    manufacturer: vehicle.batch?.manufacturer ?? extraText(vehicle.extra, "manufacturer"),
    warehouseLocation: vehicle.warehouse?.location ?? extraText(vehicle.extra, "warehouseLocation"),
    warehouse: vehicle.warehouse?.name ?? extraText(vehicle.extra, "warehouse"),
    warehouseTimezone: CHINA_TIME_ZONE,
    customer: vehicle.customer?.name ?? undefined,
    status: vehicleStatusNames[vehicle.status],
    inboundAt: vehicle.inboundAt?.toISOString(),
    inboundAmount: vehicle.inboundAmount?.toFixed(2),
    inboundBoeNo: vehicle.inboundBoeNo ?? undefined,
    merchantReleaseAt: effectiveEventAt(vehicle, "merchantReleaseAt"),
    transferDocNoticeAt: effectiveEventAt(vehicle, "transferDocNoticeAt"),
    customerReleaseAt: effectiveEventAt(vehicle, "customerReleaseAt"),
    pickupDetails: vehicle.pickupDetails ?? undefined,
    outboundAt: vehicle.outboundAt?.toISOString(),
    outboundBoeNo: vehicle.outboundBoeNo ?? undefined,
    outboundBoeTitle: vehicle.outboundBoeTitle ?? undefined,
    outboundAmount: vehicle.outboundAmount?.toFixed(2),
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

async function upsertRelations(tx: Prisma.TransactionClient, data: VehiclePayload, context: MutationContext) {
  const type = data.type === "overseas" ? "OVERSEAS" : "DOMESTIC";
  const [batchBefore, customerBefore, warehouseBefore] = await Promise.all([
    data.referenceNo ? tx.businessBatch.findUnique({ where: { type_referenceNo: { type, referenceNo: data.referenceNo } } }) : null,
    data.customer ? tx.customer.findUnique({ where: { name: data.customer } }) : null,
    data.warehouse && data.warehouseLocation
      ? tx.warehouse.findUnique({ where: { name_location: { name: data.warehouse, location: data.warehouseLocation } } })
      : null,
  ]);
  const [batch, customer, warehouse] = await Promise.all([
    data.referenceNo ? tx.businessBatch.upsert({
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
    }) : null,
    data.customer ? tx.customer.upsert({ where: { name: data.customer }, create: { name: data.customer }, update: {} }) : null,
    data.warehouse && data.warehouseLocation ? tx.warehouse.upsert({
      where: { name_location: { name: data.warehouse, location: data.warehouseLocation } },
      create: { name: data.warehouse, location: data.warehouseLocation, bonded: data.type === "overseas" },
      update: { bonded: data.type === "overseas" },
    }) : null,
  ]);

  const batchSnapshot = (value: NonNullable<typeof batch>) => ({
    type: value.type,
    referenceNo: value.referenceNo,
    portOfLoad: value.portOfLoad,
    portOfDischarge: value.portOfDischarge,
    vesselVoyage: value.vesselVoyage,
    etd: value.etd?.toISOString() ?? null,
    eta: value.eta?.toISOString() ?? null,
    manufacturer: value.manufacturer,
  });
  const customerSnapshot = (value: NonNullable<typeof customer>) => ({ name: value.name });
  const warehouseSnapshot = (value: NonNullable<typeof warehouse>) => ({ name: value.name, location: value.location, bonded: value.bonded });
  const masterAudits = [
    batch ? { before: batchBefore ? batchSnapshot(batchBefore) : undefined, after: batchSnapshot(batch), entityType: "BusinessBatch", entityId: batch.id, action: batchBefore ? "BATCH_UPDATED" : "BATCH_CREATED" } : undefined,
    customer ? { before: customerBefore ? customerSnapshot(customerBefore) : undefined, after: customerSnapshot(customer), entityType: "Customer", entityId: customer.id, action: customerBefore ? "CUSTOMER_UPDATED" : "CUSTOMER_CREATED" } : undefined,
    warehouse ? { before: warehouseBefore ? warehouseSnapshot(warehouseBefore) : undefined, after: warehouseSnapshot(warehouse), entityType: "Warehouse", entityId: warehouse.id, action: warehouseBefore ? "WAREHOUSE_UPDATED" : "WAREHOUSE_CREATED" } : undefined,
  ].filter((audit): audit is NonNullable<typeof audit> => Boolean(audit))
    .filter(audit => !audit.before || JSON.stringify(audit.before) !== JSON.stringify(audit.after));
  for (const audit of masterAudits) {
    await tx.auditLog.create({
      data: {
        actorId: context.actorId,
        action: audit.action,
        entityType: audit.entityType,
        entityId: audit.entityId,
        before: audit.before,
        after: audit.after,
        ip: context.ip,
      },
    });
  }
  return { batch, customer, warehouse };
}

function vehicleExtra(data: VehiclePayload, previous?: Prisma.JsonValue): Prisma.InputJsonObject {
  return {
    ...jsonObject(previous),
    warehouseTimezone: CHINA_TIME_ZONE,
    businessType: data.type,
    referenceNo: data.referenceNo ?? null,
    portOfLoad: data.portOfLoad ?? null,
    portOfDischarge: data.portOfDischarge ?? null,
    vesselVoyage: data.vesselVoyage ?? null,
    etd: data.etd ?? null,
    eta: data.eta ?? null,
    manufacturer: data.manufacturer ?? null,
    warehouse: data.warehouse ?? null,
    warehouseLocation: data.warehouseLocation ?? null,
  };
}

function datedEvents(data: VehiclePayload, actorId?: string) {
  return (Object.entries(eventFieldMap) as [keyof typeof eventFieldMap, EventType][])
    .flatMap(([field, type]) => data[field] ? [{ type, occurredAt: new Date(data[field]!), actorId }] : []);
}

function auditSnapshot(record: VehicleRecord): Prisma.InputJsonValue {
  const snapshot = { ...record };
  delete snapshot.history;
  delete snapshot.auditTrail;
  return JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;
}

export async function createVehicle(data: VehiclePayload, idempotencyKey: string, context: MutationContext = {}) {
  return prisma.$transaction(async tx => {
    const previous = await tx.inventoryEvent.findUnique({
      where: { idempotencyKey },
      include: { vehicle: { include: vehicleInclude } },
    });
    if (previous) return previous.vehicle;

    const { batch, customer, warehouse } = await upsertRelations(tx, data, context);
    const vehicle = await tx.vehicle.create({
      data: {
        ...vehicleScalarData(data),
        status: prismaStatus(data),
        extra: vehicleExtra(data),
        batchId: batch?.id,
        customerId: customer?.id,
        warehouseId: warehouse?.id,
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
    const { batch, customer, warehouse } = await upsertRelations(tx, data, context);
    const nextStatus = data.status ? vehicleStatusCodes[data.status] : existing.status;
    const extra = vehicleExtra(data, existing.extra);
    const result = await tx.vehicle.updateMany({
      where: { id, version: expectedVersion },
      data: {
        ...vehicleScalarData(data),
        status: nextStatus,
        extra,
        batchId: batch?.id ?? null,
        customerId: customer?.id ?? null,
        warehouseId: warehouse?.id ?? null,
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
          payload: { source: "status-edit", field: "status", from: vehicleStatusNames[existing.status], to: vehicleStatusNames[nextStatus], reason: data.statusReason! },
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

async function deleteVehicleInTransaction(tx: Prisma.TransactionClient, id: string, context: MutationContext) {
  const existing = await tx.vehicle.findUniqueOrThrow({ where: { id }, include: vehicleInclude });
  const [attachments, pickupItems] = await Promise.all([
    tx.attachment.findMany({
      where: { OR: [{ vehicleId: id }, { inventoryEvent: { vehicleId: id } }] },
      select: { objectKey: true },
    }),
    tx.pickupItem.findMany({ where: { vehicleId: id }, select: { pickupTaskId: true } }),
  ]);
  await tx.attachment.deleteMany({ where: { OR: [{ vehicleId: id }, { inventoryEvent: { vehicleId: id } }] } });
  await tx.pickupItem.deleteMany({ where: { vehicleId: id } });
  await tx.inventoryEvent.deleteMany({ where: { vehicleId: id } });
  await tx.vehicle.delete({ where: { id } });
  const taskIds = [...new Set(pickupItems.map(item => item.pickupTaskId))];
  if (taskIds.length) await tx.pickupTask.deleteMany({ where: { id: { in: taskIds }, items: { none: {} } } });
  await tx.auditLog.create({
    data: {
      actorId: context.actorId,
      action: "VEHICLE_DELETED",
      entityType: "Vehicle",
      entityId: id,
      before: auditSnapshot(toVehicleRecord(existing)),
      ip: context.ip,
    },
  });
  return { record: toVehicleRecord(existing), objectKeys: [...new Set(attachments.map(item => item.objectKey))] };
}

export async function deleteVehicle(id: string, context: MutationContext = {}) {
  return prisma.$transaction(tx => deleteVehicleInTransaction(tx, id, context));
}

export async function deleteVehicles(ids: string[], context: MutationContext = {}) {
  return prisma.$transaction(async tx => {
    const deleted = [];
    for (const id of ids) deleted.push(await deleteVehicleInTransaction(tx, id, context));
    return deleted;
  });
}

export async function listVehicles({ id, q, scope }: { id?: string; q?: string; scope?: Prisma.VehicleWhereInput } = {}) {
  return prisma.vehicle.findMany({
    where: {
      ...scope,
      ...(id ? { id } : {}),
      ...(q ? {
        OR: [
          { vin: { contains: q, mode: "insensitive" as const } },
          { model: { contains: q, mode: "insensitive" as const } },
          { inboundBoeNo: { contains: q, mode: "insensitive" as const } },
          { outboundBoeNo: { contains: q, mode: "insensitive" as const } },
          { outboundBoeTitle: { contains: q, mode: "insensitive" as const } },
          { batch: { referenceNo: { contains: q, mode: "insensitive" as const } } },
          { customer: { name: { contains: q, mode: "insensitive" as const } } },
          { warehouse: { name: { contains: q, mode: "insensitive" as const } } },
        ],
      } : {}),
    },
    include: vehicleInclude,
    orderBy: { updatedAt: "desc" },
  });
}

const auditFieldLabels: Record<string, string> = {
  vin: "车架号",
  model: "车型",
  brand: "品牌",
  type: "业务类型",
  referenceNo: "提单号 / PO#",
  hsCode: "HS#",
  portOfLoad: "起运港",
  portOfDischarge: "目的港",
  vesselVoyage: "船名航次",
  etd: "ETD",
  eta: "ETA",
  manufacturer: "生产商",
  warehouseLocation: "仓库地点",
  warehouse: "仓库",
  customer: "所属客户",
  status: "车辆状态",
  inboundAt: "入库时间",
  inboundAmount: "入库金额",
  inboundBoeNo: "入库 BOE 号",
  merchantReleaseAt: "商社通知放车时间",
  transferDocNoticeAt: "客户通知做过户文件时间",
  customerReleaseAt: "客户通知放车时间",
  pickupDetails: "出库提货明细",
  outboundAt: "实际出库时间",
  outboundBoeNo: "出库 BOE 号",
  outboundBoeTitle: "BOE 抬头",
  outboundAmount: "出库金额",
  outboundNoticeDeliveredAt: "出库通知单交付时间",
  customerReceiptDeliveredAt: "客户签收单交付时间",
  agentReceiptDeliveredAt: "外代签收单交付时间",
  notes: "备注",
};

function auditText(value: Prisma.JsonValue | undefined) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export async function listVehicleAuditTrail(vehicleId: string): Promise<VehicleAuditRecord[]> {
  const audits = await prisma.auditLog.findMany({
    where: { entityType: "Vehicle", entityId: vehicleId },
    include: { actor: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return audits.map(audit => {
    const before = jsonObject(audit.before ?? undefined);
    const after = jsonObject(audit.after ?? undefined);
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changes = [...keys]
      .filter(field => field in auditFieldLabels)
      .filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
      .map(field => ({
        field,
        label: auditFieldLabels[field],
        before: auditText(before[field]),
        after: auditText(after[field]),
      }));
    return {
      id: audit.id,
      action: audit.action === "VEHICLE_CREATED" ? "创建车辆档案"
        : audit.action === "PICKUP_CREATED" ? "创建提货任务并更新状态"
          : audit.action === "PICKUP_SIGNED" ? "司机签收并更新状态"
            : "修改车辆数据",
      actor: audit.actor?.name ?? audit.actorLabel ?? "系统",
      changedAt: audit.createdAt.toISOString(),
      changes,
    };
  });
}
