import { z } from "zod";
import { vehicleStatuses } from "./domain";
import { CHINA_TIME_ZONE } from "./datetime";

const optionalText = z.string().trim().optional().transform(value => value || undefined);
const optionalDateTime = z.iso.datetime({ offset: true }).optional();
const optionalAmount = z.union([z.string().trim(), z.number().finite()]).optional().transform((value, ctx) => {
  if (value === undefined || value === "") return undefined;
  const normalized = typeof value === "number" ? value.toFixed(2) : value;
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(normalized)) {
    ctx.addIssue({ code: "custom", message: "金额必须为非负数、最多 16 位整数和两位小数" });
    return z.NEVER;
  }
  return normalized;
});

export const vehiclePayload = z.object({
  vin: z.string().trim().min(1, "车架号不能为空").max(100, "车架号不能超过 100 个字符").transform(value => value.toUpperCase()),
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
  warehouseTimezone: z.literal(CHINA_TIME_ZONE),
  customer: z.string().trim().min(1, "所属客人不能为空"),
  inboundAt: optionalDateTime,
  inboundAmount: optionalAmount,
  inboundBoeNo: optionalText,
  merchantReleaseAt: optionalDateTime,
  transferDocNoticeAt: optionalDateTime,
  customerReleaseAt: optionalDateTime,
  pickupDetails: optionalText,
  outboundAt: optionalDateTime,
  outboundBoeNo: optionalText,
  outboundBoeTitle: optionalText,
  outboundAmount: optionalAmount,
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
  version: z.number().int().positive(),
  status: z.enum(vehicleStatuses).optional(),
  statusReason: optionalText,
})).superRefine((data, ctx) => {
  if (data.status && !data.statusReason) {
    ctx.addIssue({ code: "custom", path: ["statusReason"], message: "状态变更必须填写原因" });
  }
});

export const driverSubmission = z.object({
  pickupAt: z.iso.datetime(),
  idempotencyKey: z.string().min(8),
});
