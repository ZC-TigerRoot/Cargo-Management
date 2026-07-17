import type { VehicleStatus as PrismaVehicleStatus } from "@prisma/client";
import type { VehicleStatus as DomainVehicleStatus } from "./domain";

export const vehicleStatusNames: Record<PrismaVehicleStatus, DomainVehicleStatus> = {
  PENDING_INBOUND: "待入库",
  IN_STOCK: "在库",
  PENDING_RELEASE: "待放车",
  PENDING_PICKUP: "待提货",
  OUTBOUND: "已出库",
  PENDING_RECEIPT: "待签收",
  COMPLETED: "已完成",
  EXCEPTION: "异常",
};

export const vehicleStatusCodes: Record<DomainVehicleStatus, PrismaVehicleStatus> = {
  "待入库": "PENDING_INBOUND",
  "在库": "IN_STOCK",
  "待放车": "PENDING_RELEASE",
  "待提货": "PENDING_PICKUP",
  "已出库": "OUTBOUND",
  "待签收": "PENDING_RECEIPT",
  "已完成": "COMPLETED",
  "异常": "EXCEPTION",
};
