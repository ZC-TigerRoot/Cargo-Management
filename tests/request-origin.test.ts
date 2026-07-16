import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "../src/lib/request-origin";

function request(url: string, headers: Record<string, string>) {
  return { nextUrl: new URL(url), headers: new Headers(headers) };
}

describe("写请求同源校验", () => {
  it("接受使用实际 Host 访问的内网 IP", () => {
    const req = request("http://localhost:3000/api/v1/auth/login", {
      host: "192.168.0.123:3000",
      origin: "http://192.168.0.123:3000",
    });
    expect(isSameOriginRequest(req)).toBe(true);
  });

  it("接受 localhost 同源请求", () => {
    const req = request("http://localhost:3000/api/v1/auth/login", {
      host: "localhost:3000",
      origin: "http://localhost:3000",
    });
    expect(isSameOriginRequest(req)).toBe(true);
  });

  it("接受可信反向代理转发的公开来源", () => {
    const req = request("http://localhost:3000/api/v1/auth/login", {
      host: "app:3000",
      origin: "https://cargo.example.com",
      "x-forwarded-host": "cargo.example.com",
      "x-forwarded-proto": "https",
    });
    expect(isSameOriginRequest(req)).toBe(true);
  });

  it("接受 APP_URL 中配置的生产来源", () => {
    const req = request("http://localhost:3000/api/v1/auth/login", {
      host: "127.0.0.1:3000",
      origin: "https://cargo.example.com",
    });
    expect(isSameOriginRequest(req, "https://cargo.example.com")).toBe(true);
  });

  it("接受浏览器确认的同源请求，即使代理未保留公开 Host", () => {
    const req = request("http://localhost:3000/api/v1/auth/login", {
      host: "127.0.0.1:3000",
      origin: "https://cargo.example.com",
      "sec-fetch-site": "same-origin",
    });
    expect(isSameOriginRequest(req, undefined)).toBe(true);
  });

  it("代理信息不匹配时仍拒绝浏览器跨站请求", () => {
    const req = request("http://localhost:3000/api/v1/auth/login", {
      host: "127.0.0.1:3000",
      origin: "https://evil.example.com",
      "sec-fetch-site": "cross-site",
    });
    expect(isSameOriginRequest(req, "https://cargo.example.com")).toBe(false);
  });

  it("拒绝不同主机或协议的来源", () => {
    const wrongHost = request("http://localhost:3000/api/v1/auth/login", {
      host: "192.168.0.123:3000",
      origin: "http://evil.example.com",
    });
    const wrongProtocol = request("http://localhost:3000/api/v1/auth/login", {
      host: "192.168.0.123:3000",
      origin: "https://192.168.0.123:3000",
    });
    expect(isSameOriginRequest(wrongHost)).toBe(false);
    expect(isSameOriginRequest(wrongProtocol)).toBe(false);
  });

  it("拒绝格式无效的来源，并保留无 Origin 客户端的既有行为", () => {
    const invalid = request("http://localhost:3000/api/v1/auth/login", {
      host: "localhost:3000",
      origin: "not-a-url",
    });
    const absent = request("http://localhost:3000/api/v1/auth/login", { host: "localhost:3000" });
    expect(isSameOriginRequest(invalid)).toBe(false);
    expect(isSameOriginRequest(absent)).toBe(true);
  });
});
