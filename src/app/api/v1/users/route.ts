import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { assertSameOrigin, AuthorizationError, requestIp, requireUser } from "@/lib/auth";
import { fromPrismaDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

const createInput = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().trim().transform(value => value.toLowerCase()),
  password: z.string().min(12).max(128),
  role: z.enum(["warehouse", "forwarder", "customer", "admin"]),
  customerId: z.string().min(1).nullable().optional(),
  warehouseIds: z.array(z.string().min(1)).max(100).optional(),
});

const updateInput = z.object({
  id: z.string().min(1),
  active: z.boolean().optional(),
  name: z.string().trim().min(1).max(100).optional(),
  email: z.email().trim().transform(value => value.toLowerCase()).optional(),
  password: z.string().min(12).max(128).optional(),
  role: z.enum(["warehouse", "forwarder", "customer", "admin"]).optional(),
  customerId: z.string().min(1).nullable().optional(),
  warehouseIds: z.array(z.string().min(1)).max(100).optional(),
}).refine(data => data.active !== undefined || data.name !== undefined || data.email !== undefined || data.password !== undefined || data.role !== undefined ||
  data.customerId !== undefined || data.warehouseIds !== undefined, "至少提供一个变更字段");

const roleToDomain = { WAREHOUSE: "warehouse", FORWARDER: "forwarder", CUSTOMER: "customer", ADMIN: "admin" } as const;
const roleToPrisma = { warehouse: "WAREHOUSE", forwarder: "FORWARDER", customer: "CUSTOMER", admin: "ADMIN" } as const;

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: keyof typeof roleToDomain;
  active: boolean;
  customerId: string | null;
  warehouseScopes: { warehouseId: string }[];
  createdAt: Date;
};

const userData = (user: UserRow) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: roleToDomain[user.role],
  active: user.active,
  customerId: user.customerId,
  warehouseIds: user.warehouseScopes.map(scope => scope.warehouseId),
  createdAt: fromPrismaDate(user.createdAt),
});

const select = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  customerId: true,
  warehouseScopes: { select: { warehouseId: true } },
  createdAt: true,
} as const;

async function validateScope(customerId: string | null, warehouseIds: string[]) {
  if (customerId && !await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } })) {
    return NextResponse.json({ error: "CUSTOMER_NOT_FOUND", message: "选择的客户不存在" }, { status: 422 });
  }
  if (warehouseIds.length && await prisma.warehouse.count({ where: { id: { in: warehouseIds } } }) !== warehouseIds.length) {
    return NextResponse.json({ error: "WAREHOUSE_NOT_FOUND", message: "部分仓库不存在" }, { status: 422 });
  }
}

