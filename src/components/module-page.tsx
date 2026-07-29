"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { Download, FileSpreadsheet, Menu, Plus, Search, UploadCloud } from "lucide-react";
import SideNav from "./side-nav";
import VehicleFilterBar from "./vehicle-filter-bar";
import VehicleFormModal from "./vehicle-form-modal";
import VehiclePivotReport from "./vehicle-pivot-report";
import VehicleTable from "./vehicle-table";
import { can, roleLabels, type BusinessType, type VehicleRecord } from "@/lib/domain";
import { useVehicleRecords } from "@/lib/use-vehicle-records";
import { useSession } from "@/lib/use-session";
import { CHINA_TIME_ZONE, chinaDateTime, localInputValue, zonedLocalToIso } from "@/lib/datetime";
import { matchesPickupSearch, pickupTaskMatchesSearch, pickupVehicleSearchValues } from "@/lib/pickup-search";
import { createVehicleFilters, filterVehicleRecords, vehicleExportUrl, type VehicleFilters } from "@/lib/vehicle-filters";

type Kind = "vehicles" | "overseas" | "domestic" | "pickups" | "imports" | "reports" | "settings";
const meta: Record<Kind, { eyebrow: string; title: string; description: string }> = {
  vehicles: { eyebrow: "车辆中心", title: "车辆台账", description: "查询全部车辆及其当前库存状态" },
  overseas: { eyebrow: "海外业务", title: "海外仓业务", description: "按提单管理港口、船期、保税入库与放车节点" },
  domestic: { eyebrow: "国内业务", title: "国内仓储", description: "按 PO 管理车辆入仓、放车、出库与签收" },
  pickups: { eyebrow: "现场协同", title: "提货任务", description: "生成司机二维码并跟进提车签收" },
  imports: { eyebrow: "数据迁移", title: "导入记录", description: "预校验 Excel 并处理异常数据" },
  reports: { eyebrow: "分析中心", title: "库存报表", description: "按客户、仓库与放车进度查看实时库存透视统计" },
  settings: { eyebrow: "系统管理", title: "基础设置", description: "查看仓库与客户主数据" },
};

export default function ModulePage({ kind }: { kind: Kind }) {
  const [mobile, setMobile] = useState(false);
  const [filters, setFilters] = useState<VehicleFilters>(createVehicleFilters);
  const [modal, setModal] = useState(false);
  const { user } = useSession();
  const m = meta[kind];
  const type: BusinessType | undefined = kind === "overseas" ? "overseas" : kind === "domestic" ? "domestic" : undefined;
  const { records, saveRecord, removeRecord, loading, loadError } = useVehicleRecords();
  const scopedRecords = useMemo(() => type ? records.filter(vehicle => vehicle.type === type) : records, [records, type]);
  const effectiveFilters = useMemo(() => type ? { ...filters, type } : filters, [filters, type]);
  const rows = useMemo(() => filterVehicleRecords(scopedRecords, effectiveFilters), [effectiveFilters, scopedRecords]);
  const exportHref = vehicleExportUrl(effectiveFilters);
  const recordModule = ["vehicles", "overseas", "domestic"].includes(kind);
  const role = user?.role ?? "customer";

  return <div className="app-shell">
    <SideNav open={mobile} onClose={() => setMobile(false)} role={role} roleLabel={roleLabels[role]} userName={user?.name}/>
    <main className="main">
      <header className="topbar">
        <button className="menu" onClick={() => setMobile(true)} aria-label="打开菜单"><Menu /></button>
        <div><p>{m.eyebrow}</p><h1>{m.title}</h1></div>
        <div className="top-actions">
          {["vehicles", "overseas", "domestic", "reports"].includes(kind) && can(role, "export") && <a href={exportHref} className="secondary-button"><Download />导出筛选结果（{rows.length}）</a>}
          {recordModule && can(role, "create") && <button className="primary-button" onClick={() => setModal(true)}><Plus />新增记录</button>}
        </div>
      </header>
      <section className="content">
        <div className="module-heading"><div><p className="eyebrow">{m.eyebrow}</p><h2>{m.title}</h2><p>{m.description}</p></div></div>
        {(recordModule || kind === "reports") && loadError && <p className="form-error">{loadError}</p>}
        {recordModule && <VehicleModule records={scopedRecords} rows={rows} filters={filters} setFilters={setFilters} lockedType={type} canDelete={can(role, "delete")} onDeleted={removeRecord} />}
        {kind === "pickups" && <PickupModule records={records} canCreate={can(role, "create")} />}
        {kind === "imports" && <ImportModule />}
        {kind === "reports" && loading && <article className="panel report-loading">正在读取车辆数据…</article>}
        {kind === "reports" && !loading && !loadError && <><article className="panel report-filter-panel"><VehicleFilterBar records={records} filters={filters} onChange={setFilters}/></article><VehiclePivotReport records={rows}/></>}
        {kind === "settings" && <SettingsModule canEditPublicUrl={can(role, "managePublicUrl")} />}
      </section>
    </main>
    {modal && <VehicleFormModal defaultType={type} onClose={() => setModal(false)} onSaved={saveRecord} />}
  </div>;
}

