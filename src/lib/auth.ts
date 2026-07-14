import "server-only";

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { Role as PrismaRole } from "@prisma/client";
import { can, type Role } from "./domain";
import { prisma } from "./prisma";
import { SESSION_COOKIE, verifySession } from "./session";

export type Permission = "view" | "create" | "correct" | "export" | "manageUsers";

export class AuthorizationError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

const roleNames: Record<PrismaRole, Role> = {
  WAREHOUSE: "warehouse",
  OPERATOR: "operator",
  VIEWER: "viewer",
  ADMIN: "admin",
};

export async function requireUser(permission: Permission) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) throw new AuthorizationError(401, "请先登录");

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user?.active) throw new AuthorizationError(401, "账号已停用或不存在");
  const role = roleNames[user.role];
  if (!can(role, permission)) throw new AuthorizationError(403, "当前账号没有执行此操作的权限");
  return { ...user, roleName: role };
}

export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) throw new AuthorizationError(403, "请求来源无效");
}

export function requestIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined;
}
