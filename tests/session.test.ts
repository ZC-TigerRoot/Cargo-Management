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
    const claims = { userId: "user-001", email: "admin@example.com", name: "管理员", role: "admin" as const, sessionVersion: 2 };
    expect(await verifySession(await signSession(claims))).toEqual(claims);
  });

  it("拒绝被篡改的会话", async () => {
    const token = await signSession({ userId: "user-001", email: "admin@example.com", name: "管理员", role: "admin", sessionVersion: 0 });
    const middle = Math.floor(token.length / 2);
    const changed = token[middle] === "x" ? "y" : "x";
    expect(await verifySession(`${token.slice(0, middle)}${changed}${token.slice(middle + 1)}`)).toBeUndefined();
  });

  it("拒绝无效的会话版本", async () => {
    const token = await signSession({ userId: "user-001", email: "admin@example.com", name: "管理员", role: "admin", sessionVersion: -1 });
    expect(await verifySession(token)).toBeUndefined();
  });
});
