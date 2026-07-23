import { describe, expect, it } from "vitest";
import { clearAccountLoginFailures, loginRetryAfter, recordFailedLogin } from "../src/lib/login-rate-limit";

describe("登录失败限流", () => {
  it("账号连续失败十次后进入十五分钟冷却", () => {
    const email = "limited-account@example.com";
    const now = Date.UTC(2026, 6, 23, 0, 0, 0);
    clearAccountLoginFailures(email);
    for (let index = 0; index < 10; index += 1) recordFailedLogin(undefined, email, now);
    expect(loginRetryAfter(undefined, email, now)).toBe(900);
    expect(loginRetryAfter(undefined, email, now + 15 * 60 * 1_000)).toBeUndefined();
  });

  it("成功登录可清除账号维度的失败记录", () => {
    const email = "recovered-account@example.com";
    const now = Date.UTC(2026, 6, 23, 0, 0, 0);
    for (let index = 0; index < 10; index += 1) recordFailedLogin(undefined, email, now);
    clearAccountLoginFailures(email);
    expect(loginRetryAfter(undefined, email, now)).toBeUndefined();
  });
});
