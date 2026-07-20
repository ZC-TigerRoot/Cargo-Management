"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, GripVertical, SlidersHorizontal, Trash2 } from "lucide-react";
import { inventoryDays, type VehicleRecord } from "@/lib/domain";
import { chinaDateTime } from "@/lib/datetime";

type Column = {
  id: string;
  label: string;
  value: (vehicle: VehicleRecord) => string | number | undefined;
  render?: (vehicle: VehicleRecord) => ReactNode;
};

const columns: Column[] = [
  { id: "vehicle", label: "车辆", value: vehicle => `${vehicle.vin ?? ""} ${vehicle.model ?? ""}`, render: vehicle => <><b>{vehicle.vin || "未填写车架号"}</b><small>{vehicle.model || "未填写车型"}</small></> },
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
const pageSizeOptions = [10, 20, 50, 100] as const;
const defaultPageSize = pageSizeOptions[0];

type Preferences = { order: string[]; visible: string[]; sort: string; direction: "asc" | "desc"; pageSize?: number };

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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(defaultPageSize);
  const [ready, setReady] = useState(false);
  const [draggingId, setDraggingId] = useState("");
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: "before" | "after" }>();
  const [deletingId, setDeletingId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const selectAllRef = useRef<HTMLInputElement>(null);

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
        if (pageSizeOptions.some(option => option === stored.pageSize)) setPageSize(stored.pageSize!);
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
    localStorage.setItem(storageKey, JSON.stringify({ order, visible, sort, direction, pageSize } satisfies Preferences));
  }, [direction, order, pageSize, ready, sort, storageKey, visible]);

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
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sorted.slice(pageStart, pageStart + pageSize);
  const sortedIds = useMemo(() => new Set(sorted.map(vehicle => vehicle.id)), [sorted]);
  const selectedVisibleIds = selectedIds.filter(id => sortedIds.has(id));
  const selectedPageIds = pageRows.map(vehicle => vehicle.id).filter(id => selectedIds.includes(id));
  const allVisibleSelected = pageRows.length > 0 && selectedPageIds.length === pageRows.length;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedPageIds.length > 0 && !allVisibleSelected;
  }, [allVisibleSelected, selectedPageIds.length]);

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

  function reorder(draggedId: string, targetId: string, edge: "before" | "after") {
    if (draggedId === targetId) return;
    setOrder(current => {
      const next = current.filter(id => id !== draggedId);
      const targetIndex = next.indexOf(targetId);
      if (targetIndex < 0) return current;
      next.splice(targetIndex + (edge === "after" ? 1 : 0), 0, draggedId);
      return next;
    });
  }

  function startColumnDrag(event: DragEvent<HTMLButtonElement>, id: string) {
    setDraggingId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }

  function dragOverColumn(event: DragEvent<HTMLDivElement>, id: string) {
    event.preventDefault();
    if (!draggingId || draggingId === id) {
      setDropTarget(undefined);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropTarget({ id, edge: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after" });
    event.dataTransfer.dropEffect = "move";
  }

  function dropColumn(event: DragEvent<HTMLDivElement>, targetId: string) {
    event.preventDefault();
    const draggedId = draggingId || event.dataTransfer.getData("text/plain");
    if (draggedId && dropTarget) reorder(draggedId, targetId, dropTarget.edge);
    setDraggingId("");
    setDropTarget(undefined);
  }

  function handleDragKey(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    move(id, event.key === "ArrowUp" ? -1 : 1);
  }

  function reset() {
    setOrder(defaultOrder);
    setVisible(defaultVisible);
    setSort("updatedAt");
    setDirection("desc");
    setPageSize(defaultPageSize);
    setPage(1);
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
      setSelectedIds(current => current.filter(id => id !== vehicle.id));
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "删除失败，请稍后重试");
    } finally {
      setDeletingId("");
    }
  }

  function toggleAllVisible(checked: boolean) {
    const visibleIds = pageRows.map(vehicle => vehicle.id);
    setSelectedIds(current => checked
      ? [...new Set([...current, ...visibleIds])]
      : current.filter(id => !visibleIds.includes(id)));
  }

  async function removeSelected() {
    const ids = selectedVisibleIds;
    if (!ids.length) return;
    if (!window.confirm(`确认永久删除选中的 ${ids.length} 条单据？相关提货任务、业务事件和附件也会一并删除。`)) return;
    setBulkDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch("/api/v1/vehicles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "批量删除失败");
      const deletedIds = Array.isArray(result.data?.ids) ? result.data.ids as string[] : ids;
      for (const id of deletedIds) onDeleted?.(id);
      setSelectedIds(current => current.filter(id => !deletedIds.includes(id)));
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "批量删除失败，请稍后重试");
    } finally {
      setBulkDeleting(false);
    }
  }

  return <>
    {deleteError && <p className="form-error table-error" role="alert">{deleteError}</p>}
    <div className="column-toolbar">
      {canDelete && <div className="bulk-actions"><span>已选 {selectedVisibleIds.length} 条</span><button type="button" disabled={!selectedVisibleIds.length || bulkDeleting || Boolean(deletingId)} onClick={removeSelected}><Trash2 />{bulkDeleting ? "删除中…" : "批量删除"}</button></div>}
      <label><ArrowUpDown />排序<select value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}>{columns.map(column => <option value={column.id} key={column.id}>{column.label}</option>)}</select></label>
      <button type="button" onClick={() => { setDirection(current => current === "asc" ? "desc" : "asc"); setPage(1); }}>{direction === "asc" ? <ArrowUp /> : <ArrowDown />}{direction === "asc" ? "升序" : "降序"}</button>
      <details><summary><SlidersHorizontal />显示与排列属性</summary><div className="column-picker">{order.map(id => {
        const column = columnById.get(id)!;
        const checked = visible.includes(id);
        const dropClass = dropTarget?.id === id ? ` drop-${dropTarget.edge}` : "";
        return <div key={id} className={`column-picker-item${draggingId === id ? " is-dragging" : ""}${dropClass}`} onDragOver={event => dragOverColumn(event, id)} onDrop={event => dropColumn(event, id)}><label><input type="checkbox" checked={checked} onChange={event => setVisible(current => event.target.checked ? [...current, id] : current.length > 1 ? current.filter(item => item !== id) : current)} />{column.label}</label><button type="button" className="column-drag-handle" draggable onDragStart={event => startColumnDrag(event, id)} onDragEnd={() => { setDraggingId(""); setDropTarget(undefined); }} onKeyDown={event => handleDragKey(event, id)} aria-label={`拖动排列${column.label}`} title="按住并上下拖动调整顺序"><GripVertical /></button></div>;
      })}<button type="button" className="reset-columns" onClick={reset}>恢复默认</button></div></details>
    </div>
    <div className="table-wrap"><table><thead><tr>{canDelete && <th className="row-select"><input ref={selectAllRef} type="checkbox" checked={allVisibleSelected} disabled={!pageRows.length || bulkDeleting} onChange={event => toggleAllVisible(event.target.checked)} aria-label="全选当前页" /></th>}{visibleColumns.map(column => <th key={column.id}>{column.label}</th>)}<th></th></tr></thead><tbody>{pageRows.map(vehicle => <tr key={vehicle.id} className={selectedIds.includes(vehicle.id) ? "selected-row" : undefined}>{canDelete && <td className="row-select"><input type="checkbox" checked={selectedIds.includes(vehicle.id)} disabled={bulkDeleting || deletingId === vehicle.id} onChange={event => setSelectedIds(current => event.target.checked ? [...current, vehicle.id] : current.filter(id => id !== vehicle.id))} aria-label={`选择${vehicle.vin || vehicle.model || "未命名单据"}`} /></td>}{visibleColumns.map(column => <td key={column.id}>{column.render ? column.render(vehicle) : column.value(vehicle) ?? "—"}</td>)}<td><div className="vehicle-row-actions"><Link href={`/vehicles/${vehicle.id}`}>查看 →</Link>{canDelete && <button type="button" className="vehicle-delete" disabled={bulkDeleting || deletingId === vehicle.id} onClick={() => remove(vehicle)} title="删除车辆"><Trash2 />{deletingId === vehicle.id ? "删除中" : "删除"}</button>}</div></td></tr>)}</tbody></table>{!sorted.length && <div className="empty">暂无符合条件的车辆</div>}</div>
    {sorted.length > 0 && <nav className="table-pagination" aria-label="车辆列表分页">
      <span>显示第 {pageStart + 1}–{Math.min(pageStart + pageSize, sorted.length)} 条，共 {sorted.length} 条</span>
      <label>每页<select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>{pageSizeOptions.map(option => <option value={option} key={option}>{option}</option>)}</select>条</label>
      <div>
        <button type="button" disabled={currentPage === 1} onClick={() => setPage(1)} aria-label="第一页"><ChevronsLeft /></button>
        <button type="button" disabled={currentPage === 1} onClick={() => setPage(Math.max(1, currentPage - 1))} aria-label="上一页"><ChevronLeft /></button>
        <span>第 <b>{currentPage}</b> / {totalPages} 页</span>
        <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(Math.min(totalPages, currentPage + 1))} aria-label="下一页"><ChevronRight /></button>
        <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(totalPages)} aria-label="最后一页"><ChevronsRight /></button>
      </div>
    </nav>}
  </>;
}
