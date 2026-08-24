import type { z } from "zod";
import { toPrismaDate } from "./datetime";
import type { vehiclePayload } from "./validators";

type VehiclePayload = z.infer<typeof vehiclePayload>;

function dateOrNull(value: string | undefined) {
  return value ? toPrismaDate(value) : null;
}

/**
 * Normalize form values to the nullable scalar representation used by Prisma.
 * Using null consistently is important for updates: Prisma intentionally ignores
 * undefined, which would otherwise make an optional field impossible to clear.
 */
export function vehicleScalarData(data: VehiclePayload) {
  return {
    vin: data.vin ?? null,
    model: data.model ?? null,
    brand: data.brand ?? null,
    hsCode: data.hsCode ?? null,
    inboundAt: dateOrNull(data.inboundAt),
    inventoryDays: data.inventoryDays ?? null,
    inboundAmount: data.inboundAmount ?? null,
    inboundBoeNo: data.inboundBoeNo ?? null,
    outboundAt: dateOrNull(data.outboundAt),
    outboundBoeNo: data.outboundBoeNo ?? null,
    outboundBoeTitle: data.outboundBoeTitle ?? null,
    outboundAmount: data.outboundAmount ?? null,
    pickupDetails: data.pickupDetails ?? null,
    notes: data.notes ?? null,
  };
}
