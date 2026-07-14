export type Role = "warehouse" | "operator" | "viewer" | "admin";
export type BusinessType = "overseas" | "domestic";
export type VehicleStatus = "待入库" | "在库" | "待放车" | "待提货" | "已出库" | "待签收" | "已完成" | "异常";

export type VehicleRecord = {
  id: string;
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
  customer: string;
  status: VehicleStatus;
  inboundAt?: string;
  merchantReleaseAt?: string;
  transferDocNoticeAt?: string;
  customerReleaseAt?: string;
  pickupDetails?: string;
  outboundAt?: string;
  outboundNoticeDeliveredAt?: string;
  customerReceiptDeliveredAt?: string;
  agentReceiptDeliveredAt?: string;
  updatedAt: string;
  notes?: string;
};

export type VehicleFormValues = Omit<VehicleRecord, "id" | "status" | "updatedAt">;

export const transitions: Record<string, VehicleStatus> = {
  INBOUND: "在库", MERCHANT_RELEASE: "待放车", CUSTOMER_RELEASE: "待提货",
  PICKUP_CREATED: "待提货", OUTBOUND: "待签收", DRIVER_SIGNED: "已完成", EXCEPTION: "异常",
};

export function inventoryDays(inboundAt?: string, outboundAt?: string, now = new Date()) {
  if (!inboundAt) return 0;
  const end = outboundAt ? new Date(outboundAt) : now;
  return Math.max(0, Math.ceil((end.getTime() - new Date(inboundAt).getTime()) / 86_400_000));
}

export const can = (role: Role, action: "view" | "create" | "correct" | "export" | "manageUsers") => {
  const grants: Record<Role, string[]> = {
    warehouse: ["view", "create"], operator: ["view", "create", "correct", "export"],
    viewer: ["view"], admin: ["view", "manageUsers"],
  };
  return grants[role].includes(action);
};
