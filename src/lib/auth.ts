import "server-only";

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { Prisma, Role as PrismaRole } from "@prisma/client";
import { can, type Permission, type Role } from "./domain";
import { prisma } from "./prisma";
import { isSameOriginRequest } from "./request-origin";
import { SESSION_COOKIE, verifySession } from "./session";

export class AuthorizationError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

const roleNames: Record<PrismaRole, Role> = {
  WAREHOUSE: "warehouse",
  FORWARDER: "forwarder",
  CUSTOMER: "customer",
  ADMIN: "admin",
};

export type AccessUser = {
  id: string;
  name: string;
  roleName: Role;
  customerId: string | null;
  warehouseScopes: { warehouseId: string }[];
};

export async function requireUser(permission: Permission) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) throw new AuthorizationError(401, "请先登录");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { warehouseScopes: { select: { warehouseId: true } } },
  });
  if (!user?.active) throw new AuthorizationError(401, "账号已停用或不存在");
  if (user.sessionVersion !== session.sessionVersion) throw new AuthorizationError(401, "登录状态已失效，请重新登录");
  const role = roleNames[user.role];
  if (!can(role, permission)) throw new AuthorizationError(403, "当前账号没有执行此操作的权限");
  return { ...user, roleName: role };
}

export function vehicleScopeWhere(user: AccessUser): Prisma.VehicleWhereInput {
  if (user.roleName === "customer") return { customerId: user.customerId ?? "__unassigned_customer__" };
  if (user.roleName === "warehouse") return { warehouseId: { in: user.warehouseScopes.map(scope => scope.warehouseId) } };
  return {};
}

export function pickupTaskScopeWhere(user: AccessUser): Prisma.PickupTaskWhereInput {
  const vehicle = vehicleScopeWhere(user);
  return Object.keys(vehicle).length ? { items: { some: { vehicle }, every: { vehicle } } } : {};
}

export async function requireVehicleInScope(user: AccessUser, vehicleId: string) {
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, ...vehicleScopeWhere(user) }, select: { id: true } });
  if (!vehicle) throw new AuthorizationError(403, "当前账号不能访问或修改该车辆");
}

export async function requirePayloadWarehouseInScope(
  user: AccessUser,
  warehouseName?: string,
  warehouseLocation?: string,
  options: { required?: boolean } = {},
) {
  if (user.roleName !== "warehouse") return;
  if (!warehouseName && !warehouseLocation && !options.required) return;
  if (!warehouseName || !warehouseLocation) {
    throw new AuthorizationError(403, "仓管填写仓库时必须同时提供仓库名称和地点");
  }
  const warehouse = await prisma.warehouse.findUnique({
    where: { name_location: { name: warehouseName, location: warehouseLocation } },
    select: { id: true },
  });
  if (!warehouse || !user.warehouseScopes.some(scope => scope.warehouseId === warehouse.id)) {
    throw new AuthorizationError(403, "仓管只能录入或修改已分配仓库的数据");
  }
}

export function assertSameOrigin(req: NextRequest) {
  if (!isSameOriginRequest(req)) throw new AuthorizationError(403, "请求来源无效");
}

export function requestIp(req: NextRequest) {
  if (process.env.TRUST_PROXY !== "true") return undefined;
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined;
}
