import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => {
  class AuthorizationError extends Error {
    constructor(public status: 401 | 403, message: string) {
      super(message);
    }
  }
  return {
    AuthorizationError,
    assertSameOrigin: vi.fn(),
    requestIp: vi.fn(() => "203.0.113.8"),
    requireUser: vi.fn(),
    vehicleScopeWhere: vi.fn(),
  };
});

const repository = vi.hoisted(() => {
  class VersionConflictError extends Error {
    constructor() {
      super("车辆记录已被其他用户更新，请刷新后重试");
    }
  }
  class VehicleReentryError extends Error {
    constructor(public code: string, message: string, public status: number) {
      super(message);
    }
  }
  return {
    VersionConflictError,
    VehicleReentryError,
    reenterVehicles: vi.fn(),
    toVehicleRecord: vi.fn((vehicle: { id: string }) => ({ ...vehicle, status: "在库" })),
  };
});

vi.mock("@/lib/auth", () => auth);
vi.mock("@/lib/validators", async () => import("../src/lib/validators"));
vi.mock("@/lib/vehicle-repository", () => repository);

import { POST } from "../src/app/api/v1/vehicles/reentry/route";

const payload = {
  vehicles: [{ id: "vehicle-1", version: 4 }, { id: "vehicle-2", version: 2 }],
  inboundAt: "2026-10-21",
  reason: "整备完成后返库",
};
const user = { id: "user-1", name: "仓管", roleName: "warehouse", customerId: null, warehouseScopes: [{ warehouseId: "warehouse-1" }] };
const scope = { warehouseId: { in: ["warehouse-1"] } };

