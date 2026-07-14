import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AuthorizationError, requestIp, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const updateInput = z.object({
  id: z.string().min(1),
  active: z.boolean().optional(),
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(["warehouse", "operator", "viewer", "admin"]).optional(),
}).refine(data => data.active !== undefined || data.name !== undefined || data.role !== undefined, "至少提供一个变更字段");

const roleToDomain = { WAREHOUSE: "warehouse", OPERATOR: "operator", VIEWER: "viewer", ADMIN: "admin" } as const;
const roleToPrisma = { warehouse: "WAREHOUSE", operator: "OPERATOR", viewer: "VIEWER", admin: "ADMIN" } as const;
const userData = (user: { id: string; name: string; email: string; role: keyof typeof roleToDomain; active: boolean }) => ({
  id: user.id, name: user.name, email: user.email, role: roleToDomain[user.role], active: user.active,
});

export async function GET() {
  try {
    await requireUser("manageUsers");
    const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true, role: true, active: true } });
    return NextResponse.json({ data: users.map(userData) });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: "FORBIDDEN", message: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "无法读取用户" }, { status: 503 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireUser("manageUsers");
    assertSameOrigin(req);
    const parsed = updateInput.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR", issues: parsed.error.flatten() }, { status: 422 });
    if (parsed.data.id === actor.id && parsed.data.active === false) return NextResponse.json({ error: "CANNOT_DISABLE_SELF", message: "不能停用当前登录账号" }, { status: 409 });
    const before = await prisma.user.findUnique({ where: { id: parsed.data.id }, select: { id: true, name: true, email: true, role: true, active: true } });
    if (!before) return NextResponse.json({ error: "NOT_FOUND", message: "用户不存在" }, { status: 404 });
    const removesAdministrator = before.active && before.role === "ADMIN" &&
      (parsed.data.active === false || (parsed.data.role !== undefined && parsed.data.role !== "admin"));
    if (removesAdministrator && await prisma.user.count({ where: { role: "ADMIN", active: true } }) <= 1) {
      return NextResponse.json({ error: "LAST_ADMIN", message: "系统必须保留至少一个启用的管理员账号" }, { status: 409 });
    }
    const updated = await prisma.$transaction(async tx => {
      const user = await tx.user.update({
        where: { id: parsed.data.id },
        data: { active: parsed.data.active, name: parsed.data.name, role: parsed.data.role ? roleToPrisma[parsed.data.role] : undefined },
        select: { id: true, name: true, email: true, role: true, active: true },
      });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: "USER_UPDATED", entityType: "User", entityId: user.id, before, after: user, ip: requestIp(req) },
      });
      return user;
    });
    return NextResponse.json({ data: userData(updated) });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: "FORBIDDEN", message: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "INVALID_JSON", message: "请求内容不是有效的 JSON" }, { status: 400 });
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "更新用户失败" }, { status: 503 });
  }
}
