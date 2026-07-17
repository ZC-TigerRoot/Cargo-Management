import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  verifySession: vi.fn(),
  userFindUnique: vi.fn(),
  vehicleFindFirst: vi.fn(),
  warehouseFindUnique: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("../src/lib/session", () => ({ SESSION_COOKIE: "cargo_session", verifySession: mocks.verifySession }));
vi.mock("../src/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    vehicle: { findFirst: mocks.vehicleFindFirst },
    warehouse: { findUnique: mocks.warehouseFindUnique },
  },
}));

import {
  assertSameOrigin,
  AuthorizationError,
  pickupTaskScopeWhere,
  requestIp,
  requirePayloadWarehouseInScope,
  requireUser,
  requireVehicleInScope,
  vehicleScopeWhere,
  type AccessUser,
} from "../src/lib/auth";

const session = {
  userId: "user-1",
  email: "admin@example.com",
  name: "管理员",
  role: "admin",
  sessionVersion: 3,
};

const databaseUser = {
  id: "user-1",
  name: "管理员",
  email: "admin@example.com",
  active: true,
  role: "ADMIN",
  sessionVersion: 3,
  customerId: null,
  warehouseScopes: [],
};

function accessUser(overrides: Partial<AccessUser> = {}): AccessUser {
  return { id: "user-1", name: "测试用户", roleName: "admin", customerId: null, warehouseScopes: [], ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "signed-token" }) });
  mocks.verifySession.mockResolvedValue(session);
  mocks.userFindUnique.mockResolvedValue(databaseUser);
});

describe("认证与权限边界", () => {
  it("拒绝缺失、停用、过期和权限不足的会话", async () => {
    mocks.cookies.mockResolvedValueOnce({ get: () => undefined });
    mocks.verifySession.mockResolvedValueOnce(undefined);
    await expect(requireUser("view")).rejects.toMatchObject({ status: 401 });

    mocks.verifySession.mockResolvedValueOnce(session);
    mocks.userFindUnique.mockResolvedValueOnce({ ...databaseUser, active: false });
    await expect(requireUser("view")).rejects.toMatchObject({ status: 401 });

    mocks.verifySession.mockResolvedValueOnce(session);
    mocks.userFindUnique.mockResolvedValueOnce({ ...databaseUser, sessionVersion: 4 });
    await expect(requireUser("view")).rejects.toMatchObject({ status: 401 });

    mocks.verifySession.mockResolvedValueOnce({ ...session, role: "customer" });
    mocks.userFindUnique.mockResolvedValueOnce({ ...databaseUser, role: "CUSTOMER" });
    await expect(requireUser("export")).rejects.toMatchObject({ status: 403 });
  });

  it("返回数据库中的最新角色和数据范围", async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      ...databaseUser,
      role: "WAREHOUSE",
      warehouseScopes: [{ warehouseId: "warehouse-1" }],
    });

    await expect(requireUser("view")).resolves.toMatchObject({
      id: "user-1",
      roleName: "warehouse",
      warehouseScopes: [{ warehouseId: "warehouse-1" }],
    });
  });

  it("按客户、仓库和管理角色生成车辆与提货任务范围", () => {
    const customer = accessUser({ roleName: "customer", customerId: null });
    const warehouse = accessUser({ roleName: "warehouse", warehouseScopes: [{ warehouseId: "w1" }, { warehouseId: "w2" }] });

    expect(vehicleScopeWhere(customer)).toEqual({ customerId: "__unassigned_customer__" });
    expect(vehicleScopeWhere(warehouse)).toEqual({ warehouseId: { in: ["w1", "w2"] } });
    expect(vehicleScopeWhere(accessUser())).toEqual({});
    expect(pickupTaskScopeWhere(warehouse)).toEqual({
      items: {
        some: { vehicle: { warehouseId: { in: ["w1", "w2"] } } },
        every: { vehicle: { warehouseId: { in: ["w1", "w2"] } } },
      },
    });
    expect(pickupTaskScopeWhere(accessUser())).toEqual({});
  });

  it("验证车辆和仓库均在仓管的数据范围内", async () => {
    const warehouseUser = accessUser({ roleName: "warehouse", warehouseScopes: [{ warehouseId: "w1" }] });
    mocks.vehicleFindFirst.mockResolvedValueOnce(null);
    await expect(requireVehicleInScope(warehouseUser, "vehicle-1")).rejects.toMatchObject({ status: 403 });

    mocks.vehicleFindFirst.mockResolvedValueOnce({ id: "vehicle-1" });
    await expect(requireVehicleInScope(warehouseUser, "vehicle-1")).resolves.toBeUndefined();

    await expect(requirePayloadWarehouseInScope(warehouseUser, "仓库 A")).rejects.toMatchObject({ status: 403 });
    mocks.warehouseFindUnique.mockResolvedValueOnce({ id: "w2" });
    await expect(requirePayloadWarehouseInScope(warehouseUser, "仓库 A", "上海")).rejects.toMatchObject({ status: 403 });
    mocks.warehouseFindUnique.mockResolvedValueOnce({ id: "w1" });
    await expect(requirePayloadWarehouseInScope(warehouseUser, "仓库 A", "上海")).resolves.toBeUndefined();
    await expect(requirePayloadWarehouseInScope(accessUser(), "任意仓库", "任意地点")).resolves.toBeUndefined();
  });

  it("拒绝跨站写请求并提取首个代理 IP", () => {
    const crossSite = {
      nextUrl: new URL("https://cargo.example.com/api/v1/vehicles"),
      headers: new Headers({ origin: "https://evil.example.com", host: "cargo.example.com", "x-forwarded-for": "203.0.113.8, 10.0.0.1" }),
    };
    expect(() => assertSameOrigin(crossSite as never)).toThrow(AuthorizationError);
    expect(requestIp(crossSite as never)).toBe("203.0.113.8");
    expect(requestIp({ ...crossSite, headers: new Headers({ "x-real-ip": "198.51.100.9" }) } as never)).toBe("198.51.100.9");
  });
});
