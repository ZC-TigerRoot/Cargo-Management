import type { Metadata } from "next";
import "./globals.css";
import "./enhancements.css";

export const metadata: Metadata = {
  title: "车仓通 · 汽车仓储管理",
  description: "海外保税仓与国内汽车仓储多端协同系统",
  manifest: "/manifest.webmanifest",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
