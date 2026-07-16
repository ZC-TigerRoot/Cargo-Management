import type { VehicleRecord } from "./domain";

export type PickupSearchTask = {
  taskNo: string;
  vehicles: { id: string; vin?: string; model?: string }[];
};

export function pickupVehicleSearchValues(vehicle: VehicleRecord) {
  return [
    vehicle.referenceNo,
    vehicle.vin,
    vehicle.model,
    vehicle.brand,
    vehicle.customer,
    vehicle.warehouse,
    vehicle.warehouseLocation,
    vehicle.inboundBoeNo,
    vehicle.outboundBoeNo,
    vehicle.outboundBoeTitle,
    vehicle.pickupDetails,
  ];
}

export function matchesPickupSearch(values: (string | undefined)[], query: string) {
  const terms = query.trim().toLocaleLowerCase("zh-CN").split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const searchable = values.filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
  return terms.every(term => searchable.includes(term));
}

export function pickupTaskMatchesSearch(task: PickupSearchTask, records: ReadonlyMap<string, VehicleRecord>, query: string) {
  return matchesPickupSearch([
    task.taskNo,
    ...task.vehicles.flatMap(vehicle => {
      const record = records.get(vehicle.id);
      return [vehicle.vin, vehicle.model, ...(record ? pickupVehicleSearchValues(record) : [])];
    }),
  ], query);
}
