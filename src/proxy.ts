import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const publicApiPrefixes = ["/api/v1/auth/login", "/api/v1/driver/"];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const publicRequest = pathname === "/login" || pathname.startsWith("/driver/") || publicApiPrefixes.some(prefix => pathname.startsWith(prefix));
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login" && session) return NextResponse.redirect(new URL("/", req.url));
  if (publicRequest) return NextResponse.next();

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "UNAUTHENTICATED", message: "请先登录" }, { status: 401 });
    }
    const login = new URL("/login", req.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  if ((pathname.startsWith("/users") || pathname.startsWith("/settings")) && !["admin", "forwarder"].includes(session.role)) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  if (session.role === "customer" && (pathname.startsWith("/pickups") || pathname.startsWith("/imports"))) {
    return NextResponse.redirect(new URL("/vehicles", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