function VehicleModule({ records, rows, filters, setFilters, lockedType, canDelete, onDeleted }: { records: VehicleRecord[]; rows: VehicleRecord[]; filters: VehicleFilters; setFilters: (filters: VehicleFilters) => void; lockedType?: BusinessType; canDelete: boolean; onDeleted: (id: string) => void }) {
  return <article className="panel table-panel module-panel">
    <VehicleFilterBar records={records} filters={filters} onChange={setFilters} lockedType={lockedType}/>
    <VehicleTable rows={rows} storageKey="cargo.module-vehicle-table" canDelete={canDelete} onDeleted={onDeleted} />
  </article>;
}

type PickupTask = {
  id: string; taskNo: string; expiresAt: string; createdAt: string; status: "pending" | "submitted" | "expired" | "revoked";
  tokenPath: string; pickupUrl: string;
  vehicles: { id: string; vin?: string; model?: string }[];
};

type PickupQr = { taskNo: string; url: string; qr: string };

function expiryDefault() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return localInputValue(date.toISOString(), CHINA_TIME_ZONE);
}

function PickupModule({ records, canCreate }: { records: VehicleRecord[]; canCreate: boolean }) {
  const [tasks, setTasks] = useState<PickupTask[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [expiresAt, setExpiresAt] = useState(expiryDefault);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pickupQr, setPickupQr] = useState<PickupQr>();
  const eligible = records.filter(vehicle => !vehicle.outboundAt && ["在库", "待放车", "待提货"].includes(vehicle.status));
  const recordById = useMemo(() => new Map(records.map(vehicle => [vehicle.id, vehicle])), [records]);
  const filteredEligible = eligible.filter(vehicle => matchesPickupSearch(pickupVehicleSearchValues(vehicle), query));
  const filteredTasks = tasks.filter(task => pickupTaskMatchesSearch(task, recordById, query));

  useEffect(() => {
    fetch("/api/v1/pickups").then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "无法读取提货任务");
      setTasks(result.data);
    }).catch(reason => setError(reason instanceof Error ? reason.message : "无法读取提货任务"));
  }, []);

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setPickupQr(undefined);
    try {
      const response = await fetch("/api/v1/pickups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleIds: selected, expiresAt: zonedLocalToIso(expiresAt, CHINA_TIME_ZONE) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "创建提货任务失败");
      setPickupQr({ taskNo: result.data.taskNo, url: result.data.pickupUrl, qr: await QRCode.toDataURL(result.data.pickupUrl, { width: 220, margin: 1 }) });
      setTasks(current => [result.data, ...current]);
      setSelected([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建提货任务失败");
    } finally {
      setLoading(false);
    }
  }

  async function showTaskQr(task: PickupTask) {
    setError("");
    try {
      setPickupQr({ taskNo: task.taskNo, url: task.pickupUrl, qr: await QRCode.toDataURL(task.pickupUrl, { width: 220, margin: 1 }) });
    } catch {
      setError("无法生成二维码，请检查当前域名设置");
    }
  }

  async function revokeTask(task: PickupTask) {
    if (!window.confirm(`确认撤销提货任务“${task.taskNo}”？原二维码将立即失效。`)) return;
    setError("");
    try {
      const response = await fetch("/api/v1/pickups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, action: "revoke" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "撤销提货任务失败");
      setTasks(current => current.map(item => item.id === task.id ? { ...item, status: "revoked" } : item));
      if (pickupQr?.taskNo === task.taskNo) setPickupQr(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "撤销提货任务失败");
    }
  }

  const statusName = { pending: "进行中", submitted: "已签收", expired: "已过期", revoked: "已撤销" };
  return <div className="pickup-layout">
    <div className="panel pickup-search-toolbar"><label className="search"><Search/><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索任务号、提单号 / PO、车架号、车型、客户或仓库…" aria-label="搜索提货二维码车辆"/></label><span>{query.trim() ? "找到" : "共"} {filteredEligible.length} 辆可生成 · {filteredTasks.length} 个已有任务</span></div>
    <article className="panel pickup-create"><h3>{canCreate ? "创建提货二维码" : "查看提货二维码"}</h3>{canCreate && <form onSubmit={createTask}><div className="pickup-vehicles">{filteredEligible.map(vehicle => <label key={vehicle.id}><input type="checkbox" checked={selected.includes(vehicle.id)} onChange={event => setSelected(current => event.target.checked ? [...current, vehicle.id] : current.filter(id => id !== vehicle.id))}/><span><b>{vehicle.model || "未填写车型"}</b><small>{vehicle.referenceNo || "未填写提单号 / PO"} · {vehicle.vin || "未填写车架号"}<br/>{vehicle.customer || "未填写客户"} · {vehicle.warehouse || "未填写仓库"}</small></span></label>)}{!filteredEligible.length && <p className="muted">{query.trim() ? "没有找到可生成二维码的车辆" : "暂无可创建提货任务的车辆"}</p>}</div><label className="expiry-field">二维码有效期<input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} required/></label><button className="primary-button" disabled={loading || !selected.length}>{loading ? "创建中…" : `生成提货二维码${selected.length ? `（已选 ${selected.length} 辆）` : ""}`}</button></form>}{pickupQr ? <div className="qr-result"><b>{pickupQr.taskNo}</b><Image src={pickupQr.qr} width={180} height={180} unoptimized alt="司机提货二维码"/><div className="qr-actions"><a href={pickupQr.url} target="_blank" rel="noreferrer">打开签收页</a><a href={pickupQr.qr} download={`${pickupQr.taskNo}-二维码.png`}>下载二维码</a></div><p>{pickupQr.url}</p><small>此二维码可随时从右侧任务中重新查看。</small></div> : !canCreate && <p className="muted">请从右侧任务中选择“查看二维码”。</p>}{error && <p className="form-error">{error}</p>}</article>
    <div className="module-cards pickup-cards">{filteredTasks.map(task => {
      const references = [...new Set(task.vehicles.flatMap(vehicle => {
        const referenceNo = recordById.get(vehicle.id)?.referenceNo;
        return referenceNo ? [referenceNo] : [];
      }))];
      return <article className="panel action-card" key={task.id}><span>{statusName[task.status]}</span><h3>{task.taskNo}</h3><p>{task.vehicles.map(vehicle => vehicle.model || "未填写车型").join("、")}</p><small>{references.length ? <>单号 {references.join(" · ")}<br/></> : null}{task.vehicles.map(vehicle => vehicle.vin ? `···${vehicle.vin.slice(-6)}` : "未填写车架号").join(" · ")}<br/>有效至 {chinaDateTime(task.expiresAt)}</small><button type="button" className="task-qr-button" onClick={() => showTaskQr(task)}>查看二维码</button>{task.status === "pending" && canCreate && <button type="button" className="task-qr-button" onClick={() => revokeTask(task)}>撤销二维码</button>}</article>;
    })}{!filteredTasks.length && !error && <p className="muted">{query.trim() ? "没有找到已有二维码任务" : "暂无提货任务"}</p>}</div>
  </div>;
}

type PreviewResult = { fileName: string; businessType: string; totalRows: number; validRows: number; invalidRows: number; createRows: number; updateRows: number; previewToken?: string; missingHeaders: string[]; ignoredColumns: string[]; importedRows?: number; createdRows?: number; updatedRows?: number; failedRows?: number; errors: { row: number; vin?: unknown; errors: string[] }[] };

function ImportModule() {
  const [file, setFile] = useState<File>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PreviewResult>();
  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setLoading(true); setError(""); setResult(undefined);
    const body = new FormData(); body.set("file", file);
    try {
      const response = await fetch("/api/v1/import/preview", { method: "POST", body });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message || "预校验失败");
      setResult(json.data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "预校验失败"); }
    finally { setLoading(false); }
  }
  async function importRows() {
    if (!file || !result?.validRows || !result.previewToken) return;
    setLoading(true); setError("");
    const body = new FormData(); body.set("file", file); body.set("previewToken", result.previewToken);
    try {
      const response = await fetch("/api/v1/import", { method: "POST", body });
      const json = await response.json();
      if (!response.ok) {
        if (response.status === 409 && json.data) { setResult(json.data); setError(json.message || "部分车辆数据已变化，请重新预校验"); return; }
        if (response.status === 409) setResult(undefined);
        throw new Error(json.message || "导入失败");
      }
      setResult(json.data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "导入失败"); }
    finally { setLoading(false); }
  }
  return <article className="panel import-box"><UploadCloud/><h3>上传 Excel 进行预校验</h3><p>已有车辆按车架号增量更新，只覆盖有值的单元格；文件最大 10 MB</p><form onSubmit={preview}><label className="secondary-button">选择文件<input type="file" accept=".xlsx,.xls" onChange={event => { setFile(event.target.files?.[0]); setResult(undefined); setError(""); }}/></label>{file && <button className="primary-button" disabled={loading}>{loading ? "处理中…" : "提交预校验"}</button>}</form>{file && <div className="file-selected"><FileSpreadsheet/>已选择 {file.name}</div>}{error && <p className="form-error">{error}</p>}{result && <div className="import-result"><h4>{result.businessType}：{result.validRows} / {result.totalRows} 行可处理</h4><p>其中新增 {result.createRows} 行，更新 {result.updateRows} 行。</p>{result.importedRows !== undefined && <p className="import-success">已成功新增 {result.createdRows ?? 0} 行、更新 {result.updatedRows ?? 0} 行；{result.failedRows || 0} 行未处理。</p>}{result.missingHeaders.length > 0 && <p>以下缺失列不会导入，更新已有车辆时保留原值：{result.missingHeaders.join("、")}</p>}{result.ignoredColumns.length > 0 && <p>以下内容不会导入：{result.ignoredColumns.join("、")}。</p>}{result.errors.length > 0 && <div className="import-errors"><b>无法处理的行与原因</b>{result.errors.map(item => <p key={`${item.row}-${String(item.vin)}`}>第 {item.row} 行（{String(item.vin || "无车架号")}）：{item.errors.join("；")}</p>)}</div>}{result.importedRows === undefined && <button type="button" className="primary-button import-button" disabled={loading || result.validRows === 0} onClick={importRows}>{loading ? "处理中…" : `处理 ${result.validRows} 行有效数据`}</button>}</div>}</article>;
}

