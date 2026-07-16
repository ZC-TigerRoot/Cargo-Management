"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, CarFront, CircleAlert, Download, LogOut, Menu, Plus, QrCode, Search, Warehouse } from "lucide-react";
import { can, inventoryDays, roleLabels } from "@/lib/domain";
import { CHINA_TIME_ZONE, localInputValue } from "@/lib/datetime";
import { useVehicleRecords } from "@/lib/use-vehicle-records";
import { useSession } from "@/lib/use-session";
import SideNav from "@/components/side-nav";
import VehicleFormModal from "@/components/vehicle-form-modal";
import VehicleTable from "@/components/vehicle-table";

const statusFilters = ["全部", "在库", "待提货", "待签收", "已完成", "异常"];

export default function Dashboard() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("全部");
  const [type, setType] = useState("all");
  const [modal, setModal] = useState(false);
  const [mobile, setMobile] = useState(false);
  const { user } = useSession();
  const { records: rows, saveRecord, removeRecord, loading, loadError } = useVehicleRecords();
  const filtered = useMemo(() => rows.filter(vehicle =>
    (status === "全部" || vehicle.status === status) && (type === "all" || vehicle.type === type) &&
    [vehicle.vin, vehicle.model, vehicle.referenceNo, vehicle.customer, vehicle.warehouse, vehicle.inboundBoeNo, vehicle.outboundBoeNo, vehicle.outboundBoeTitle].filter(Boolean).join("").toLowerCase().includes(query.toLowerCase()),
  ), [rows, query, status, type]);
  const outboundToday = rows.filter(vehicle => vehicle.outboundAt &&
    localInputValue(vehicle.outboundAt, CHINA_TIME_ZONE).slice(0, 10) === localInputValue(new Date().toISOString(), CHINA_TIME_ZONE).slice(0, 10)).length;
  const inStorage = rows.filter(vehicle => !vehicle.outboundAt && vehicle.status !== "待入库");
  const ageBuckets = [
    { n: "0–7天", count: inStorage.filter(vehicle => inventoryDays(vehicle.inboundAt) <= 7).length, c: "green" },
    { n: "8–15天", count: inStorage.filter(vehicle => { const days = inventoryDays(vehicle.inboundAt); return days >= 8 && days <= 15; }).length, c: "teal" },
    { n: "16–30天", count: inStorage.filter(vehicle => { const days = inventoryDays(vehicle.inboundAt); return days >= 16 && days <= 30; }).length, c: "gold" },
    { n: "30天以上", count: inStorage.filter(vehicle => inventoryDays(vehicle.inboundAt) > 30).length, c: "red" },
  ];
  const maxAgeCount = Math.max(1, ...ageBuckets.map(bucket => bucket.count));
  const warehouses = Object.entries(inStorage.reduce<Record<string, number>>((result, vehicle) => {
    const warehouse = vehicle.warehouse || "未填写仓库";
    result[warehouse] = (result[warehouse] ?? 0) + 1;
    return result;
  }, {})).sort((left, right) => right[1] - left[1]);
  const now = new Date();
  const todayLabel = new Intl.DateTimeFormat("zh-CN", { timeZone: CHINA_TIME_ZONE, year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(now);
  const chinaHour = Number(new Intl.DateTimeFormat("en", { timeZone: CHINA_TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(now));
  const greeting = chinaHour < 12 ? "上午好" : chinaHour < 18 ? "下午好" : "晚上好";
  const role = user?.role ?? "customer";
  const kpis = [
    { label: "实时在库", value: rows.filter(vehicle => vehicle.status === "在库").length, delta: `${inStorage.length} 辆在途/在库`, icon: Boxes },
    { label: "待安排提货", value: rows.filter(vehicle => vehicle.status === "待提货").length, delta: "等待创建或完成任务", icon: CarFront },
    { label: "今日已出库", value: outboundToday, delta: "按中国标准时间统计", icon: Warehouse },
    { label: "异常车辆", value: rows.filter(vehicle => vehicle.status === "异常").length, delta: "需要业务跟进", icon: CircleAlert, alert: true },
  ];

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  return <div className="app-shell">
    <SideNav open={mobile} onClose={() => setMobile(false)} roleLabel={roleLabels[role]} userName={user?.name} role={role}/>
    <main className="main"><header className="topbar"><button className="menu" onClick={() => setMobile(true)} aria-label="打开菜单"><Menu/></button><div><p>{todayLabel}</p><h1>{greeting}，{user?.name || "用户"}</h1></div><div className="top-actions">{can(role, "export") && <a href="/api/v1/export" className="secondary-button"><Download/>导出</a>}{can(role, "create") && <button className="primary-button" onClick={() => setModal(true)}><Plus/>录入车辆</button>}<button className="secondary-button" onClick={logout} aria-label="退出登录"><LogOut/></button></div></header>
      <section className="content"><div className="section-heading"><div><p className="eyebrow">实时运营</p><h2>库存一览</h2></div><div className={loadError ? "live demo" : "live"}><i/> {loading ? "数据同步中" : loadError || "数据已同步"}</div></div>
        <div className="kpi-grid">{kpis.map(item => <article className={item.alert ? "kpi alert" : "kpi"} key={item.label}><div><span>{item.label}</span><strong>{item.value}<small> 辆</small></strong><p>{item.delta}</p></div><item.icon/></article>)}</div>
        <div className="chart-grid"><article className="panel age-panel"><div className="panel-title"><div><p className="eyebrow">库存结构</p><h3>库存账龄</h3></div><span>共 {inStorage.length} 辆在途/在库</span></div><div className="age-bars">{ageBuckets.map(bucket => <div key={bucket.n}><span>{bucket.n}</span><div><i className={bucket.c} style={{ width: `${bucket.count / maxAgeCount * 100}%` }}/></div><b>{bucket.count}</b></div>)}</div></article>
          <article className="panel warehouse-panel"><div className="panel-title"><div><p className="eyebrow">仓库分布</p><h3>在库车辆</h3></div></div><div className="warehouse-list">{warehouses.map(([name, count], index) => <div key={name}><span className={`dot ${index === 1 ? "shanghai" : index === 2 ? "ningbo" : "dubai"}`}/><p><b>{name}</b><small>实时库存</small></p><strong>{count}</strong></div>)}{!warehouses.length && <p className="muted">暂无在库车辆</p>}</div></article></div>
        <article className="panel table-panel"><div className="table-head"><div><p className="eyebrow">车辆台账</p><h3>实时库存明细 <span>{filtered.length}</span></h3></div>{can(role, "coordinatePickups") && <Link href="/pickups" className="qr-link"><QrCode/>提货任务</Link>}</div><div className="filters"><label className="search"><Search/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索车架号、车型、提单 / PO、客户…"/></label><select value={type} onChange={event => setType(event.target.value)}><option value="all">全部业务</option><option value="overseas">海外仓</option><option value="domestic">国内仓</option></select><div className="status-tabs">{statusFilters.map(item => <button className={status === item ? "active" : ""} onClick={() => setStatus(item)} key={item}>{item}</button>)}</div></div><VehicleTable rows={filtered} storageKey="cargo.dashboard-vehicle-table" canDelete={can(role, "delete")} onDeleted={removeRecord} /></article>
      </section></main>
    {modal && <VehicleFormModal onClose={() => setModal(false)} onSaved={saveRecord}/>}
  </div>;
}
