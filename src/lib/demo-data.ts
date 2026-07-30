import type { VehicleRecord } from "./domain";

export const vehicles: VehicleRecord[] = [
  {
    id: "v1", version: 1, updateSequence: "6", vin: "L6T79S2E8RA102847", model: "宋 PLUS DM-i", brand: "比亚迪", type: "overseas",
    referenceNo: "BL-2026-0712", hsCode: "870380", portOfLoad: "上海港", portOfDischarge: "杰贝阿里港",
    vesselVoyage: "COSCO SHIPPING TAURUS / 071E", etd: "2026-06-05", eta: "2026-06-21",
    customer: "海湾汽车贸易", warehouseLocation: "Dubai Logistics District", warehouse: "迪拜杰贝阿里保税仓",
    warehouseTimezone: "Asia/Shanghai", status: "在库", inboundAt: "2026-06-23", inboundAmount: "12500.00", inboundBoeNo: "BOE-IN-260623-01",
    merchantReleaseAt: "2026-07-08", transferDocNoticeAt: "2026-07-09",
    updatedAt: "2026-07-14", notes: "卡片钥匙，已完成开锁检查",
  },
  {
    id: "v2", version: 1, updateSequence: "5", vin: "LSJA24U66RN023519", model: "MG4 EV", brand: "名爵", type: "overseas",
    referenceNo: "BL-2026-0712", hsCode: "870380", portOfLoad: "上海港", portOfDischarge: "杰贝阿里港",
    vesselVoyage: "COSCO SHIPPING TAURUS / 071E", customer: "海湾汽车贸易", warehouseLocation: "Dubai Logistics District",
    warehouse: "迪拜杰贝阿里保税仓", warehouseTimezone: "Asia/Shanghai", status: "待提货", inboundAt: "2026-06-25",
    customerReleaseAt: "2026-07-13", pickupDetails: "提取 1 辆，随车钥匙 2 把，提货前核对外观。",
    updatedAt: "2026-07-14",
  },
  {
    id: "v3", version: 1, updateSequence: "2", vin: "LDC613P27R3021846", model: "UNI-K", brand: "长安", manufacturer: "重庆长安汽车股份有限公司",
    type: "domestic", referenceNo: "PO-240713-A", customer: "远东供应链", warehouseLocation: "上海市浦东新区临港产业区",
    warehouse: "上海临港汽车仓", warehouseTimezone: "Asia/Shanghai", status: "在库", inboundAt: "2026-07-13",
    updatedAt: "2026-07-13",
  },
  {
    id: "v4", version: 1, updateSequence: "4", vin: "LGXCE6DB1R0127654", model: "星越 L", brand: "吉利", manufacturer: "浙江吉利汽车有限公司",
    type: "domestic", referenceNo: "PO-240708-C", customer: "新程汽车", warehouseLocation: "宁波市北仑区", warehouse: "宁波北仑仓",
    warehouseTimezone: "Asia/Shanghai", status: "待签收", inboundAt: "2026-07-08",
    pickupDetails: "司机凭 PU-20260714-008 提取，随车文件一套。", outboundAt: "2026-07-14",
    updatedAt: "2026-07-14",
  },
  {
    id: "v5", version: 1, updateSequence: "3", vin: "LC0CE6CB9R0084932", model: "海豹 06", brand: "比亚迪", manufacturer: "比亚迪汽车工业有限公司",
    type: "domestic", referenceNo: "PO-240701-B", customer: "新程汽车", warehouseLocation: "宁波市北仑区", warehouse: "宁波北仑仓",
    warehouseTimezone: "Asia/Shanghai", status: "异常", inboundAt: "2026-07-01",
    updatedAt: "2026-07-14", notes: "右后视镜划痕，等待客户确认",
  },
  {
    id: "v6", version: 1, updateSequence: "1", vin: "LVVDB21B8RD154027", model: "瑞虎 8 PRO", brand: "奇瑞", type: "overseas",
    referenceNo: "BL-2026-0701", hsCode: "870323", portOfLoad: "宁波港", portOfDischarge: "蒙巴萨港", customer: "东非汽车集团",
    warehouseLocation: "Jebel Ali Free Zone", warehouse: "迪拜杰贝阿里保税仓", warehouseTimezone: "Asia/Shanghai", status: "已完成",
    inboundAt: "2026-06-17", outboundAt: "2026-07-12",
    outboundBoeNo: "BOE-OUT-260712-06", outboundBoeTitle: "东非汽车集团", outboundAmount: "13200.00",
    customerReceiptDeliveredAt: "2026-07-12", agentReceiptDeliveredAt: "2026-07-13",
    updatedAt: "2026-07-12",
  },
];

export const timeline = [
  { title: "车辆入保税仓", time: "2026-06-23", actor: "仓管员 · Ahmed", note: "车况正常，卡片钥匙 1 张" },
  { title: "商社通知放车", time: "2026-07-08", actor: "操作管理 · 林晓", note: "已收到商社邮件" },
  { title: "客户通知做过户文件", time: "2026-07-09", actor: "操作管理 · 林晓", note: "过户资料已提交" },
  { title: "资料补充更正", time: "2026-07-10", actor: "操作管理 · 林晓", note: "更正钥匙备注；原记录完整保留" },
];
