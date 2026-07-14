import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name:"车仓通 · 汽车仓储管理", short_name:"车仓通", description:"海外仓与国内汽车仓储协同管理", start_url:"/", display:"standalone", background_color:"#f5f6f3", theme_color:"#174a3a", lang:"zh-CN", icons:[] };
}

