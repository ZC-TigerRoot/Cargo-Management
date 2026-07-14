import { SignJWT, jwtVerify } from "jose";
import type { Role } from "./domain";

export const SESSION_COOKIE = "cargo_session";
const SESSION_AGE_SECONDS = 8 * 60 * 60;

export type SessionClaims = {
  userId: string;
  email: string;
  name: string;
  role: Role;
};

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters");
  return new TextEncoder().encode(value);
}

export async function signSession(claims: SessionClaims) {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer("cargo-management")
    .setAudience("cargo-management-web")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_AGE_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token?: string): Promise<SessionClaims | undefined> {
  if (!token) return undefined;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"], issuer: "cargo-management", audience: "cargo-management-web" });
    if (!payload.sub || typeof payload.email !== "string" || typeof payload.name !== "string" ||
      !["warehouse", "operator", "viewer", "admin"].includes(String(payload.role))) return undefined;
    return {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role as Role,
    };
  } catch {
    return undefined;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_AGE_SECONDS,
};
