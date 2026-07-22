import { inventoryDays, vehicleStatuses, type BusinessType, type VehicleRecord, type VehicleStatus } from "./domain";
import { CHINA_TIME_ZONE, localInputValue } from "./datetime";

export const EMPTY_FACET_VALUE = "__empty__";

export const inventoryAgeLabels = {
  "0-7": "0–7 天",
  "8-15": "8–15 天",
  "16-30": "16–30 天",
  "31+": "31 天以上",
} as const;

export type InventoryAgeFilter = keyof typeof inventoryAgeLabels;

export type VehicleFilters = {
  q: string;
  type: BusinessType | "";
  status: VehicleStatus | "";
  warehouse: string;
  warehouseLocation: string;
  customer: string;
  model: string;
  brand: string;
  referenceNo: string;
  vin: string;
  inboundBoeNo: string;
  outboundBoeNo: string;
  outboundBoeTitle: string;
  inventoryAge: InventoryAgeFilter | "";
  inboundFrom: string;
  inboundTo: string;
  outboundFrom: string;
  outboundTo: string;
  updatedFrom: string;
  updatedTo: string;
  inboundAmountMin: string;
  inboundAmountMax: string;
  outboundAmountMin: string;
  outboundAmountMax: string;
};

export type VehicleFilterKey = keyof VehicleFilters;
export type VehicleFacetKey = "type" | "status" | "warehouse" | "customer" | "model" | "brand" | "inventoryAge";

const filterKeys: VehicleFilterKey[] = [
  "q", "type", "status", "warehouse", "warehouseLocation", "customer", "model", "brand", "referenceNo", "vin",
  "inboundBoeNo", "outboundBoeNo", "outboundBoeTitle", "inventoryAge", "inboundFrom", "inboundTo", "outboundFrom",
  "outboundTo", "updatedFrom", "updatedTo", "inboundAmountMin", "inboundAmountMax", "outboundAmountMin", "outboundAmountMax",
];

export function createVehicleFilters(): VehicleFilters {
  return Object.fromEntries(filterKeys.map(key => [key, ""])) as VehicleFilters;
}

function normalized(value: string | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("zh-CN");
}

function matchesChoice(value: string | undefined, filter: string) {
  if (!filter) return true;
  if (filter === EMPTY_FACET_VALUE) return !value;
  return normalized(value) === normalized(filter);
}

function matchesText(value: string | undefined, filter: string) {
  return !filter.trim() || normalized(value).includes(normalized(filter));
}

function recordDate(value: string | undefined) {
  return value ? localInputValue(value, CHINA_TIME_ZONE).slice(0, 10) : "";
}

function matchesDateRange(value: string | undefined, from: string, to: string) {
  if (!from && !to) return true;
  const date = recordDate(value);
  if (!date) return false;
  return (!from || date >= from) && (!to || date <= to);
}

function matchesNumberRange(value: string | undefined, minimum: string, maximum: string) {
  if (!minimum && !maximum) return true;
  if (value === undefined || value === "") return false;
  const number = Number(value);
  const min = minimum === "" ? undefined : Number(minimum);
  const max = maximum === "" ? undefined : Number(maximum);
  if (!Number.isFinite(number)) return false;
  return (min === undefined || !Number.isFinite(min) || number >= min) &&
    (max === undefined || !Number.isFinite(max) || number <= max);
}

function matchesInventoryAge(vehicle: VehicleRecord, filter: VehicleFilters["inventoryAge"], now: Date) {
  if (!filter) return true;
  if (!vehicle.inboundAt) return false;
  const days = inventoryDays(vehicle.inboundAt, vehicle.outboundAt, now);
  if (filter === "0-7") return days <= 7;
  if (filter === "8-15") return days >= 8 && days <= 15;
  if (filter === "16-30") return days >= 16 && days <= 30;
  return days >= 31;
}

const keywordFields: (keyof VehicleRecord)[] = [
  "vin", "model", "brand", "referenceNo", "hsCode", "portOfLoad", "portOfDischarge", "vesselVoyage", "manufacturer",
  "warehouseLocation", "warehouse", "customer", "status", "inboundAmount", "inboundBoeNo", "outboundBoeNo", "outboundBoeTitle",
  "outboundAmount",
];

function matchesKeywords(vehicle: VehicleRecord, query: string) {
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = keywordFields.map(field => vehicle[field]).filter(value => typeof value === "string").join(" ").toLocaleLowerCase("zh-CN");
  return terms.every(term => haystack.includes(term));
}

