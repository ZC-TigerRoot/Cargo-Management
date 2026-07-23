import { z } from "zod";
import { vehicleStatuses } from "./domain";
import { CHINA_TIME_ZONE } from "./datetime";

const optionalText = z.string().trim().max(2_000, "文本内容不能超过 2000 个字符").optional().transform(value => value || undefined);
const optionalLongText = z.string().trim().max(5_000, "文本内容不能超过 5000 个字符").optional().transform(value => value || undefined);
const optionalVin = z.string().trim().max(100, "车架号不能超过 100 个字符").optional()
  .transform(value => value ? value.toUpperCase() : undefined);
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
  vin: optionalVin,
  model: optionalText,
  brand: optionalText,
  type: z.enum(["overseas", "domestic"]),
  referenceNo: optionalText,
  hsCode: optionalText,
  portOfLoad: optionalText,
  portOfDischarge: optionalText,
  vesselVoyage: optionalText,
  etd: optionalDateTime,
  eta: optionalDateTime,
  manufacturer: optionalText,
  warehouseLocation: optionalText,
  warehouse: optionalText,
  warehouseTimezone: z.literal(CHINA_TIME_ZONE),
  customer: optionalText,
  inboundAt: optionalDateTime,
  inboundAmount: optionalAmount,
  inboundBoeNo: optionalText,
  merchantReleaseAt: optionalDateTime,
  transferDocNoticeAt: optionalDateTime,
  customerReleaseAt: optionalDateTime,
  pickupDetails: optionalLongText,
  outboundAt: optionalDateTime,
  outboundBoeNo: optionalText,
  outboundBoeTitle: optionalText,
  outboundAmount: optionalAmount,
  outboundNoticeDeliveredAt: optionalDateTime,
  customerReceiptDeliveredAt: optionalDateTime,
  agentReceiptDeliveredAt: optionalDateTime,
  notes: optionalLongText,
}).superRefine((data, ctx) => {
  if (data.inboundAt && data.outboundAt && new Date(data.inboundAt) > new Date(data.outboundAt)) {
    ctx.addIssue({ code: "custom", path: ["outboundAt"], message: "实际出库时间不能早于入库时间" });
  }
  if (data.etd && data.eta && new Date(data.etd) > new Date(data.eta)) {
    ctx.addIssue({ code: "custom", path: ["eta"], message: "ETA 不能早于 ETD" });
  }
});

export const vehicleInput = vehiclePayload.and(z.object({ idempotencyKey: z.string().min(8).max(128) }));
export const vehicleUpdateInput = vehiclePayload.and(z.object({
  id: z.string().min(1).max(128),
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
  idempotencyKey: z.string().min(8).max(128),
  driverName: z.string().trim().min(1, "请填写姓名").max(100, "姓名不能超过 100 个字符"),
  driverPhone: z.string().trim()
    .min(1, "请填写联系电话")
    .max(30, "联系电话不能超过 30 个字符")
    .regex(/^[\d+\-()\s]+$/, "联系电话只能包含数字、空格、+、- 和括号")
    .refine(value => (value.match(/\d/g)?.length ?? 0) >= 6, "请填写有效的联系电话"),
});

export const vehicleDeleteInput = z.union([
  z.object({ id: z.string().min(1).max(128) }).transform(({ id }) => ({ ids: [id] })),
  z.object({ ids: z.array(z.string().min(1).max(128)).min(1, "请至少选择一条单据") }),
]);
