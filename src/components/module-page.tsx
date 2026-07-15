"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { Download, FileSpreadsheet, Menu, Plus, Search, UploadCloud } from "lucide-react";
import SideNav from "./side-nav";
import VehicleFormModal from "./vehicle-form-modal";
import VehicleTable from "./vehicle-table";
import { can, inventoryDays, roleLabels, type BusinessType, type VehicleRecord } from "@/lib/domain";
import { useVehicleRecords } from "@/lib/use-vehicle-records";
import { useSession } from "@/lib/use-session";
import { CHINA_TIME_ZONE, chinaDateTime, localInputValue, zonedLocalToIso } from "@/lib/datetime";

type Kind = "vehicles" | "overseas" | "domestic" | "pickups" | "imports" | "reports" | "settings";
const meta: Record<Kind, { eyebrow: string; title: string; description: string }> = {
  vehicles: { eyebrow: "车辆中心", title: "车辆台账", description: "查询全部车辆及其当前库存状态" },
  overseas: { eyebrow: "海外业务", title: "海外仓业务", description: "按提单管理港口、船期、保税入库与放车节点" },
  domestic: { eyebrow: "国内业务", title: "国内仓储", description: "按 PO 管理车辆入仓、放车、出库与签收" },
  pickups: { eyebrow: "现场协同", title: "提货任务", description: "生成司机二维码并跟进提车签收" },
  imports: { eyebrow: "数据迁移", title: "导入记录", description: "预校验 Excel 并处理异常数据" },
  reports: { eyebrow: "分析中心", title: "库存报表", description: "查看库存账龄、仓库分布与出入库趋势" },
  settings: { eyebrow: "系统管理", title: "基础设置", description: "查看仓库与客户主数据" },
};