export function matchesVehicleFilters(
  vehicle: VehicleRecord,
  filters: VehicleFilters,
  omitted: readonly VehicleFilterKey[] = [],
  now = new Date(),
) {
  const skip = new Set(omitted);
  return (skip.has("q") || matchesKeywords(vehicle, filters.q)) &&
    (skip.has("type") || matchesChoice(vehicle.type, filters.type)) &&
    (skip.has("status") || matchesChoice(vehicle.status, filters.status)) &&
    (skip.has("warehouse") || matchesChoice(vehicle.warehouse, filters.warehouse)) &&
    (skip.has("warehouseLocation") || matchesText(vehicle.warehouseLocation, filters.warehouseLocation)) &&
    (skip.has("customer") || matchesChoice(vehicle.customer, filters.customer)) &&
    (skip.has("model") || matchesChoice(vehicle.model, filters.model)) &&
    (skip.has("brand") || matchesChoice(vehicle.brand, filters.brand)) &&
    (skip.has("referenceNo") || matchesText(vehicle.referenceNo, filters.referenceNo)) &&
    (skip.has("vin") || matchesText(vehicle.vin, filters.vin)) &&
    (skip.has("inboundBoeNo") || matchesText(vehicle.inboundBoeNo, filters.inboundBoeNo)) &&
    (skip.has("outboundBoeNo") || matchesText(vehicle.outboundBoeNo, filters.outboundBoeNo)) &&
    (skip.has("outboundBoeTitle") || matchesText(vehicle.outboundBoeTitle, filters.outboundBoeTitle)) &&
    (skip.has("inventoryAge") || matchesInventoryAge(vehicle, filters.inventoryAge, now)) &&
    (skip.has("inboundFrom") && skip.has("inboundTo") || matchesDateRange(vehicle.inboundAt, skip.has("inboundFrom") ? "" : filters.inboundFrom, skip.has("inboundTo") ? "" : filters.inboundTo)) &&
    (skip.has("outboundFrom") && skip.has("outboundTo") || matchesDateRange(vehicle.outboundAt, skip.has("outboundFrom") ? "" : filters.outboundFrom, skip.has("outboundTo") ? "" : filters.outboundTo)) &&
    (skip.has("updatedFrom") && skip.has("updatedTo") || matchesDateRange(vehicle.updatedAt, skip.has("updatedFrom") ? "" : filters.updatedFrom, skip.has("updatedTo") ? "" : filters.updatedTo)) &&
    (skip.has("inboundAmountMin") && skip.has("inboundAmountMax") || matchesNumberRange(vehicle.inboundAmount, skip.has("inboundAmountMin") ? "" : filters.inboundAmountMin, skip.has("inboundAmountMax") ? "" : filters.inboundAmountMax)) &&
    (skip.has("outboundAmountMin") && skip.has("outboundAmountMax") || matchesNumberRange(vehicle.outboundAmount, skip.has("outboundAmountMin") ? "" : filters.outboundAmountMin, skip.has("outboundAmountMax") ? "" : filters.outboundAmountMax));
}

export function filterVehicleRecords(records: readonly VehicleRecord[], filters: VehicleFilters, omitted: readonly VehicleFilterKey[] = [], now = new Date()) {
  return records.filter(vehicle => matchesVehicleFilters(vehicle, filters, omitted, now));
}

export function activeVehicleFilterCount(filters: VehicleFilters) {
  return filterKeys.filter(key => filters[key] !== "").length;
}

function dateParam(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function amountParam(value: string | null) {
  return value && /^-?\d+(?:\.\d+)?$/.test(value) ? value.slice(0, 30) : "";
}

export function vehicleFiltersFromSearchParams(params: Pick<URLSearchParams, "get">): VehicleFilters {
  const result = createVehicleFilters();
  for (const key of filterKeys) result[key] = (params.get(key) ?? "").trim().slice(0, 100) as never;
  if (result.type !== "overseas" && result.type !== "domestic") result.type = "";
  if (!vehicleStatuses.includes(result.status as VehicleStatus)) result.status = "";
  if (!(result.inventoryAge in inventoryAgeLabels)) result.inventoryAge = "";
  for (const key of ["inboundFrom", "inboundTo", "outboundFrom", "outboundTo", "updatedFrom", "updatedTo"] as const) result[key] = dateParam(params.get(key));
  for (const key of ["inboundAmountMin", "inboundAmountMax", "outboundAmountMin", "outboundAmountMax"] as const) result[key] = amountParam(params.get(key));
  return result;
}

export function vehicleExportUrl(filters: VehicleFilters) {
  const params = new URLSearchParams();
  for (const key of filterKeys) if (filters[key]) params.set(key, filters[key]);
  const query = params.toString();
  return query ? `/api/v1/export?${query}` : "/api/v1/export";
}

export function vehicleFacetOptions(records: readonly VehicleRecord[], filters: VehicleFilters, field: VehicleFacetKey, now = new Date()) {
  const relatedKeys: VehicleFilterKey[] = field === "inventoryAge" ? ["inventoryAge"] : [field];
  const candidates = filterVehicleRecords(records, filters, relatedKeys, now);
  const counts = new Map<string, number>();
  for (const vehicle of candidates) {
    let value: string;
    if (field === "inventoryAge") {
      if (!vehicle.inboundAt) continue;
      const days = inventoryDays(vehicle.inboundAt, vehicle.outboundAt, now);
      value = days <= 7 ? "0-7" : days <= 15 ? "8-15" : days <= 30 ? "16-30" : "31+";
    } else {
      value = String(vehicle[field] || EMPTY_FACET_VALUE);
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const values = field === "inventoryAge"
    ? Object.keys(inventoryAgeLabels)
    : field === "status"
      ? vehicleStatuses.filter(value => counts.has(value))
      : [...counts.keys()].sort((left, right) => {
        if (left === EMPTY_FACET_VALUE) return 1;
        if (right === EMPTY_FACET_VALUE) return -1;
        return left.localeCompare(right, "zh-CN", { numeric: true });
      });
  return values.map(value => ({ value, count: counts.get(value) ?? 0 }));
}