function request(body: unknown = payload) {
  return {
    headers: new Headers({ origin: "https://cargo.example.com" }),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T04:00:00.000Z"));
  auth.requireUser.mockResolvedValue(user);
  auth.requestIp.mockReturnValue("203.0.113.8");
  auth.vehicleScopeWhere.mockReturnValue(scope);
  repository.reenterVehicles.mockResolvedValue([{ id: "vehicle-1" }, { id: "vehicle-2" }]);
  repository.toVehicleRecord.mockImplementation((vehicle: { id: string }) => ({ ...vehicle, status: "在库" }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("批量再次入库 API", () => {
  it("使用纠错权限、仓库范围和操作人执行整批返库", async () => {
    const req = request({ ...payload, reason: "  整备完成后返库  " });
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(auth.requireUser).toHaveBeenCalledWith("correct");
    expect(auth.assertSameOrigin).toHaveBeenCalledWith(req);
    expect(auth.vehicleScopeWhere).toHaveBeenCalledWith(user);
    expect(repository.reenterVehicles).toHaveBeenCalledExactlyOnceWith(payload, { actorId: "user-1", ip: "203.0.113.8" }, scope);
    expect(await response.json()).toEqual({ data: [{ id: "vehicle-1", status: "在库" }, { id: "vehicle-2", status: "在库" }], meta: { total: 2 } });
  });

  it("逐车传递去除首尾空白的新备注，并在响应中返回更新后的备注", async () => {
    const vehicles = [
      { ...payload.vehicles[0], notes: "第一车新备注" },
      { ...payload.vehicles[1], notes: "第二车新备注" },
    ];
    repository.reenterVehicles.mockResolvedValueOnce(vehicles);

    const response = await POST(request({
      ...payload, vehicles: [{ ...vehicles[0], notes: "  第一车新备注 \n" }, vehicles[1]],
    }));

    expect(response.status).toBe(200);
    expect(repository.reenterVehicles).toHaveBeenCalledExactlyOnceWith({ ...payload, vehicles }, { actorId: "user-1", ip: "203.0.113.8" }, scope);
    expect(await response.json()).toEqual({ data: vehicles.map(vehicle => ({ ...vehicle, status: "在库" })), meta: { total: 2 } });
  });

  it("空白备注按未提供处理，已有不带备注的请求仍可提交", async () => {
    const response = await POST(request({
      ...payload, vehicles: [{ ...payload.vehicles[0], notes: " \n \t " }, payload.vehicles[1]],
    }));

    expect(response.status).toBe(200);
    expect(repository.reenterVehicles).toHaveBeenCalledExactlyOnceWith({
      ...payload, vehicles: [{ ...payload.vehicles[0], notes: undefined }, payload.vehicles[1]],
    }, { actorId: "user-1", ip: "203.0.113.8" }, scope);
  });

  it("允许备注长度恰好为 5000 个字符", async () => {
    const vehicles = [{ ...payload.vehicles[0], notes: "备".repeat(5_000) }];

    const response = await POST(request({ ...payload, vehicles }));

    expect(response.status).toBe(200);
    expect(repository.reenterVehicles).toHaveBeenCalledExactlyOnceWith({ ...payload, vehicles }, { actorId: "user-1", ip: "203.0.113.8" }, scope);
  });

  it.each([
    [401, "UNAUTHENTICATED", "请先登录"],
    [403, "FORBIDDEN", "当前账号没有执行此操作的权限"],
  ] as const)("拒绝 %i 权限错误", async (status, error, message) => {
    auth.requireUser.mockRejectedValueOnce(new auth.AuthorizationError(status, message));

    const response = await POST(request());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error, message });
    expect(repository.reenterVehicles).not.toHaveBeenCalled();
  });

  it("拒绝跨源请求", async () => {
    auth.assertSameOrigin.mockImplementationOnce(() => { throw new auth.AuthorizationError(403, "请求来源无效"); });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "FORBIDDEN", message: "请求来源无效" });
    expect(repository.reenterVehicles).not.toHaveBeenCalled();
  });

  it("报告无效 JSON", async () => {
    const req = request();
    vi.mocked(req.json).mockRejectedValueOnce(new SyntaxError("Unexpected end of JSON input"));

    const response = await POST(req);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "INVALID_JSON" });
    expect(repository.reenterVehicles).not.toHaveBeenCalled();
  });

  it.each([
    ["空车辆列表", { ...payload, vehicles: [] }],
    ["超过批量上限", { ...payload, vehicles: Array.from({ length: 501 }, (_, index) => ({ id: `vehicle-${index}`, version: 1 })) }],
    ["空车辆 ID", { ...payload, vehicles: [{ id: " ", version: 1 }] }],
    ["无效版本", { ...payload, vehicles: [{ id: "vehicle-1", version: 0 }] }],
    ["非整数版本", { ...payload, vehicles: [{ id: "vehicle-1", version: 1.5 }] }],
    ["重复车辆", { ...payload, vehicles: [payload.vehicles[0], payload.vehicles[0]] }],
    ["无效日期", { ...payload, inboundAt: "2026-02-30" }],
    ["未来日期", { ...payload, inboundAt: "2026-10-22" }],
    ["缺少原因", { ...payload, reason: undefined }],
    ["空白原因", { ...payload, reason: " \n " }],
    ["原因过长", { ...payload, reason: "a".repeat(2_001) }],
    ["单车备注过长", { ...payload, vehicles: [{ ...payload.vehicles[0], notes: "备".repeat(5_001) }, payload.vehicles[1]] }],
    ["备注不是文本", { ...payload, vehicles: [{ ...payload.vehicles[0], notes: 123 }, payload.vehicles[1]] }],
  ])("拒绝%s", async (_label, body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(422);
    expect(await response.json()).toHaveProperty("error", "VALIDATION_ERROR");
    expect(repository.reenterVehicles).not.toHaveBeenCalled();
  });

  it.each([
    ["2026-10-20T15:59:59.999Z", 422],
    ["2026-10-20T16:00:00.000Z", 200],
  ])("在 %s 使用上海日期判断再次入库日期", async (now, expectedStatus) => {
    vi.setSystemTime(new Date(now));

    const response = await POST(request());

    expect(response.status).toBe(expectedStatus);
    expect(repository.reenterVehicles).toHaveBeenCalledTimes(expectedStatus === 200 ? 1 : 0);
  });

  it("并发更新时返回 409 并且不返回部分成功结果", async () => {
    repository.reenterVehicles.mockRejectedValueOnce(new repository.VersionConflictError());

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("VERSION_CONFLICT");
    expect(body).not.toHaveProperty("data");
  });

  it("业务规则拒绝时返回整批失败", async () => {
    repository.reenterVehicles.mockRejectedValueOnce(new repository.VehicleReentryError("REENTRY_NOT_ALLOWED", "所选车辆包含未完成出库的车辆", 422));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toEqual({ error: "REENTRY_NOT_ALLOWED", message: "所选车辆包含未完成出库的车辆" });
    expect(body).not.toHaveProperty("data");
    expect(repository.reenterVehicles).toHaveBeenCalledOnce();
  });

  it.each([
    ["P2025", 404, "NOT_FOUND"],
    ["P2034", 409, "VERSION_CONFLICT"],
  ] as const)("处理 Prisma %s 错误", async (code, status, expectedError) => {
    repository.reenterVehicles.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("database operation failed", { code, clientVersion: "6.19.3" }));

    const response = await POST(request());

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: expectedError });
  });
});
