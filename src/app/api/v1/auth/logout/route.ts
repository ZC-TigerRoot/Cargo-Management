import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST(req: NextRequest) {
  assertSameOrigin(req);
  const response = NextResponse.json({ data: { loggedOut: true } });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
