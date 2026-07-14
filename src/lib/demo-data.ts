import type { VehicleRecord } from "./domain";

export const vehicles: VehicleRecord[] = [
  { id:"v1", vin:"L6T79S2E8RA102847", model:"宋 PLUS DM-i", brand:"比亚迪", type:"overseas", referenceNo:"BL-2026-0712", customer:"海湾汽车贸易", warehouse:"迪拜杰贝阿里保税仓", status:"在库", inboundAt:"2026-06-23T09:30:00+04:00", updatedAt:"2026-07-14T10:22:00+08:00", notes:"卡片钥匙，已完成开锁检查" },
  { id:"v2", vin:"LSJA24U66RN023519", model:"MG4 EV", brand:"名爵", type:"overseas", referenceNo:"BL-2026-0712", customer:"海湾汽车贸易", warehouse:"迪拜杰贝阿里保税仓", status:"待提货", inboundAt:"2026-06-25T14:10:00+04:00", updatedAt:"2026-07-14T09:42:00+08:00" },
  { id:"v3", vin:"LDC613P27R3021846", model:"UNI-K", brand:"长安", type:"domestic", referenceNo:"PO-240713-A", customer:"远东供应链", warehouse:"上海临港汽车仓", status:"在库", inboundAt:"2026-07-13T11:05:00+08:00", updatedAt:"2026-07-13T11:05:00+08:00" },
  { id:"v4", vin:"LGXCE6DB1R0127654", model:"星越 L", brand:"吉利", type:"domestic", referenceNo:"PO-240708-C", customer:"新程汽车", warehouse:"宁波北仑仓", status:"待签收", inboundAt:"2026-07-08T08:20:00+08:00", outboundAt:"2026-07-14T08:16:00+08:00", updatedAt:"2026-07-14T08:16:00+08:00" },
  { id:"v5", vin:"LC0CE6CB9R0084932", model:"海豹 06", brand:"比亚迪", type:"domestic", referenceNo:"PO-240701-B", customer:"新程汽车", warehouse:"宁波北仑仓", status:"异常", inboundAt:"2026-07-01T15:40:00+08:00", updatedAt:"2026-07-14T07:52:00+08:00", notes:"右后视镜划痕，等待客户确认" },
  { id:"v6", vin:"LVVDB21B8RD154027", model:"瑞虎 8 PRO", brand:"奇瑞", type:"overseas", referenceNo:"BL-2026-0701", customer:"东非汽车集团", warehouse:"迪拜杰贝阿里保税仓", status:"已完成", inboundAt:"2026-06-17T10:00:00+04:00", outboundAt:"2026-07-12T15:30:00+04:00", updatedAt:"2026-07-12T16:05:00+04:00" },
];

export const timeline = [
  { title:"车辆入保税仓", time:"2026-06-23 09:30", actor:"仓管员 · Ahmed", note:"车况正常，卡片钥匙 1 张" },
  { title:"商社通知放车", time:"2026-07-08 14:20", actor:"操作管理 · 林晓", note:"已收到商社邮件" },
  { title:"客户通知做过户文件", time:"2026-07-09 10:15", actor:"操作管理 · 林晓", note:"过户资料已提交" },
  { title:"资料补充更正", time:"2026-07-10 16:42", actor:"操作管理 · 林晓", note:"更正钥匙备注；原记录完整保留" },
];

