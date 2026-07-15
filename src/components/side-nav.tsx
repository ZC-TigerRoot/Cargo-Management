"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CarFront, FileUp, LayoutDashboard, QrCode, Settings, Ship, Users, Warehouse, X } from "lucide-react";
import { can, type Role } from "@/lib/domain";

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
  { href: "/users", label: "用户管理", icon: Users, permission: "manageUsers" as const },
  { href: "/settings", label: "基础设置", icon: Settings, permission: "manageSettings" as const },
];

export default function SideNav({ open=false, onClose, roleLabel="货代", userName="", role }:{open?:boolean;onClose?:()=>void;roleLabel?:string;userName?:string;role?:Role}) {
  const pathname=usePathname();
  const active=(href:string)=>href==="/"?pathname==="/":pathname===href||pathname.startsWith(`${href}/`);
  const visibleItems = items.filter(item => item.href !== "/pickups" || !role || can(role, "coordinatePickups"))
    .filter(item => item.href !== "/imports" || !role || can(role, "create"));
  const visibleSystemItems = role ? systemItems.filter(item => can(role, item.permission)) : [];
  return <aside className={open?"sidebar open":"sidebar"}><div className="logo"><span>车</span><div><b>车仓通</b><small>CARGO FLOW</small></div><button onClick={onClose} aria-label="关闭菜单"><X/></button></div><nav>{visibleItems.map(Item=><Link key={Item.href} href={Item.href} className={active(Item.href)?"active":""} onClick={onClose}><Item.icon/>{Item.label}</Link>)}{visibleSystemItems.length > 0 && <><div className="nav-label">系统</div>{visibleSystemItems.map(Item=><Link key={Item.href} href={Item.href} className={active(Item.href)?"active":""} onClick={onClose}><Item.icon/>{Item.label}</Link>)}</>}</nav><div className="side-footer"><span className="avatar">{userName[0] || "用"}</span><div><b>{userName || "当前用户"}</b><small>{roleLabel}</small></div></div></aside>;
}
