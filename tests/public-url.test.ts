import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findSetting = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/prisma", () => ({ prisma: { systemSetting: { findUnique: findSetting } } }));

import { buildPickupUrl, getPublicBaseUrl, normalizePublicBaseUrl } from "../src/lib/public-url";

const originalAppUrl = process.env.APP_URL;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.APP_URL;
  findSetting.mockResolvedValue(null);
});

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

describe("公开域名与提货链接", () => {
  it("规范化 HTTP(S) origin 并拒绝危险或带路径的地址", () => {
    expect(normalizePublicBaseUrl("  HTTPS://Cargo.Example.com:443  ")).toBe("https://cargo.example.com");
    for (const value of [
      "ftp://cargo.example.com",
      "https://user:pass@cargo.example.com",
      "https://cargo.example.com/driver",
      "https://cargo.example.com?next=/driver",
      "https://cargo.example.com#driver",
    ]) {
      expect(() => normalizePublicBaseUrl(value)).toThrow();
    }
  });

  it("优先使用数据库设置，其次使用环境变量和请求来源", async () => {
    findSetting.mockResolvedValueOnce({ publicBaseUrl: "https://configured.example.com" });
    await expect(getPublicBaseUrl("https://fallback.example.com")).resolves.toBe("https://configured.example.com");

    process.env.APP_URL = "https://env.example.com";
    findSetting.mockResolvedValueOnce(null);
    await expect(getPublicBaseUrl("https://fallback.example.com")).resolves.toBe("https://env.example.com");

    findSetting.mockResolvedValueOnce({ publicBaseUrl: "javascript:alert(1)" });
    await expect(getPublicBaseUrl("https://fallback.example.com")).resolves.toBe("https://fallback.example.com");
  });

  it("对提货令牌进行路径编码", () => {
    expect(buildPickupUrl("https://cargo.example.com", "token/with spaces?x=1")).toBe(
      "https://cargo.example.com/driver/token%2Fwith%20spaces%3Fx%3D1",
    );
  });
});
