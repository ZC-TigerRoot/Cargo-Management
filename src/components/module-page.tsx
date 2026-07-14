"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { Download, FileSpreadsheet, Menu, Plus, Search, UploadCloud } from "lucide-react";
import SideNav from "./side-nav";
import VehicleFormModal from "./vehicle-form-modal";
import { inventoryDays, type BusinessType, type VehicleRecord } from "@/lib/domain";
import { useVehicleRecords } from "@/lib/use-vehicle-records";

type Kind = "vehicles" | "overseas" | "domestic" | "pickups" | "imports" | "reports" | "users" | "settings";
const meta: Record<Kind, { eyebrow: string; title: string; description: string }> = {
  vehicles: { eyebrow: "车辆中心", title: "车辆台账", description: "查询全部车辆及其当前库存状态" },
  overseas: { eyebrow: "海外业务", title: "海外仓业务", description: "按提单管理港口、船期、保税入库与放车节点" },
  domestic: { eyebrow: "国内业务", title: "国内仓储", description: "按 PO 管理车辆入仓、放车、出库与签收" },
  pickups: { eyebrow: "现场协同", title: "提货任务", description: "生成司机二维码并跟进提车签收" },
  imports: { eyebrow: "数据迁移", title: "导入记录", description: "预校验 Excel 并处理异常数据" },
  reports: { eyebrow: "分析中心", title: "库存报表", description: "查看库存账龄、仓库分布与出入库趋势" },
  users: { eyebrow: "系统管理", title: "账号与权限", description: "管理用户角色和业务数据范围" },
  settings: { eyebrow: "系统管理", title: "基础设置", description: "维护仓库、客户与业务字典" },
};

export default function ModulePage({ kind }: { kind: Kind }) {
  const [mobile, setMobile] = useState(false);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(false);
  const m = meta[kind];
  const type: BusinessType | undefined = kind === "overseas" ? "overseas" : kind === "domestic" ? "domestic" : undefined;
  const { records, saveRecord, usingDemoData } = useVehicleRecords();
  const rows = useMemo(() => records.filter(vehicle =>
    (!type || vehicle.type === type) && `${vehicle.vin}${vehicle.model}${vehicle.referenceNo}${vehicle.customer}`.toLowerCase().includes(q.toLowerCase()),
  ), [records, q, type]);
  const recordModule = ["vehicles", "overseas", "domestic"].includes(kind);

  return <div className="app-shell">
    <SideNav open={mobile} onClose={() => setMobile(false)} />
    <main className="main">
      <header className="topbar">
        <button className="menu" onClick={() => setMobile(true)}><Menu /></button>
        <div><p>{m.eyebrow}</p><h1>{m.title}</h1></div>
        <div className="top-actions">
          {["vehicles", "overseas", "domestic", "reports"].includes(kind) && <a href="/api/v1/export" className="secondary-button"><Download />导出</a>}
          {["vehicles", "overseas", "domestic", "pickups"].includes(kind) && <button className="primary-button" onClick={() => recordModule && setModal(true)}><Plus />{kind === "pickups" ? "创建任务" : "新增记录"}</button>}
        </div>
      </header>
      <section className="content">
        <div className="module-heading"><div><p className="eyebrow">{m.eyebrow}</p><h2>{m.title}</h2><p>{m.description}</p></div></div>
        {recordModule && usingDemoData && <p className="data-warning">当前显示演示数据；连接数据库后，新增和编辑记录将自动持久化。</p>}
        {recordModule && <VehicleModule rows={rows} q={q} setQ={setQ} />}
        {kind === "pickups" && <PickupModule />}
        {kind === "imports" && <ImportModule />}
        {kind === "reports" && <ReportModule />}
        {kind === "users" && <UsersModule />}
        {kind === "settings" && <SettingsModule />}
      </section>
    </main>
    {modal && <VehicleFormModal defaultType={type} onClose={() => setModal(false)} onSaved={saveRecord} />}
  </div>;
}

function VehicleModule({ rows, q, setQ }: { rows: VehicleRecord[]; q: string; setQ: (value: string) => void }) {
  return <article className="panel table-panel module-panel">
    <div className="filters"><label className="search"><Search /><input value={q} onChange={event => setQ(event.target.value)} placeholder="搜索车架号、车型、提单 / PO、客户…" /></label><span className="result-count">共 {rows.length} 辆</span></div>
    <div className="table-wrap"><table><thead><tr><th>车辆</th><th>提单 / PO</th><th>仓库</th><th>客户</th><th>库存天数</th><th>状态</th><th></th></tr></thead><tbody>{rows.map(vehicle => <tr key={vehicle.id}><td><b>{vehicle.model}</b><small>{vehicle.vin}</small></td><td>{vehicle.referenceNo}</td><td>{vehicle.warehouse}<small>{vehicle.warehouseLocation}</small></td><td>{vehicle.customer}</td><td>{inventoryDays(vehicle.inboundAt, vehicle.outboundAt)} 天</td><td><span className={`status status-${vehicle.status}`}>{vehicle.status}</span></td><td><Link href={`/vehicles/${vehicle.id}`}>查看 →</Link></td></tr>)}</tbody></table>{!rows.length && <div className="empty">暂无符合条件的车辆</div>}</div>
  </article>;
}

