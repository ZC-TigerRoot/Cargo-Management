"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, SlidersHorizontal, Trash2 } from "lucide-react";
import { inventoryDays, type VehicleRecord } from "@/lib/domain";
import { chinaDateTime } from "@/lib/datetime";

type Column = {
  id: string;
  label: string;
  value: (vehicle: VehicleRecord) => string | number | undefined;
  render?: (vehicle: VehicleRecord) => ReactNode;
};

const columns: Column[] = [
  { id: "vehicle", label: "车辆", value: vehicle => `${vehicle.model ?? ""} ${vehicle.vin ?? ""}`, render: vehicle => <><b>{vehicle.model || "未填写车型"}</b><small>{vehicle.vin || "未填写车架号"}</small></> },
  { id: "business", label: "业务 / 批次", value: vehicle => `${vehicle.type} ${vehicle.referenceNo ?? ""}`, render: vehicle => <><span className={`type type-${vehicle.type}`}>{vehicle.type === "overseas" ? "海外仓" : "国内仓"}</span><small>{vehicle.referenceNo || "未填写批次"}</small></> },
  { id: "warehouse", label: "仓库", value: vehicle => `${vehicle.warehouse ?? ""} ${vehicle.warehouseLocation ?? ""}`, render: vehicle => <>{vehicle.warehouse || "—"}<small>{vehicle.warehouseLocation || "未填写地点"}</small></> },
  { id: "customer", label: "所属客户", value: vehicle => vehicle.customer },
  { id: "inventoryDays", label: "库存天数", value: vehicle => inventoryDays(vehicle.inboundAt, vehicle.outboundAt), render: vehicle => <>{inventoryDays(vehicle.inboundAt, vehicle.outboundAt)} 天</> },
  { id: "status", label: "状态", value: vehicle => vehicle.status, render: vehicle => <span className={`status status-${vehicle.status}`}>{vehicle.status}</span> },
  { id: "vin", label: "车架号", value: vehicle => vehicle.vin },
  { id: "model", label: "车型", value: vehicle => vehicle.model },
  { id: "brand", label: "品牌", value: vehicle => vehicle.brand },
  { id: "referenceNo", label: "提单号 / PO#", value: vehicle => vehicle.referenceNo },
  { id: "inboundAt", label: "入库时间", value: vehicle => vehicle.inboundAt, render: vehicle => vehicle.inboundAt ? chinaDateTime(vehicle.inboundAt) : "—" },
  { id: "inboundAmount", label: "入库金额", value: vehicle => vehicle.inboundAmount ? Number(vehicle.inboundAmount) : undefined, render: vehicle => vehicle.inboundAmount || "—" },
  { id: "inboundBoeNo", label: "入库 BOE 号", value: vehicle => vehicle.inboundBoeNo },
  { id: "outboundAt", label: "出库时间", value: vehicle => vehicle.outboundAt, render: vehicle => vehicle.outboundAt ? chinaDateTime(vehicle.outboundAt) : "—" },
  { id: "outboundBoeNo", label: "出库 BOE 号", value: vehicle => vehicle.outboundBoeNo },
  { id: "outboundBoeTitle", label: "BOE 抬头", value: vehicle => vehicle.outboundBoeTitle },
  { id: "outboundAmount", label: "出库金额", value: vehicle => vehicle.outboundAmount ? Number(vehicle.outboundAmount) : undefined, render: vehicle => vehicle.outboundAmount || "—" },
  { id: "updatedAt", label: "最后修改时间", value: vehicle => vehicle.updatedAt, render: vehicle => chinaDateTime(vehicle.updatedAt) },
];

const defaultOrder = ["vehicle", "business", "warehouse", "customer", "inventoryDays", "status", ...columns.map(column => column.id).filter(id => !["vehicle", "business", "warehouse", "customer", "inventoryDays", "status"].includes(id))];
const defaultVisible = ["vehicle", "business", "warehouse", "customer", "inventoryDays", "status"];
const columnById = new Map(columns.map(column => [column.id, column]));

type Preferences = { order: string[]; visible: string[]; sort: string; direction: "asc" | "desc" };

function validPreferences(value: unknown): value is Preferences {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<Preferences>;
  return Array.isArray(data.order) && Array.isArray(data.visible) && typeof data.sort === "string" &&
    (data.direction === "asc" || data.direction === "desc");
}

