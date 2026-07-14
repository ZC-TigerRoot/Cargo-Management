import { EventType, VehicleStatus as PrismaVehicleStatus, type Prisma } from "@prisma/client";
import type { VehicleRecord, VehicleStatus as DomainVehicleStatus } from "./domain";
import { prisma } from "./prisma";
import type { z } from "zod";
import type { vehiclePayload, vehicleUpdateInput } from "./validators";

export const vehicleInclude = {
  batch: true,
  customer: true,
  warehouse: true,
  events: { orderBy: { occurredAt: "asc" as const } },
} satisfies Prisma.VehicleInclude;

export type VehicleWithRelations = Prisma.VehicleGetPayload<{ include: typeof vehicleInclude }>;
export type VehiclePayload = z.infer<typeof vehiclePayload>;
export type VehicleUpdatePayload = Omit<z.infer<typeof vehicleUpdateInput>, "id">;

const eventFieldMap = {
  merchantReleaseAt: "MERCHANT_RELEASE",
  transferDocNoticeAt: "TRANSFER_DOC_NOTICE",
  customerReleaseAt: "CUSTOMER_RELEASE",
  outboundNoticeDeliveredAt: "OUTBOUND_NOTICE_DELIVERED",
  customerReceiptDeliveredAt: "CUSTOMER_RECEIPT_DELIVERED",
  agentReceiptDeliveredAt: "AGENT_RECEIPT_DELIVERED",
} as const satisfies Record<string, EventType>;

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

const eventAt = (vehicle: VehicleWithRelations, type: string) =>
  [...vehicle.events].reverse().find(event => event.type === type)?.occurredAt.toISOString();

export function toVehicleRecord(vehicle: VehicleWithRelations): VehicleRecord {
  return {
    id: vehicle.id,
    vin: vehicle.vin,
    model: vehicle.model,
    brand: vehicle.brand ?? undefined,
    type: vehicle.batch?.type === "DOMESTIC" ? "domestic" : "overseas",
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
    customer: vehicle.customer?.name ?? "",
    status: statusNames[vehicle.status] ?? "待入库",
    inboundAt: vehicle.inboundAt?.toISOString(),
    merchantReleaseAt: eventAt(vehicle, "MERCHANT_RELEASE"),
    transferDocNoticeAt: eventAt(vehicle, "TRANSFER_DOC_NOTICE"),
    customerReleaseAt: eventAt(vehicle, "CUSTOMER_RELEASE"),
    pickupDetails: vehicle.pickupDetails ?? undefined,
    outboundAt: vehicle.outboundAt?.toISOString(),
    outboundNoticeDeliveredAt: eventAt(vehicle, "OUTBOUND_NOTICE_DELIVERED"),
    customerReceiptDeliveredAt: eventAt(vehicle, "CUSTOMER_RECEIPT_DELIVERED"),
    agentReceiptDeliveredAt: eventAt(vehicle, "AGENT_RECEIPT_DELIVERED"),
    updatedAt: vehicle.updatedAt.toISOString(),
    notes: vehicle.notes ?? undefined,
  };
}

function prismaStatus(data: VehiclePayload): PrismaVehicleStatus {
  if (data.agentReceiptDeliveredAt || data.customerReceiptDeliveredAt) return "COMPLETED" as const;
  if (data.outboundAt) return "PENDING_RECEIPT" as const;
  if (data.customerReleaseAt || data.pickupDetails) return "PENDING_PICKUP" as const;
  if (data.merchantReleaseAt) return "PENDING_RELEASE" as const;
  if (data.inboundAt) return "IN_STOCK" as const;
  return "PENDING_INBOUND" as const;
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
        portOfLoad: data.portOfLoad,
        portOfDischarge: data.portOfDischarge,
        vesselVoyage: data.vesselVoyage,
        etd: data.etd ? new Date(data.etd) : undefined,
        eta: data.eta ? new Date(data.eta) : undefined,
        manufacturer: data.manufacturer,
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

function datedEvents(data: VehiclePayload) {
  const events: { type: EventType; occurredAt: Date }[] = [];
  if (data.inboundAt) events.push({ type: "INBOUND", occurredAt: new Date(data.inboundAt) });
  for (const [field, type] of Object.entries(eventFieldMap) as [keyof typeof eventFieldMap, EventType][]) {
    const value = data[field];
    if (value) events.push({ type, occurredAt: new Date(value) });
  }
  if (data.outboundAt) events.push({ type: "OUTBOUND", occurredAt: new Date(data.outboundAt) });
  return events;
}

export async function createVehicle(data: VehiclePayload, idempotencyKey: string) {
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
        batchId: batch.id,
        customerId: customer.id,
        warehouseId: warehouse.id,
      },
    });
    await tx.inventoryEvent.create({
      data: { vehicleId: vehicle.id, type: "CREATED", occurredAt: new Date(), idempotencyKey },
    });
    const events = datedEvents(data);
    if (events.length) await tx.inventoryEvent.createMany({ data: events.map(event => ({ ...event, vehicleId: vehicle.id })) });
    return tx.vehicle.findUniqueOrThrow({ where: { id: vehicle.id }, include: vehicleInclude });
  });
}

export async function updateVehicle(id: string, data: VehicleUpdatePayload) {
  return prisma.$transaction(async tx => {
    const existing = await tx.vehicle.findUniqueOrThrow({ where: { id }, include: { events: true } });
    const { batch, customer, warehouse } = await upsertRelations(tx, data);
    const nextStatus = data.status ? statusCodes[data.status] : prismaStatus(data);
    await tx.vehicle.update({
      where: { id },
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
        batchId: batch.id,
        customerId: customer.id,
        warehouseId: warehouse.id,
        version: { increment: 1 },
      },
    });

    const latestByType = new Map<string, Date>();
    for (const event of existing.events) {
      const latest = latestByType.get(event.type);
      if (!latest || event.occurredAt > latest) latestByType.set(event.type, event.occurredAt);
    }
    const changedEvents = datedEvents(data).filter(event =>
      latestByType.get(event.type)?.getTime() !== event.occurredAt.getTime(),
    );
    if (changedEvents.length) {
      await tx.inventoryEvent.createMany({
        data: changedEvents.map(event => ({ ...event, vehicleId: id, payload: { source: "record-edit" } })),
      });
    }
    if (existing.status !== nextStatus) {
      await tx.inventoryEvent.create({
        data: {
          vehicleId: id,
          type: nextStatus === "EXCEPTION" ? "EXCEPTION" : "CORRECTION",
          occurredAt: new Date(),
          payload: {
            source: "status-edit",
            from: statusNames[existing.status],
            to: statusNames[nextStatus],
            reason: data.statusReason ?? null,
          },
        },
      });
    }
    return tx.vehicle.findUniqueOrThrow({ where: { id }, include: vehicleInclude });
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
