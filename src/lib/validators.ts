import { z } from "zod";
import { vehicleStatuses } from "./domain";

const optionalText = z.string().trim().optional().transform(value => value || undefined);
const optionalDateTime = z.iso.datetime({ offset: true }).optional();

export const vehiclePayload = z.object({
  vin: z.string().trim().length(17, "车架号必须为 17 位"),
  model: z.string().trim().min(1, "车型不能为空"),
  brand: optionalText,
  type: z.enum(["overseas", "domestic"]),
  referenceNo: z.string().trim().min(1, "提单号或 PO# 不能为空"),
  hsCode: optionalText,
  portOfLoad: optionalText,
  portOfDischarge: optionalText,
  vesselVoyage: optionalText,
  etd: optionalDateTime,
  eta: optionalDateTime,
  manufacturer: optionalText,
  warehouseLocation: z.string().trim().min(1, "仓库地点不能为空"),
  warehouse: z.string().trim().min(1, "入库仓库名称不能为空"),
  customer: z.string().trim().min(1, "所属客人不能为空"),
  inboundAt: optionalDateTime,
  merchantReleaseAt: optionalDateTime,
  transferDocNoticeAt: optionalDateTime,
  customerReleaseAt: optionalDateTime,
  pickupDetails: optionalText,
  outboundAt: optionalDateTime,
  outboundNoticeDeliveredAt: optionalDateTime,
  customerReceiptDeliveredAt: optionalDateTime,
  agentReceiptDeliveredAt: optionalDateTime,
  notes: optionalText,
}).superRefine((data, ctx) => {
  if (data.inboundAt && data.outboundAt && new Date(data.inboundAt) > new Date(data.outboundAt)) {
    ctx.addIssue({ code: "custom", path: ["outboundAt"], message: "实际出库时间不能早于入库时间" });
  }
  if (data.etd && data.eta && new Date(data.etd) > new Date(data.eta)) {
    ctx.addIssue({ code: "custom", path: ["eta"], message: "ETA 不能早于 ETD" });
  }
});

export const vehicleInput = vehiclePayload.and(z.object({ idempotencyKey: z.string().min(8) }));
export const vehicleUpdateInput = vehiclePayload.and(z.object({
  id: z.string().min(1),
  status: z.enum(vehicleStatuses).optional(),
  statusReason: optionalText,
}));

export const driverSubmission = z.object({
  name: z.string().trim().min(2), phone: z.string().trim().min(6), plateNo: z.string().trim().min(2),
  pickupAt: z.iso.datetime(), confirmed: z.literal(true), signature: z.string().min(1),
  idempotencyKey: z.string().min(8),
});