export default function VehicleTable({ rows, storageKey = "cargo.vehicle-table", canDelete = false, onDeleted }: { rows: VehicleRecord[]; storageKey?: string; canDelete?: boolean; onDeleted?: (id: string) => void }) {
  const [order, setOrder] = useState(defaultOrder);
  const [visible, setVisible] = useState(defaultVisible);
  const [sort, setSort] = useState("updatedAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [ready, setReady] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (validPreferences(stored)) {
        const known = stored.order.filter(id => columnById.has(id));
        setOrder([...known, ...defaultOrder.filter(id => !known.includes(id))]);
        const selected = stored.visible.filter(id => columnById.has(id));
        if (selected.length) setVisible(selected);
        if (columnById.has(stored.sort)) setSort(stored.sort);
        setDirection(stored.direction);
      }
    } catch {
      // Ignore a malformed browser preference and use the safe defaults.
    }
    setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [storageKey]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(storageKey, JSON.stringify({ order, visible, sort, direction } satisfies Preferences));
  }, [direction, order, ready, sort, storageKey, visible]);

  const visibleColumns = order.flatMap(id => visible.includes(id) && columnById.get(id) ? [columnById.get(id)!] : []);
  const sorted = useMemo(() => {
    const column = columnById.get(sort) ?? columns[0];
    return rows.map((vehicle, index) => ({ vehicle, index })).sort((left, right) => {
      const a = column.value(left.vehicle);
      const b = column.value(right.vehicle);
      if (a === undefined || a === "") return b === undefined || b === "" ? left.index - right.index : 1;
      if (b === undefined || b === "") return -1;
      const result = typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b), "zh-CN", { numeric: true, sensitivity: "base" });
      return result === 0 ? left.index - right.index : direction === "asc" ? result : -result;
    }).map(item => item.vehicle);
  }, [direction, rows, sort]);

  function move(id: string, offset: -1 | 1) {
    setOrder(current => {
      const from = current.indexOf(id);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  function reset() {
    setOrder(defaultOrder);
    setVisible(defaultVisible);
    setSort("updatedAt");
    setDirection("desc");
  }

  async function remove(vehicle: VehicleRecord) {
    const label = vehicle.vin || vehicle.model || "这条未命名车辆记录";
    if (!window.confirm(`确认永久删除“${label}”？相关提货任务、业务事件和附件也会一并删除。`)) return;
    setDeletingId(vehicle.id);
    setDeleteError("");
    try {
      const response = await fetch("/api/v1/vehicles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: vehicle.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "删除失败");
      onDeleted?.(vehicle.id);
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "删除失败，请稍后重试");
    } finally {
      setDeletingId("");
    }
  }

  return <>
    {deleteError && <p className="form-error table-error" role="alert">{deleteError}</p>}
    <div className="column-toolbar">
      <label><ArrowUpDown />排序<select value={sort} onChange={event => setSort(event.target.value)}>{columns.map(column => <option value={column.id} key={column.id}>{column.label}</option>)}</select></label>
      <button type="button" onClick={() => setDirection(current => current === "asc" ? "desc" : "asc")}>{direction === "asc" ? <ArrowUp /> : <ArrowDown />}{direction === "asc" ? "升序" : "降序"}</button>
      <details><summary><SlidersHorizontal />显示与排列属性</summary><div className="column-picker">{order.map((id, index) => {
        const column = columnById.get(id)!;
        const checked = visible.includes(id);
        return <div key={id}><label><input type="checkbox" checked={checked} onChange={event => setVisible(current => event.target.checked ? [...current, id] : current.length > 1 ? current.filter(item => item !== id) : current)} />{column.label}</label><span><button type="button" onClick={() => move(id, -1)} disabled={index === 0} aria-label={`上移${column.label}`}><ArrowUp /></button><button type="button" onClick={() => move(id, 1)} disabled={index === order.length - 1} aria-label={`下移${column.label}`}><ArrowDown /></button></span></div>;
      })}<button type="button" className="reset-columns" onClick={reset}>恢复默认</button></div></details>
    </div>
    <div className="table-wrap"><table><thead><tr>{visibleColumns.map(column => <th key={column.id}>{column.label}</th>)}<th></th></tr></thead><tbody>{sorted.map(vehicle => <tr key={vehicle.id}>{visibleColumns.map(column => <td key={column.id}>{column.render ? column.render(vehicle) : column.value(vehicle) ?? "—"}</td>)}<td><div className="vehicle-row-actions"><Link href={`/vehicles/${vehicle.id}`}>查看 →</Link>{canDelete && <button type="button" className="vehicle-delete" disabled={deletingId === vehicle.id} onClick={() => remove(vehicle)} title="删除车辆"><Trash2 />{deletingId === vehicle.id ? "删除中" : "删除"}</button>}</div></td></tr>)}</tbody></table>{!sorted.length && <div className="empty">暂无符合条件的车辆</div>}</div>
  </>;
}
