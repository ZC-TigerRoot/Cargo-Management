export type Role = "warehouse" | "forwarder" | "customer" | "admin";
export const roleLabels: Record<Role, string> = {
  warehouse: "仓管", forwarder: "货代", customer: "客户", admin: "管理员",
};
export type BusinessType = "overseas" | "domestic";
export const vehicleStatuses = ["待入库", "在库", "待放车", "待提货", "已出库", "待签收", "已完成", "异常"] as const;
export type VehicleStatus = typeof vehicleStatuses[number];

export type VehicleRecord = {
  id: string;
  version: number;
  vin: string;
  model: string;
  brand?: string;
  type: BusinessType;
  referenceNo: string;
  hsCode?: string;
  portOfLoad?: string;
  portOfDischarge?: string;
  vesselVoyage?: string;
  etd?: string;
  eta?: string;
  manufacturer?: string;
  warehouseLocation: string;
  warehouse: string;
  warehouseTimezone: string;
  customer: string;
  status: VehicleStatus;
  inboundAt?: string;
  inboundAmount?: string;
  inboundBoeNo?: string;
  merchantReleaseAt?: string;
  transferDocNoticeAt?: string;
  customerReleaseAt?: string;
  pickupDetails?: string;
  outboundAt?: string;
  outboundBoeNo?: string;
  outboundBoeTitle?: string;
  outboundAmount?: string;
  outboundNoticeDeliveredAt?: string;
  customerReceiptDeliveredAt?: string;
  agentReceiptDeliveredAt?: string;
  updatedAt: string;
  notes?: string;
  history?: VehicleEventRecord[];
  auditTrail?: VehicleAuditRecord[];
};

export type VehicleEventRecord = {
  id: string;
  type: string;
  title: string;
  occurredAt: string;
  recordedAt: string;
  actor?: string;
  correctionOfId?: string;
  reason?: string;
  attachments?: VehicleAttachmentRecord[];
};

export type VehicleAttachmentRecord = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
};

export type VehicleAuditChange = {
  field: string;
  label: string;
  before?: string;
  after?: string;
};

export type VehicleAuditRecord = {
  id: string;
  action: string;
  actor: string;
  changedAt: string;
  changes: VehicleAuditChange[];
};

export type VehicleFormValues = Omit<VehicleRecord, "id" | "version" | "status" | "updatedAt" | "history">;

export const transitions: Record<string, VehicleStatus> = {
  INBOUND: "在库", MERCHANT_RELEASE: "待放车", CUSTOMER_RELEASE: "待提货",
  PICKUP_CREATED: "待提货", OUTBOUND: "待签收", DRIVER_SIGNED: "已完成", EXCEPTION: "异常",
};

export function inventoryDays(inboundAt?: string, outboundAt?: string, now = new Date()) {
  if (!inboundAt) return 0;
  const end = outboundAt ? new Date(outboundAt) : now;
  return Math.max(0, Math.ceil((end.getTime() - new Date(inboundAt).getTime()) / 86_400_000));
}

export type Permission = "view" | "create" | "correct" | "export" | "coordinatePickups" | "manageUsers" | "manageSettings";

export const can = (role: Role, action: Permission) => {
  const grants: Record<Role, string[]> = {
    warehouse: ["view", "create", "correct", "coordinatePickups"],
    forwarder: ["view", "create", "correct", "export", "coordinatePickups", "manageSettings"],
    customer: ["view"],
    admin: ["view", "create", "correct", "export", "coordinatePickups", "manageUsers", "manageSettings"],
  };
  return grants[role].includes(action);
};
