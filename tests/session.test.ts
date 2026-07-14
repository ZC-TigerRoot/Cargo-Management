import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signSession, verifySession } from "../src/lib/session";

const previousSecret = process.env.AUTH_SECRET;

describe("登录会话", () => {
  beforeAll(() => {
    process.env.AUTH_SECRET = "test-secret-with-at-least-thirty-two-characters";
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
  });

  it("签发并验证完整会话", async () => {
    const claims = { userId: "user-001", email: "admin@example.com", name: "管理员", role: "admin" as const };
    expect(await verifySession(await signSession(claims))).toEqual(claims);
  });

  it("拒绝被篡改的会话", async () => {
    const token = await signSession({ userId: "user-001", email: "admin@example.com", name: "管理员", role: "admin" });
    expect(await verifySession(`${token.slice(0, -1)}x`)).toBeUndefined();
  });
});
