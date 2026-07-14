import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPin, ShieldCheck } from "lucide-react";
import { timeline, vehicles } from "@/lib/demo-data";
import { inventoryDays } from "@/lib/domain";
export default async function VehicleDetail({ params }: { params: Promise<{id:string}> }) {
  const { id } = await params; const vehicle = vehicles.find(v=>v.id===id); if(!vehicle) notFound();
  return <main className="detail-shell"><Link href="/" className="back"><ArrowLeft size={17}/> 返回车辆台账</Link><section className="detail-hero"><div><span className={`status status-${vehicle.status}`}>{vehicle.status}</span><p className="eyebrow">车辆档案</p><h1>{vehicle.model}</h1><p className="vin">{vehicle.vin}</p></div><div className="detail-days"><strong>{inventoryDays(vehicle.inboundAt,vehicle.outboundAt)}</strong><span>库存天数</span></div></section><div className="detail-grid"><section className="panel"><h2>业务信息</h2><div className="fact-grid"><div><span>业务类型</span><b>{vehicle.type==='overseas'?'海外保税仓':'国内仓储'}</b></div><div><span>提单 / PO</span><b>{vehicle.referenceNo}</b></div><div><span>所属客人</span><b>{vehicle.customer}</b></div><div><span>仓库</span><b><MapPin size={15}/>{vehicle.warehouse}</b></div><div><span>入库时间</span><b><CalendarDays size={15}/>{vehicle.inboundAt?.slice(0,16).replace('T',' ')}</b></div><div><span>版本</span><b><ShieldCheck size={15}/>v1 · 已审计</b></div></div>{vehicle.notes&&<div className="notice"><b>备注</b><p>{vehicle.notes}</p></div>}</section><section className="panel"><h2>不可覆盖的业务时间线</h2><div className="timeline">{timeline.map((item,i)=><div className="timeline-item" key={item.time}><i className={i===0?'active':''}/><div><b>{item.title}</b><time>{item.time}</time><p>{item.note}</p><small>{item.actor}</small></div></div>)}</div></section></div></main>
}