export async function GET() {
  try {
    await requireUser("manageUsers");
    const [users, customers, warehouses] = await Promise.all([
      prisma.user.findMany({ orderBy: { recordSequence: "asc" }, select }),
      prisma.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.warehouse.findMany({ orderBy: [{ name: "asc" }, { location: "asc" }], select: { id: true, name: true, location: true } }),
    ]);
    return NextResponse.json({ data: users.map(userData), meta: { customers, warehouses } });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: "FORBIDDEN", message: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "无法读取用户" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireUser("manageUsers");
    assertSameOrigin(req);
    const parsed = createInput.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "VALIDATION_ERROR", message: "请检查账号信息，密码至少需要 12 位", issues: parsed.error.flatten() }, { status: 422 });
    }

    const role = roleToPrisma[parsed.data.role];
    const customerId = role === "CUSTOMER" ? parsed.data.customerId ?? null : null;
    const warehouseIds = role === "WAREHOUSE" ? [...new Set(parsed.data.warehouseIds ?? [])] : [];
    const invalidScope = await validateScope(customerId, warehouseIds);
    if (invalidScope) return invalidScope;

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const created = await prisma.$transaction(async tx => {
      const user = await tx.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash,
          role,
          customerId,
          warehouseScopes: { create: warehouseIds.map(warehouseId => ({ warehouseId })) },
        },
        select,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "USER_CREATED",
          entityType: "User",
          entityId: user.id,
          after: userData(user),
          ip: requestIp(req),
        },
      });
      return user;
    });
    return NextResponse.json({ data: userData(created) }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: "FORBIDDEN", message: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "INVALID_JSON", message: "请求内容不是有效的 JSON" }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : String(error.meta?.target ?? "");
      if (target.includes("email")) return NextResponse.json({ error: "EMAIL_EXISTS", message: "该邮箱已存在" }, { status: 409 });
      return NextResponse.json({ error: "SCOPE_CONFLICT", message: "用户数据范围重复，请刷新后重试" }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "创建用户失败" }, { status: 503 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireUser("manageUsers");
    assertSameOrigin(req);
    const parsed = updateInput.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR", message: "请检查用户信息，密码至少需要 12 位", issues: parsed.error.flatten() }, { status: 422 });
    if (parsed.data.id === actor.id && parsed.data.active === false) {
      return NextResponse.json({ error: "CANNOT_DISABLE_SELF", message: "不能停用当前登录账号" }, { status: 409 });
    }

    const before = await prisma.user.findUnique({ where: { id: parsed.data.id }, select });
    if (!before) return NextResponse.json({ error: "NOT_FOUND", message: "用户不存在" }, { status: 404 });
    const targetRole = parsed.data.role ? roleToPrisma[parsed.data.role] : before.role;
    const removesAdministrator = before.active && before.role === "ADMIN" &&
      (parsed.data.active === false || targetRole !== "ADMIN");
    if (removesAdministrator && await prisma.user.count({ where: { role: "ADMIN", active: true } }) <= 1) {
      return NextResponse.json({ error: "LAST_ADMIN", message: "系统必须保留至少一个启用的管理员账号" }, { status: 409 });
    }

    const customerId = targetRole === "CUSTOMER"
      ? parsed.data.customerId === undefined ? before.customerId : parsed.data.customerId
      : null;
    const warehouseIds = targetRole === "WAREHOUSE"
      ? parsed.data.warehouseIds === undefined ? before.warehouseScopes.map(scope => scope.warehouseId) : [...new Set(parsed.data.warehouseIds)]
      : [];
    const invalidScope = await validateScope(customerId, warehouseIds);
    if (invalidScope) return invalidScope;
    const passwordHash = parsed.data.password ? await bcrypt.hash(parsed.data.password, 12) : undefined;
    const previousWarehouseIds = before.warehouseScopes.map(scope => scope.warehouseId).sort();
    const nextWarehouseIds = [...warehouseIds].sort();
    const invalidatesSession = Boolean(parsed.data.password) ||
      (parsed.data.active ?? before.active) !== before.active ||
      targetRole !== before.role ||
      customerId !== before.customerId ||
      previousWarehouseIds.length !== nextWarehouseIds.length ||
      previousWarehouseIds.some((warehouseId, index) => warehouseId !== nextWarehouseIds[index]);

    const updated = await prisma.$transaction(async tx => {
      const user = await tx.user.update({
        where: { id: parsed.data.id },
        data: {
          active: parsed.data.active,
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash,
          sessionVersion: invalidatesSession ? { increment: 1 } : undefined,
          role: targetRole,
          customerId,
          warehouseScopes: {
            deleteMany: {},
            create: warehouseIds.map(warehouseId => ({ warehouseId })),
          },
        },
        select,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: parsed.data.password ? "USER_PASSWORD_RESET" : "USER_UPDATED",
          entityType: "User",
          entityId: user.id,
          before: userData(before),
          after: userData(user),
          ip: requestIp(req),
        },
      });
      return user;
    });
    const response = NextResponse.json({ data: userData(updated) });
    if (invalidatesSession && parsed.data.id === actor.id) {
      response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
    }
    return response;
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: "FORBIDDEN", message: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "INVALID_JSON", message: "请求内容不是有效的 JSON" }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : String(error.meta?.target ?? "");
      if (target.includes("email")) return NextResponse.json({ error: "EMAIL_EXISTS", message: "该邮箱已存在" }, { status: 409 });
      return NextResponse.json({ error: "SCOPE_CONFLICT", message: "用户数据范围重复，请刷新后重试" }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "更新用户失败" }, { status: 503 });
  }
}
