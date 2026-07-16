"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, CalendarDays, MapPin, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { can, inventoryDays, type VehicleRecord } from "@/lib/domain";
import { businessDate } from "@/lib/datetime";
import { useSession } from "@/lib/use-session";
import VehicleFormModal from "@/components/vehicle-form-modal";

const formatDate = (value: string | undefined, timeZone: string) => businessDate(value, timeZone) || "—";
const auditValue = (field: string, value: string | undefined) => {
  if (!value) return "空";
  return field.endsWith("At") || field === "etd" || field === "eta" ? formatDate(value, "Asia/Shanghai") : value;
};
const fileSize = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} MB` : `${Math.ceil(value / 1_000)} KB`;

const timelineFields: { field: keyof VehicleRecord; title: string }[] = [
  { field: "inboundAt", title: "车辆入库" },
  { field: "merchantReleaseAt", title: "商社通知放车" },
  { field: "transferDocNoticeAt", title: "客户通知做过户文件" },
  { field: "customerReleaseAt", title: "客户通知放车" },
  { field: "outboundAt", title: "车辆实际出库" },
  { field: "outboundNoticeDeliveredAt", title: "出库通知单交付商社" },
  { field: "customerReceiptDeliveredAt", title: "客户交付签收单" },
  { field: "agentReceiptDeliveredAt", title: "外代交付签收单给商社" },
];

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useSession();
  const [vehicle, setVehicle] = useState<VehicleRecord>();
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/vehicles?id=${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("not found");
        return response.json() as Promise<{ data: VehicleRecord }>;
      })
      .then(result => setVehicle(result.data))
      .catch(() => setVehicle(undefined))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [id]);

  const timeline = useMemo(() => {
    if (!vehicle) return [];
    if (vehicle.history?.length) return vehicle.history.map(event => ({
      field: event.id,
      title: event.title,
      time: event.occurredAt,
      recordedAt: event.recordedAt,
      actor: event.actor,
      reason: event.reason,
      details: event.details,
      attachments: event.attachments,
    }));
    return timelineFields
      .map(item => ({ ...item, time: vehicle[item.field] as string | undefined, recordedAt: undefined, actor: undefined, reason: undefined, details: undefined, attachments: undefined }))
      .filter((item): item is typeof item & { time: string } => Boolean(item.time))
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  }, [vehicle]);

  if (loading) return <main className="detail-shell"><p className="muted">正在加载车辆档案…</p></main>;
  if (!vehicle) return <main className="detail-shell"><Link href="/" className="back"><ArrowLeft size={17} /> 返回车辆台账</Link><section className="panel not-found"><h1>车辆档案不存在</h1><p>记录可能已删除，或数据库尚未连接。</p></section></main>;

  const overseas = vehicle.type === "overseas";
  const typeFacts: [string, string | undefined][] = overseas
    ? [["HS#", vehicle.hsCode], ["起运港", vehicle.portOfLoad], ["目的港", vehicle.portOfDischarge], ["船名航次", vehicle.vesselVoyage], ["ETD", formatDate(vehicle.etd, vehicle.warehouseTimezone)], ["ETA", formatDate(vehicle.eta, vehicle.warehouseTimezone)]]
    : [["品牌", vehicle.brand], ["生产商", vehicle.manufacturer]];
  const facts: [string, string | undefined][] = [
    ["业务类型", overseas ? "海外保税仓" : "国内仓储"],
    [overseas ? "提单号" : "PO#", vehicle.referenceNo],
    ["车型", vehicle.model],
    ...typeFacts,
    ["所属客人", vehicle.customer],
    [overseas ? "保税仓地点" : "仓库地点", vehicle.warehouseLocation],
    ["入库仓库名称", vehicle.warehouse],
    ["仓库时区", vehicle.warehouseTimezone],
    [overseas ? "入保税仓时间" : "入仓时间", formatDate(vehicle.inboundAt, vehicle.warehouseTimezone)],
    ["入库金额", vehicle.inboundAmount],
    ["入库 BOE 号", vehicle.inboundBoeNo],
    ["实际出库时间", formatDate(vehicle.outboundAt, vehicle.warehouseTimezone)],
    ["出库 BOE 号", vehicle.outboundBoeNo],
    ["BOE 抬头", vehicle.outboundBoeTitle],
    ["出库金额", vehicle.outboundAmount],
  ];

  async function removeVehicle() {
    const label = vehicle?.vin || vehicle?.model || "这条未命名车辆记录";
    if (!vehicle || !window.confirm(`确认永久删除“${label}”？相关提货任务、业务事件和附件也会一并删除。`)) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch("/api/v1/vehicles", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: vehicle.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "删除失败");
      router.push("/vehicles");
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "删除失败，请稍后重试");
      setDeleting(false);
    }
  }

  return <main className="detail-shell">
    <div className="detail-actions"><Link href="/" className="back"><ArrowLeft size={17} /> 返回车辆台账</Link><div>{user && can(user.role, "delete") && <button className="secondary-button danger-button" disabled={deleting} onClick={removeVehicle}><Trash2 />{deleting ? "删除中…" : "删除车辆"}</button>}{user && can(user.role, "correct") && <button className="secondary-button" onClick={() => setEditing(true)}><Pencil />编辑档案</button>}</div></div>
    {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
    <section className="detail-hero"><div><span className={`status status-${vehicle.status}`}>{vehicle.status}</span><p className="eyebrow">车辆档案</p><h1>{vehicle.model || "未填写车型"}</h1><p className="vin">{vehicle.vin || "未填写车架号"}</p></div><div className="detail-days"><strong>{inventoryDays(vehicle.inboundAt, vehicle.outboundAt)}</strong><span>库存天数</span></div></section>
    <div className="detail-grid">
      <section className="panel detail-main"><h2>业务信息</h2><div className="fact-grid">{facts.map(([label, content]) => <div key={label}><span>{label}</span><b>{label.includes("地点") || label.includes("仓库") ? <MapPin size={15} /> : label.includes("时间") ? <CalendarDays size={15} /> : <ShieldCheck size={15} />}{content || "—"}</b></div>)}</div>{vehicle.pickupDetails && <div className="notice"><b>出库提货明细</b><p>{vehicle.pickupDetails}</p></div>}{vehicle.notes && <div className="notice"><b>备注</b><p>{vehicle.notes}</p></div>}</section>
      <section className="panel"><h2>不可覆盖的业务时间线</h2>{timeline.length ? <div className="timeline">{timeline.map((item, index) => <div className="timeline-item" key={`${item.field}-${item.time}`}><i className={index === timeline.length - 1 ? "active" : ""} /><div><b>{item.title}</b><time>{formatDate(item.time, vehicle.warehouseTimezone)}</time><p>{item.reason || "该业务事件已记录；后续修改只会追加更正记录。"}</p>{item.details?.length ? <dl className="timeline-details">{item.details.map(detail => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl> : null}<small>{item.actor || "系统业务事件"}{item.recordedAt ? ` · 记录于 ${formatDate(item.recordedAt, vehicle.warehouseTimezone)}` : ""}</small>{item.attachments?.length ? <div className="timeline-attachments">{item.attachments.map(attachment => <a href={attachment.url} target="_blank" rel="noreferrer" key={attachment.id} title="点击查看原图"><Image src={attachment.url} width={520} height={320} unoptimized alt={`${item.title}现场照片`} /><span>{attachment.fileName} · {fileSize(attachment.size)}</span></a>)}</div> : null}</div></div>)}</div> : <p className="muted">尚未录入业务节点时间。</p>}</section>
      <section className="panel audit-panel"><h2>数据修改记录</h2><p className="audit-timezone">所有记录均按中国标准时间显示</p>{vehicle.auditTrail?.length ? <div className="audit-list">{[...vehicle.auditTrail].reverse().map(entry => <article key={entry.id}><div><b>{entry.action}</b><time>{formatDate(entry.changedAt, vehicle.warehouseTimezone)}</time></div><small>{entry.actor}</small>{entry.changes.length ? <ul>{entry.changes.map(change => <li key={change.field}><span>{change.label}</span><del>{auditValue(change.field, change.before)}</del><i>→</i><ins>{auditValue(change.field, change.after)}</ins></li>)}</ul> : <p>已保存完整操作记录</p>}</article>)}</div> : <p className="muted">暂无数据修改记录。</p>}</section>
    </div>
    {editing && <VehicleFormModal initial={vehicle} onClose={() => setEditing(false)} onSaved={setVehicle} />}
  </main>;
}
