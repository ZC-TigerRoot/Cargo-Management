import { inventoryDays, vehicleStatuses, type VehicleRecord } from "./domain";

export const vehiclePivotDimensions = [
  "customer",
  "warehouse",
  "type",
  "status",
  "releaseStage",
  "inventoryAge",
  "brand",
  "model",
] as const;

export type VehiclePivotDimension = typeof vehiclePivotDimensions[number];

export const vehiclePivotDimensionLabels: Record<VehiclePivotDimension, string> = {
  customer: "客户",
  warehouse: "仓库",
  type: "业务类型",
  status: "当前状态",
  releaseStage: "放车进度",
  inventoryAge: "库存账龄",
  brand: "品牌",
  model: "车型",
};

export const vehiclePivotScopeLabels = {
  inventory: "当前在库",
  merchantUnreleased: "商社未放",
  all: "全部筛选车辆",
} as const;

export type VehiclePivotScope = keyof typeof vehiclePivotScopeLabels;

export const releaseStages = [
  "待入库",
  "商社未放",
  "商社已放待下一步",
  "已放待提货",
  "出库通知已交付",
  "已离库",
] as const;

export type ReleaseStage = typeof releaseStages[number];

const inventoryAgeStages = ["0–7 天", "8–15 天", "16–30 天", "31 天以上", "未填写入库日期"] as const;
const businessTypes = ["海外仓", "国内仓"] as const;
const MAX_PIVOT_ROW_VALUES = 100;
const MAX_PIVOT_COLUMN_VALUES = 30;
const OTHER_ROW_KEY = "\u0000other-row";
const OTHER_COLUMN_KEY = "\u0000other-column";

function distinctVehicles(records: readonly VehicleRecord[]) {
  return [...new Map(records.map(vehicle => [vehicle.id, vehicle])).values()];
}

function hasEvent(vehicle: VehicleRecord, type: string) {
  return vehicle.history?.some(event => event.type === type) ?? false;
}

function vehicleInventoryDays(vehicle: VehicleRecord, now: Date) {
  return inventoryDays(vehicle.inboundAt, vehicle.outboundAt, now);
}

export function isPhysicalInventory(vehicle: VehicleRecord) {
  return Boolean(vehicle.inboundAt && !vehicle.outboundAt && !hasEvent(vehicle, "DRIVER_SIGNED"));
}

export function isMerchantUnreleased(vehicle: VehicleRecord) {
  return isPhysicalInventory(vehicle) && !vehicle.merchantReleaseAt;
}

function hasPickupSignal(vehicle: VehicleRecord) {
  return Boolean(vehicle.customerReleaseAt || vehicle.pickupDetails || hasEvent(vehicle, "PICKUP_CREATED"));
}

export function vehicleReleaseStage(vehicle: VehicleRecord): ReleaseStage {
  if (vehicle.outboundAt || hasEvent(vehicle, "DRIVER_SIGNED")) return "已离库";
  if (!vehicle.inboundAt) return "待入库";
  if (!vehicle.merchantReleaseAt) return "商社未放";
  if (vehicle.outboundNoticeDeliveredAt) return "出库通知已交付";
  if (hasPickupSignal(vehicle)) return "已放待提货";
  return "商社已放待下一步";
}

export function recordsForPivotScope(records: readonly VehicleRecord[], scope: VehiclePivotScope) {
  const unique = distinctVehicles(records);
  if (scope === "inventory") return unique.filter(isPhysicalInventory);
  if (scope === "merchantUnreleased") return unique.filter(isMerchantUnreleased);
  return unique;
}

export type VehicleInventorySummary = {
  inventoryCount: number;
  merchantUnreleasedCount: number;
  merchantReleasedCount: number;
  pendingPickupCount: number;
  outboundNoticeCount: number;
  overThirtyDaysCount: number;
  averageInventoryDays: number;
  missingCustomerCount: number;
  missingWarehouseCount: number;
  inconsistentReleaseSequenceCount: number;
  signedWithoutOutboundCount: number;
};

export function summarizeVehicleInventory(records: readonly VehicleRecord[], now = new Date()): VehicleInventorySummary {
  const unique = distinctVehicles(records);
  const inventory = unique.filter(isPhysicalInventory);
  const days = inventory.map(vehicle => vehicleInventoryDays(vehicle, now));
  const merchantUnreleasedCount = inventory.filter(vehicle => !vehicle.merchantReleaseAt).length;
  return {
    inventoryCount: inventory.length,
    merchantUnreleasedCount,
    merchantReleasedCount: inventory.length - merchantUnreleasedCount,
    pendingPickupCount: inventory.filter(vehicle => vehicleReleaseStage(vehicle) === "已放待提货").length,
    outboundNoticeCount: inventory.filter(vehicle => Boolean(vehicle.outboundNoticeDeliveredAt)).length,
    overThirtyDaysCount: days.filter(value => value >= 31).length,
    averageInventoryDays: days.length ? days.reduce((sum, value) => sum + value, 0) / days.length : 0,
    missingCustomerCount: inventory.filter(vehicle => !vehicle.customer).length,
    missingWarehouseCount: inventory.filter(vehicle => !vehicle.warehouse).length,
    inconsistentReleaseSequenceCount: inventory.filter(vehicle => !vehicle.merchantReleaseAt && Boolean(
      vehicle.transferDocNoticeAt ||
      vehicle.customerReleaseAt ||
      vehicle.pickupDetails ||
      vehicle.outboundNoticeDeliveredAt ||
      vehicle.customerReceiptDeliveredAt ||
      vehicle.agentReceiptDeliveredAt ||
      hasEvent(vehicle, "PICKUP_CREATED"),
    )).length,
    signedWithoutOutboundCount: unique.filter(vehicle => !vehicle.outboundAt && hasEvent(vehicle, "DRIVER_SIGNED")).length,
  };
}