export default function ModulePage({ kind }: { kind: Kind }) {
  const [mobile, setMobile] = useState(false);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(false);
  const { user } = useSession();
  const m = meta[kind];
  const type: BusinessType | undefined = kind === "overseas" ? "overseas" : kind === "domestic" ? "domestic" : undefined;
  const { records, saveRecord, loadError } = useVehicleRecords();
  const rows = useMemo(() => records.filter(vehicle =>
    (!type || vehicle.type === type) && `${vehicle.vin}${vehicle.model}${vehicle.referenceNo}${vehicle.customer}${vehicle.warehouse}${vehicle.inboundBoeNo ?? ""}${vehicle.outboundBoeNo ?? ""}${vehicle.outboundBoeTitle ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  ), [records, q, type]);
  const recordModule = ["vehicles", "overseas", "domestic"].includes(kind);
  const role = user?.role ?? "customer";

  return <div className="app-shell">
    <SideNav open={mobile} onClose={() => setMobile(false)} role={role} roleLabel={roleLabels[role]} userName={user?.name}/>
    <main className="main">
      <header className="topbar">
        <button className="menu" onClick={() => setMobile(true)} aria-label="打开菜单"><Menu /></button>
        <div><p>{m.eyebrow}</p><h1>{m.title}</h1></div>
        <div className="top-actions">
          {["vehicles", "overseas", "domestic", "reports"].includes(kind) && can(role, "export") && <a href="/api/v1/export" className="secondary-button"><Download />导出</a>}
          {recordModule && can(role, "create") && <button className="primary-button" onClick={() => setModal(true)}><Plus />新增记录</button>}
        </div>
      </header>
      <section className="content">
        <div className="module-heading"><div><p className="eyebrow">{m.eyebrow}</p><h2>{m.title}</h2><p>{m.description}</p></div></div>
        {recordModule && loadError && <p className="form-error">{loadError}</p>}
        {recordModule && <VehicleModule rows={rows} q={q} setQ={setQ} />}
        {kind === "pickups" && <PickupModule records={records} canCreate={can(role, "create")} />}
        {kind === "imports" && <ImportModule />}
        {kind === "reports" && <ReportModule records={records} />}
        {kind === "settings" && <SettingsModule />}
      </section>
    </main>
    {modal && <VehicleFormModal defaultType={type} onClose={() => setModal(false)} onSaved={saveRecord} />}
  </div>;
}

function VehicleModule({ rows, q, setQ }: { rows: VehicleRecord[]; q: string; setQ: (value: string) => void }) {
  return <article className="panel table-panel module-panel">
    <div className="filters"><label className="search"><Search /><input value={q} onChange={event => setQ(event.target.value)} placeholder="搜索车架号、车型、提单 / PO、客户…" /></label><span className="result-count">共 {rows.length} 辆</span></div>
    <VehicleTable rows={rows} storageKey="cargo.module-vehicle-table" />
  </article>;
}

type PickupTask = {
  id: string; taskNo: string; expiresAt: string; createdAt: string; status: "pending" | "submitted" | "expired" | "revoked";
  tokenPath: string; pickupUrl: string;
  vehicles: { id: string; vin: string; model: string }[];
};

type PickupQr = { taskNo: string; url: string; qr: string };

function expiryDefault() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return localInputValue(date.toISOString(), CHINA_TIME_ZONE);
}

function PickupModule({ records, canCreate }: { records: VehicleRecord[]; canCreate: boolean }) {
  const [tasks, setTasks] = useState<PickupTask[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState(expiryDefault);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pickupQr, setPickupQr] = useState<PickupQr>();
  const eligible = records.filter(vehicle => !vehicle.outboundAt && ["在库", "待放车", "待提货"].includes(vehicle.status));

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

  const statusName = { pending: "进行中", submitted: "已签收", expired: "已过期", revoked: "已撤销" };
  return <div className="pickup-layout">
    <article className="panel pickup-create"><h3>{canCreate ? "创建提货二维码" : "查看提货二维码"}</h3>{canCreate && <form onSubmit={createTask}><div className="pickup-vehicles">{eligible.map(vehicle => <label key={vehicle.id}><input type="checkbox" checked={selected.includes(vehicle.id)} onChange={event => setSelected(current => event.target.checked ? [...current, vehicle.id] : current.filter(id => id !== vehicle.id))}/><span><b>{vehicle.model}</b><small>{vehicle.vin} · {vehicle.warehouse}</small></span></label>)}{!eligible.length && <p className="muted">暂无可创建提货任务的车辆</p>}</div><label className="expiry-field">二维码有效期<input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} required/></label><button className="primary-button" disabled={loading || !selected.length}>{loading ? "创建中…" : "生成提货二维码"}</button></form>}{pickupQr ? <div className="qr-result"><b>{pickupQr.taskNo}</b><Image src={pickupQr.qr} width={180} height={180} unoptimized alt="司机提货二维码"/><div className="qr-actions"><a href={pickupQr.url} target="_blank" rel="noreferrer">打开签收页</a><a href={pickupQr.qr} download={`${pickupQr.taskNo}-二维码.png`}>下载二维码</a></div><p>{pickupQr.url}</p><small>此二维码可随时从右侧任务中重新查看。</small></div> : !canCreate && <p className="muted">请从右侧任务中选择“查看二维码”。</p>}{error && <p className="form-error">{error}</p>}</article>
    <div className="module-cards pickup-cards">{tasks.map(task => <article className="panel action-card" key={task.id}><span>{statusName[task.status]}</span><h3>{task.taskNo}</h3><p>{task.vehicles.map(vehicle => vehicle.model).join("、")}</p><small>{task.vehicles.map(vehicle => `···${vehicle.vin.slice(-6)}`).join(" · ")}<br/>有效至 {chinaDateTime(task.expiresAt)}</small><button type="button" className="task-qr-button" onClick={() => showTaskQr(task)}>查看二维码</button></article>)}{!tasks.length && !error && <p className="muted">暂无提货任务</p>}</div>
  </div>;
}

type PreviewResult = { fileName: string; businessType: string; totalRows: number; validRows: number; invalidRows: number; missingHeaders: string[]; errors: { row: number; vin?: unknown; errors: string[] }[] };

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
  return <article className="panel import-box"><UploadCloud/><h3>上传 Excel 进行预校验</h3><p>自动识别海外仓或国内仓，缺少的标准列和单元格按空值处理，文件最大 10 MB</p><form onSubmit={preview}><label className="secondary-button">选择文件<input type="file" accept=".xlsx,.xls" onChange={event => setFile(event.target.files?.[0])}/></label>{file && <button className="primary-button" disabled={loading}>{loading ? "校验中…" : "提交预校验"}</button>}</form>{file && <div className="file-selected"><FileSpreadsheet/>已选择 {file.name}</div>}{error && <p className="form-error">{error}</p>}{result && <div className="import-result"><h4>{result.businessType}：{result.validRows} / {result.totalRows} 行可导入</h4>{result.missingHeaders.length > 0 && <p>以下缺失列已按空值处理：{result.missingHeaders.join("、")}</p>}{result.errors.slice(0, 10).map(item => <p key={item.row}>第 {item.row} 行（{String(item.vin || "无车架号")}）：{item.errors.join("；")}</p>)}</div>}</article>;
}

function ReportModule({ records }: { records: VehicleRecord[] }) {
  const inStorage = records.filter(vehicle => !vehicle.outboundAt && vehicle.status !== "待入库");
  const days = inStorage.map(vehicle => inventoryDays(vehicle.inboundAt));
  const average = days.length ? (days.reduce((sum, value) => sum + value, 0) / days.length).toFixed(1) : "0.0";
  const buckets = [["0–7天", 0, 7], ["8–15天", 8, 15], ["16–30天", 16, 30], ["30天以上", 31, Infinity]] as const;
  const counts = buckets.map(([name, min, max]) => ({ name, count: days.filter(value => value >= min && value <= max).length }));
  const max = Math.max(1, ...counts.map(item => item.count));
  return <div className="report-grid"><article className="panel report-card"><span>实时在库/在途</span><strong>{inStorage.length}</strong><p>按当前车辆台账计算</p></article><article className="panel report-card"><span>平均库存天数</span><strong>{average}</strong><p>仅统计未出库车辆</p></article><article className="panel report-card"><span>30 天以上</span><strong>{counts[3].count}</strong><p>需要业务跟进</p></article><article className="panel age-panel report-wide"><h3>库存账龄分布</h3><div className="age-bars">{counts.map(item => <div key={item.name}><span>{item.name}</span><div><i className="green" style={{ width: `${item.count / max * 100}%` }}/></div><b>{item.count}</b></div>)}</div></article></div>;
}

type SettingsData = { publicBaseUrl: string; warehouses: { id: string; name: string; location: string; bonded: boolean }[]; customers: { id: string; name: string; vehicleCount: number }[] };
function SettingsModule() {
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
  return <div><div className="module-cards"><article className="panel settings-card settings-domain-card"><h3>提货链接当前域名</h3><p>用于生成司机签收链接和二维码，请填写司机手机能够访问的完整域名。</p><form className="settings-form" onSubmit={savePublicBaseUrl}><label>当前域名<input type="url" value={data.publicBaseUrl} onChange={event => setData(current => ({ ...current, publicBaseUrl: event.target.value }))} placeholder="https://cargo.example.com" required/></label><button className="primary-button" disabled={saving}>{saving ? "保存中…" : "保存域名"}</button></form>{message && <p className="form-success">{message}</p>}</article><article className="panel settings-card"><h3>仓库主数据</h3>{data.warehouses.map(warehouse => <p key={warehouse.id}><b>{warehouse.name}</b><br/>{warehouse.location} · {warehouse.bonded ? "保税仓" : "普通仓"}</p>)}</article><article className="panel settings-card"><h3>客户主数据</h3>{data.customers.map(customer => <p key={customer.id}><b>{customer.name}</b> · {customer.vehicleCount} 辆车</p>)}</article></div>{error && <p className="form-error">{error}</p>}</div>;
}