type SettingsData = { publicBaseUrl: string; warehouses: { id: string; name: string; location: string; bonded: boolean }[]; customers: { id: string; name: string; vehicleCount: number }[] };
function SettingsModule({ canEditPublicUrl }: { canEditPublicUrl: boolean }) {
  const [data, setData] = useState<SettingsData>({ publicBaseUrl: "", warehouses: [], customers: [] });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { fetch("/api/v1/settings").then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.message); setData(result.data); }).catch(reason => setError(reason.message || "无法读取基础设置")); }, []);
  async function savePublicBaseUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/v1/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publicBaseUrl: data.publicBaseUrl }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "保存失败");
      setData(current => ({ ...current, publicBaseUrl: result.data.publicBaseUrl }));
      setMessage("当前域名已保存，重新打开提货任务页后，新建和已有任务二维码都会使用该域名。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  return <div><div className="module-cards"><article className="panel settings-card settings-domain-card"><h3>提货链接当前域名</h3><p>用于生成司机签收链接和二维码，请填写司机手机能够访问的完整域名。</p><form className="settings-form" onSubmit={savePublicBaseUrl}><label>当前域名<input type="url" value={data.publicBaseUrl} onChange={event => setData(current => ({ ...current, publicBaseUrl: event.target.value }))} placeholder="https://cargo.example.com" readOnly={!canEditPublicUrl} required/></label>{canEditPublicUrl && <button className="primary-button" disabled={saving}>{saving ? "保存中…" : "保存域名"}</button>}</form>{!canEditPublicUrl && <p className="muted">只有管理员可以修改提货链接域名。</p>}{message && <p className="form-success">{message}</p>}</article><article className="panel settings-card"><h3>仓库主数据</h3>{data.warehouses.map(warehouse => <p key={warehouse.id}><b>{warehouse.name}</b><br/>{warehouse.location} · {warehouse.bonded ? "保税仓" : "普通仓"}</p>)}</article><article className="panel settings-card"><h3>客户主数据</h3>{data.customers.map(customer => <p key={customer.id}><b>{customer.name}</b> · {customer.vehicleCount} 辆车</p>)}</article></div>{error && <p className="form-error">{error}</p>}</div>;
}
