import "server-only";

import { prisma } from "./prisma";

export function normalizePublicBaseUrl(value: string) {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("当前域名必须使用 http 或 https");
  if (url.username || url.password) throw new Error("当前域名不能包含用户名或密码");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("当前域名不能包含路径、参数或锚点");
  return url.origin;
}

export async function getPublicBaseUrl(fallbackOrigin: string) {
  const setting = await prisma.systemSetting.findUnique({ where: { id: "default" } });
  const configured = setting?.publicBaseUrl || process.env.APP_URL;
  if (!configured) return normalizePublicBaseUrl(fallbackOrigin);
  try {
    return normalizePublicBaseUrl(configured);
  } catch {
    return normalizePublicBaseUrl(fallbackOrigin);
  }
}

export function buildPickupUrl(baseUrl: string, token: string) {
  return `${baseUrl}/driver/${encodeURIComponent(token)}`;
}
