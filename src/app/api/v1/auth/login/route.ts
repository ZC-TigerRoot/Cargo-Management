import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sessionCookieOptions, SESSION_COOKIE, signSession } from "@/lib/session";
import { assertSameOrigin, AuthorizationError } from "@/lib/auth";

const credentials = z.object({
  email: z.email().trim().transform(value => value.toLowerCase()),
  password: z.string().min(8).max(128),
});

const roleNames = { WAREHOUSE: "warehouse", OPERATOR: "operator", VIEWER: "viewer", ADMIN: "admin" } as const;

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const parsed = credentials.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR", message: "请输入有效的邮箱和密码" }, { status: 422 });

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user?.active || !await bcrypt.compare(parsed.data.password, user.passwordHash)) {
      return NextResponse.json({ error: "INVALID_CREDENTIALS", message: "邮箱或密码错误" }, { status: 401 });
    }
    const token = await signSession({ userId: user.id, email: user.email, name: user.name, role: roleNames[user.role] });
    const response = NextResponse.json({ data: { id: user.id, email: user.email, name: user.name, role: roleNames[user.role] } });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return response;
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: "FORBIDDEN", message: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "LOGIN_FAILED", message: "登录服务暂时不可用" }, { status: 503 });
  }
}
