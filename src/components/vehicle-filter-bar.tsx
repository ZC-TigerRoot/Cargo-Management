"use client";

import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { vehicleStatuses, type BusinessType, type VehicleRecord } from "@/lib/domain";
import {
  activeVehicleFilterCount,
  createVehicleFilters,
  EMPTY_FACET_VALUE,
  filterVehicleRecords,
  inventoryAgeLabels,
  vehicleFacetOptions,
  type VehicleFacetKey,
  type VehicleFilterKey,
  type VehicleFilters,
} from "@/lib/vehicle-filters";

type Props = {
  records: VehicleRecord[];
  filters: VehicleFilters;
  onChange: (filters: VehicleFilters) => void;
  lockedType?: BusinessType;
};

const typeLabels = { overseas: "海外仓", domestic: "国内仓" } as const;

function labelForOption(field: VehicleFacetKey, value: string) {
  if (value === EMPTY_FACET_VALUE) return "未填写";
  if (field === "type") return typeLabels[value as BusinessType] ?? value;
  if (field === "inventoryAge") return inventoryAgeLabels[value as keyof typeof inventoryAgeLabels] ?? value;
  return value;
}

export default function VehicleFilterBar({ records, filters, onChange, lockedType }: Props) {
  const visibleFilters: VehicleFilters = lockedType && filters.type ? { ...filters, type: "" } : filters;
  const effectiveFilters = lockedType ? { ...visibleFilters, type: lockedType } : visibleFilters;
  const filtered = filterVehicleRecords(records, effectiveFilters);
  const activeCount = activeVehicleFilterCount(visibleFilters);
  const primaryCount = (["q", "type", "status", "warehouse", "customer"] as const).filter(key => visibleFilters[key]).length;
  const advancedCount = activeCount - primaryCount;
  const statusCounts = vehicleStatuses.map(status => ({ status, count: filtered.filter(vehicle => vehicle.status === status).length })).filter(item => item.count);
  const typeCounts = (["overseas", "domestic"] as const).map(type => ({ type, count: filtered.filter(vehicle => vehicle.type === type).length })).filter(item => item.count);

  function update(key: VehicleFilterKey, value: string) {
    onChange({ ...visibleFilters, [key]: value });
  }

  function facet(field: VehicleFacetKey, label: string, include = true) {
    if (!include) return null;
    const options = vehicleFacetOptions(records, effectiveFilters, field);
    return <label>{label}<select value={visibleFilters[field]} onChange={event => update(field, event.target.value)}>
      <option value="">全部{label}</option>
      {options.map(option => <option key={option.value} value={option.value}>{labelForOption(field, option.value)}（{option.count}）</option>)}
    </select></label>;
  }

  return <div className="vehicle-filter-bar">
    <div className="vehicle-filter-primary">
      <label className="search"><Search/><input type="search" value={visibleFilters.q} onChange={event => update("q", event.target.value)} placeholder="跨字段搜索，多个关键词用空格分开" aria-label="跨字段搜索车辆"/></label>
      {facet("type", "业务类型", !lockedType)}
      {facet("status", "状态")}
      {facet("warehouse", "仓库")}
      {facet("customer", "客户")}
      <span className="result-count">筛选结果 <b>{filtered.length}</b> / {records.length} 辆</span>
    </div>
    <details className="advanced-filters">
      <summary><SlidersHorizontal/>更多字段筛选{advancedCount ? `（已启用 ${advancedCount} 项）` : ""}</summary>
      <div className="advanced-filter-grid">
        {facet("model", "车型")}
        {facet("brand", "品牌")}
        {facet("inventoryAge", "库存账龄")}
        <label>车架号<input value={visibleFilters.vin} onChange={event => update("vin", event.target.value)} placeholder="包含…"/></label>
        <label>提单号 / PO#<input value={visibleFilters.referenceNo} onChange={event => update("referenceNo", event.target.value)} placeholder="包含…"/></label>
        <label>仓库地点<input value={visibleFilters.warehouseLocation} onChange={event => update("warehouseLocation", event.target.value)} placeholder="包含…"/></label>
        <label>入库 BOE 号<input value={visibleFilters.inboundBoeNo} onChange={event => update("inboundBoeNo", event.target.value)} placeholder="包含…"/></label>
        <label>出库 BOE 号<input value={visibleFilters.outboundBoeNo} onChange={event => update("outboundBoeNo", event.target.value)} placeholder="包含…"/></label>
        <label>BOE 抬头<input value={visibleFilters.outboundBoeTitle} onChange={event => update("outboundBoeTitle", event.target.value)} placeholder="包含…"/></label>
        <fieldset><legend>入库日期</legend><input type="date" value={visibleFilters.inboundFrom} onChange={event => update("inboundFrom", event.target.value)} aria-label="入库开始日期"/><span>至</span><input type="date" value={visibleFilters.inboundTo} onChange={event => update("inboundTo", event.target.value)} aria-label="入库结束日期"/></fieldset>
        <fieldset><legend>出库日期</legend><input type="date" value={visibleFilters.outboundFrom} onChange={event => update("outboundFrom", event.target.value)} aria-label="出库开始日期"/><span>至</span><input type="date" value={visibleFilters.outboundTo} onChange={event => update("outboundTo", event.target.value)} aria-label="出库结束日期"/></fieldset>
        <fieldset><legend>最后修改日期</legend><input type="date" value={visibleFilters.updatedFrom} onChange={event => update("updatedFrom", event.target.value)} aria-label="修改开始日期"/><span>至</span><input type="date" value={visibleFilters.updatedTo} onChange={event => update("updatedTo", event.target.value)} aria-label="修改结束日期"/></fieldset>
        <fieldset><legend>入库金额</legend><input type="number" step="0.01" value={visibleFilters.inboundAmountMin} onChange={event => update("inboundAmountMin", event.target.value)} placeholder="最低" aria-label="最低入库金额"/><span>至</span><input type="number" step="0.01" value={visibleFilters.inboundAmountMax} onChange={event => update("inboundAmountMax", event.target.value)} placeholder="最高" aria-label="最高入库金额"/></fieldset>
        <fieldset><legend>出库金额</legend><input type="number" step="0.01" value={visibleFilters.outboundAmountMin} onChange={event => update("outboundAmountMin", event.target.value)} placeholder="最低" aria-label="最低出库金额"/><span>至</span><input type="number" step="0.01" value={visibleFilters.outboundAmountMax} onChange={event => update("outboundAmountMax", event.target.value)} placeholder="最高" aria-label="最高出库金额"/></fieldset>
      </div>
    </details>
    <div className="filter-statistics">
      <span>数量统计</span>
      {typeCounts.map(item => <i key={item.type}>{typeLabels[item.type]} <b>{item.count}</b></i>)}
      {statusCounts.map(item => <i key={item.status}>{item.status} <b>{item.count}</b></i>)}
      {activeCount > 0 && <button type="button" onClick={() => onChange(createVehicleFilters())}><RotateCcw/>清除全部筛选</button>}
    </div>
  </div>;
}
