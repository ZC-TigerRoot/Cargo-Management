import { z } from "zod";
export const vehicleInput = z.object({
  vin: z.string().trim().length(17, "车架号必须为 17 位"),
  model: z.string().trim().min(1), type: z.enum(["overseas", "domestic"]),
  referenceNo: z.string().trim().min(1), customer: z.string().trim().min(1),
  warehouse: z.string().trim().min(1), idempotencyKey: z.string().min(8),
});
export const driverSubmission = z.object({
  name: z.string().trim().min(2), phone: z.string().trim().min(6), plateNo: z.string().trim().min(2),
  pickupAt: z.iso.datetime(), confirmed: z.literal(true), signature: z.string().min(1),
  idempotencyKey: z.string().min(8),
});

