"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CarFront, FileUp, LayoutDashboard, QrCode, Settings, Ship, Users, Warehouse, X } from "lucide-react";

const items = [
  { href: "/", label: "运营总览", icon: LayoutDashboard },
  { href: "/vehicles", label: "车辆台账", icon: CarFront },
  { href: "/overseas", label: "海外仓业务", icon: Ship },
  { href: "/domestic", label: "国内仓储", icon: Warehouse },
  { href: "/pickups", label: "提货任务", icon: QrCode },
  { href: "/imports", label: "导入记录", icon: FileUp },
  { href: "/reports", label: "库存报表", icon: BarChart3 },
];
const systemItems = [
  { href: "/users", label: "账号与权限", icon: Users },
  { href: "/settings", label: "基础设置", icon: Settings },
];

export default function SideNav({ open=false, onClose, roleLabel="货代 / 操作管理" }:{open?:boolean;onClose?:()=>void;roleLabel?:string}) {
  const pathname=usePathname();
  const active=(href:string)=>href==="/"?pathname==="/":pathname===href||pathname.startsWith(`${href}/`);
  return <aside className={open?"sidebar open":"sidebar"}><div className="logo"><span>车</span><div><b>车仓通</b><small>CARGO FLOW</small></div><button onClick={onClose} aria-label="关闭菜单"><X/></button></div><nav>{items.map(Item=><Link key={Item.href} href={Item.href} className={active(Item.href)?"active":""} onClick={onClose}><Item.icon/>{Item.label}</Link>)}<div className="nav-label">系统</div>{systemItems.map(Item=><Link key={Item.href} href={Item.href} className={active(Item.href)?"active":""} onClick={onClose}><Item.icon/>{Item.label}</Link>)}</nav><div className="side-footer"><span className="avatar">林</span><div><b>林晓</b><small>{roleLabel}</small></div></div></aside>;
}

