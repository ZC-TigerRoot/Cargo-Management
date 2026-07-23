import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sessionCookieOptions, SESSION_COOKIE, signSession } from "@/lib/session";
import { assertSameOrigin, AuthorizationError, requestIp } from "@/lib/auth";
import { clearAccountLoginFailures, loginRetryAfter, recordFailedLogin } from "@/lib/login-rate-limit";

const credentials = z.object({
  email: z.email().trim().transform(value => value.toLowerCase()),
  password: z.string().min(8).max(128),
});

const roleNames = { WAREHOUSE: "warehouse", FORWARDER: "forwarder", CUSTOMER: "customer", ADMIN: "admin" } as const;
const dummyPasswordHash = bcrypt.hash("cargo-login-timing-placeholder", 12);

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const contentLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 16_384) {
      return NextResponse.json({ error: "PAYLOAD_TOO_LARGE", message: "登录请求内容过大" }, { status: 413 });
    }
    const parsed = credentials.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR", message: "请输入有效的邮箱和密码" }, { status: 422 });

    const ip = requestIp(req);
    const retryAfter = loginRetryAfter(ip, parsed.data.email);
    if (retryAfter) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "登录尝试过于频繁，请稍后重试" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    const passwordMatches = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? await dummyPasswordHash);
    if (!user?.active || !passwordMatches) {
      recordFailedLogin(ip, parsed.data.email);
      return NextResponse.json({ error: "INVALID_CREDENTIALS", message: "邮箱或密码错误" }, { status: 401 });
    }
    clearAccountLoginFailures(parsed.data.email);
    const token = await signSession({ userId: user.id, email: user.email, name: user.name, role: roleNames[user.role], sessionVersion: user.sessionVersion });
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