function inventoryAgeLabel(vehicle: VehicleRecord, now: Date) {
  if (!vehicle.inboundAt) return "未填写入库日期";
  const days = vehicleInventoryDays(vehicle, now);
  if (days <= 7) return "0–7 天";
  if (days <= 15) return "8–15 天";
  if (days <= 30) return "16–30 天";
  return "31 天以上";
}

export function vehiclePivotValue(vehicle: VehicleRecord, dimension: VehiclePivotDimension, now = new Date()) {
  if (dimension === "customer") return vehicle.customer || "未填写客户";
  if (dimension === "warehouse") {
    if (vehicle.warehouse && vehicle.warehouseLocation) return `${vehicle.warehouse} · ${vehicle.warehouseLocation}`;
    if (vehicle.warehouse) return vehicle.warehouse;
    if (vehicle.warehouseLocation) return `未填写仓库 · ${vehicle.warehouseLocation}`;
    return "未填写仓库";
  }
  if (dimension === "type") return vehicle.type === "overseas" ? "海外仓" : "国内仓";
  if (dimension === "status") return vehicle.status;
  if (dimension === "releaseStage") return vehicleReleaseStage(vehicle);
  if (dimension === "inventoryAge") return inventoryAgeLabel(vehicle, now);
  if (dimension === "brand") return vehicle.brand || "未填写品牌";
  return vehicle.model || "未填写车型";
}

const dimensionOrder: Partial<Record<VehiclePivotDimension, readonly string[]>> = {
  type: businessTypes,
  status: vehicleStatuses,
  releaseStage: releaseStages,
  inventoryAge: inventoryAgeStages,
};

function compareDimensionValues(dimension: VehiclePivotDimension, left: string, right: string) {
  const order = dimensionOrder[dimension];
  if (order) {
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    if (leftIndex !== rightIndex) return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex);
  }
  return left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
}

export type VehiclePivot = {
  columns: string[];
  rows: { value: string; cells: number[]; total: number }[];
  columnTotals: number[];
  total: number;
  groupedRowValues: number;
  groupedColumnValues: number;
};

function limitedDimensionValues(counts: Map<string, number>, dimension: VehiclePivotDimension, limit: number) {
  const values = [...counts.keys()];
  if (values.length <= limit) return { kept: new Set(values), grouped: 0 };
  const ranked = values.sort((left, right) =>
    (counts.get(right) ?? 0) - (counts.get(left) ?? 0) || compareDimensionValues(dimension, left, right));
  return { kept: new Set(ranked.slice(0, limit)), grouped: values.length - limit };
}

export function createVehiclePivot(
  records: readonly VehicleRecord[],
  rowDimension: VehiclePivotDimension,
  columnDimension: VehiclePivotDimension,
  now = new Date(),
): VehiclePivot {
  const values = distinctVehicles(records).map(vehicle => ({
    row: vehiclePivotValue(vehicle, rowDimension, now),
    column: vehiclePivotValue(vehicle, columnDimension, now),
  }));
  const rawRowCounts = new Map<string, number>();
  const rawColumnCounts = new Map<string, number>();
  for (const value of values) {
    rawRowCounts.set(value.row, (rawRowCounts.get(value.row) ?? 0) + 1);
    rawColumnCounts.set(value.column, (rawColumnCounts.get(value.column) ?? 0) + 1);
  }
  const rowSelection = limitedDimensionValues(rawRowCounts, rowDimension, MAX_PIVOT_ROW_VALUES);
  const columnSelection = limitedDimensionValues(rawColumnCounts, columnDimension, MAX_PIVOT_COLUMN_VALUES);
  const matrix = new Map<string, Map<string, number>>();

  for (const value of values) {
    const row = rowSelection.kept.has(value.row) ? value.row : OTHER_ROW_KEY;
    const column = columnSelection.kept.has(value.column) ? value.column : OTHER_COLUMN_KEY;
    const rowValues = matrix.get(row) ?? new Map<string, number>();
    rowValues.set(column, (rowValues.get(column) ?? 0) + 1);
    matrix.set(row, rowValues);
  }

  const columnKeys = [...new Set([...matrix.values()].flatMap(row => [...row.keys()]))].sort((left, right) => {
    if (left === OTHER_COLUMN_KEY) return 1;
    if (right === OTHER_COLUMN_KEY) return -1;
    return compareDimensionValues(columnDimension, left, right);
  });
  const columns = columnKeys.map(value => value === OTHER_COLUMN_KEY ? `其他（${columnSelection.grouped} 项）` : value);
  const rows = [...matrix.entries()].map(([value, rowValues]) => {
    const cells = columnKeys.map(column => rowValues.get(column) ?? 0);
    return {
      value: value === OTHER_ROW_KEY ? `其他（${rowSelection.grouped} 项）` : value,
      cells,
      total: cells.reduce((sum, count) => sum + count, 0),
      other: value === OTHER_ROW_KEY,
    };
  }).sort((left, right) => {
    if (left.other) return 1;
    if (right.other) return -1;
    if (dimensionOrder[rowDimension]) return compareDimensionValues(rowDimension, left.value, right.value);
    return right.total - left.total || compareDimensionValues(rowDimension, left.value, right.value);
  }).map(row => ({ value: row.value, cells: row.cells, total: row.total }));
  const columnTotals = columns.map((_, index) => rows.reduce((sum, row) => sum + row.cells[index], 0));

  return {
    columns,
    rows,
    columnTotals,
    total: columnTotals.reduce((sum, count) => sum + count, 0),
    groupedRowValues: rowSelection.grouped,
    groupedColumnValues: columnSelection.grouped,
  };
}