function PickupModule() {
  return <div className="module-cards"><article className="panel action-card"><span>进行中</span><h3>PU-20260714-008</h3><p>星越 L · ···127654</p><small>二维码有效至 2026-07-15 18:00</small><Link href="/driver/demo-pickup">打开司机签收页 →</Link></article><article className="panel action-card"><span>待创建</span><h3>2 辆车等待提货</h3><p>BL-2026-0712</p><small>迪拜杰贝阿里保税仓</small><button className="primary-button">生成提货二维码</button></article></div>;
}

type PreviewResult = {
  fileName: string;
  businessType: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  missingHeaders: string[];
  errors: { row: number; vin?: unknown; errors: string[] }[];
};

function ImportModule() {
  const [file, setFile] = useState<File>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PreviewResult>();

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setLoading(true);
    setError("");
    setResult(undefined);
    const body = new FormData();
    body.set("file", file);
    try {
      const response = await fetch("/api/v1/import/preview", { method: "POST", body });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message || "预校验失败");
      setResult(json.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "预校验失败");
    } finally {
      setLoading(false);
    }
  }

  return <article className="panel import-box">
    <UploadCloud /><h3>上传 Excel 进行预校验</h3><p>自动识别海外仓 23 列或国内仓 17 列标准模板</p>
    <form onSubmit={preview}>
      <label className="secondary-button">选择文件<input type="file" accept=".xlsx,.xls" onChange={event => setFile(event.target.files?.[0])} /></label>
      {file && <button className="primary-button" disabled={loading}>{loading ? "校验中…" : "提交预校验"}</button>}
    </form>
    {file && <div className="file-selected"><FileSpreadsheet />已选择 {file.name}</div>}
    {error && <p className="form-error">{error}</p>}
    {result && <div className="import-result">
      <h4>{result.businessType}：{result.validRows} / {result.totalRows} 行可导入</h4>
      {!!result.missingHeaders.length && <p>缺少列：{result.missingHeaders.join("、")}</p>}
      {result.errors.slice(0, 10).map(item => <p key={item.row}>第 {item.row} 行（{String(item.vin || "无车架号")}）：{item.errors.join("；")}</p>)}
    </div>}
  </article>;
}

function ReportModule() {
  return <div className="report-grid"><article className="panel report-card"><span>实时在库</span><strong>2</strong><p>海外仓 1 · 国内仓 1</p></article><article className="panel report-card"><span>平均库存天数</span><strong>12.4</strong><p>较上月减少 2.1 天</p></article><article className="panel report-card"><span>30 天以上</span><strong>1</strong><p>需要业务跟进</p></article><article className="panel age-panel report-wide"><h3>库存账龄分布</h3><div className="age-bars">{[["0–7天", 62], ["8–15天", 38], ["16–30天", 23], ["30天以上", 10]].map(([name, width]) => <div key={name}><span>{name}</span><div><i className="green" style={{ width: `${width}%` }} /></div><b>{Math.ceil(Number(width) / 10)}</b></div>)}</div></article></div>;
}

function UsersModule() {
  return <article className="panel simple-list">{[["林晓", "lin@example.com", "货代 / 操作管理"], ["Ahmed", "ahmed@example.com", "仓管员"], ["王经理", "wang@example.com", "经理 / 业务"]].map(user => <div key={user[1]}><span className="avatar">{user[0][0]}</span><p><b>{user[0]}</b><small>{user[1]}</small></p><span className="role-pill">{user[2]}</span><button>管理</button></div>)}</article>;
}

function SettingsModule() {
  return <div className="module-cards"><article className="panel settings-card"><h3>仓库管理</h3><p>3 个仓库 · 1 个海外保税仓</p><button className="secondary-button">管理仓库</button></article><article className="panel settings-card"><h3>客户管理</h3><p>4 个业务客户</p><button className="secondary-button">管理客户</button></article><article className="panel settings-card"><h3>业务字典</h3><p>状态、港口、车型等标准值</p><button className="secondary-button">管理字典</button></article></div>;
}
