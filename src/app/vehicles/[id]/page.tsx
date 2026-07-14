"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarDays, MapPin, Pencil, ShieldCheck } from "lucide-react";
import { vehicles } from "@/lib/demo-data";
import { inventoryDays, type VehicleRecord } from "@/lib/domain";
import VehicleFormModal from "@/components/vehicle-form-modal";

const formatDate = (value?: string) => value ? new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(value)) : "—";

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
  const [vehicle, setVehicle] = useState<VehicleRecord | undefined>(() => vehicles.find(item => item.id === id));
  const [loading, setLoading] = useState(!vehicle);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/vehicles?id=${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("not found");
        return response.json() as Promise<{ data: VehicleRecord }>;
      })
      .then(result => setVehicle(result.data))
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [id]);

  const timeline = useMemo(() => vehicle ? timelineFields
    .map(item => ({ ...item, time: vehicle[item.field] as string | undefined }))
    .filter((item): item is typeof item & { time: string } => Boolean(item.time))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()) : [], [vehicle]);

  if (loading) return <main className="detail-shell"><p className="muted">正在加载车辆档案…</p></main>;
  if (!vehicle) return <main className="detail-shell"><Link href="/" className="back"><ArrowLeft size={17} /> 返回车辆台账</Link><section className="panel not-found"><h1>车辆档案不存在</h1><p>记录可能已删除，或数据库尚未连接。</p></section></main>;

  const overseas = vehicle.type === "overseas";
  const typeFacts: [string, string | undefined][] = overseas
    ? [["HS#", vehicle.hsCode], ["起运港", vehicle.portOfLoad], ["目的港", vehicle.portOfDischarge], ["船名航次", vehicle.vesselVoyage], ["ETD", formatDate(vehicle.etd)], ["ETA", formatDate(vehicle.eta)]]
    : [["品牌", vehicle.brand], ["生产商", vehicle.manufacturer]];
  const facts: [string, string | undefined][] = [
    ["业务类型", overseas ? "海外保税仓" : "国内仓储"],
    [overseas ? "提单号" : "PO#", vehicle.referenceNo],
    ["车型", vehicle.model],
    ...typeFacts,
    ["所属客人", vehicle.customer],
    [overseas ? "保税仓地点" : "仓库地点", vehicle.warehouseLocation],
    ["入库仓库名称", vehicle.warehouse],
    [overseas ? "入保税仓时间" : "入仓时间", formatDate(vehicle.inboundAt)],
    ["实际出库时间", formatDate(vehicle.outboundAt)],
  ];

  return <main className="detail-shell">
    <div className="detail-actions"><Link href="/" className="back"><ArrowLeft size={17} /> 返回车辆台账</Link><button className="secondary-button" onClick={() => setEditing(true)}><Pencil />编辑档案</button></div>
    <section className="detail-hero"><div><span className={`status status-${vehicle.status}`}>{vehicle.status}</span><p className="eyebrow">车辆档案</p><h1>{vehicle.model}</h1><p className="vin">{vehicle.vin}</p></div><div className="detail-days"><strong>{inventoryDays(vehicle.inboundAt, vehicle.outboundAt)}</strong><span>库存天数</span></div></section>
    <div className="detail-grid">
      <section className="panel detail-main"><h2>业务信息</h2><div className="fact-grid">{facts.map(([label, content]) => <div key={label}><span>{label}</span><b>{label.includes("地点") || label.includes("仓库") ? <MapPin size={15} /> : label.includes("时间") ? <CalendarDays size={15} /> : <ShieldCheck size={15} />}{content || "—"}</b></div>)}</div>{vehicle.pickupDetails && <div className="notice"><b>出库提货明细</b><p>{vehicle.pickupDetails}</p></div>}{vehicle.notes && <div className="notice"><b>备注</b><p>{vehicle.notes}</p></div>}</section>
      <section className="panel"><h2>不可覆盖的业务时间线</h2>{timeline.length ? <div className="timeline">{timeline.map((item, index) => <div className="timeline-item" key={`${item.field}-${item.time}`}><i className={index === timeline.length - 1 ? "active" : ""} /><div><b>{item.title}</b><time>{formatDate(item.time)}</time><p>该业务时间已记录；后续修改将追加更正记录。</p><small>系统业务事件</small></div></div>)}</div> : <p className="muted">尚未录入业务节点时间。</p>}</section>
    </div>
    {editing && <VehicleFormModal initial={vehicle} onClose={() => setEditing(false)} onSaved={setVehicle} />}
  </main>;
}
