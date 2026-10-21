import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => {
  class AuthorizationError extends Error {
    constructor(public status: 401 | 403, message: string) { super(message); }
  }
  return {
    AuthorizationError,
    assertSameOrigin: vi.fn(),
    requireUser: vi.fn(),
    vehicleScopeWhere: vi.fn(() => ({})),
    pickupTaskScopeWhere: vi.fn(() => ({})),
    requestIp: vi.fn(() => "203.0.113.8"),
  };
});
const database = vi.hoisted(() => ({
  $transaction: vi.fn(),
  vehicle: { findMany: vi.fn() },
  pickupTask: { findMany: vi.fn() },
}));
const transaction = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  vehicle: { findMany: vi.fn(), update: vi.fn() },
  pickupItem: { findMany: vi.fn() },
  pickupTask: { create: vi.fn() },
  inventoryEvent: { create: vi.fn() },
  auditLog: { create: vi.fn() },
}));

vi.mock("@/lib/auth", () => auth);
vi.mock("@/lib/prisma", () => ({ prisma: database }));
vi.mock("@/lib/datetime", async () => import("../src/lib/datetime"));
vi.mock("@/lib/vehicle-status", async () => import("../src/lib/vehicle-status"));
vi.mock("@/lib/public-url", () => ({
  getPublicBaseUrl: async () => "https://cargo.example.com",
  buildPickupUrl: (base: string, token: string) => `${base}/driver/${token}`,
}));

import { GET, POST } from "../src/app/api/v1/pickups/route";

const currentVehicle = {
  id: "vehicle-1", vin: "VIN-1", model: "测试车型", status: "IN_STOCK", version: 8, currentCycle: 2,
};
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

function task(overrides = {}) {
  return {
    id: "task-1", taskNo: "PU-20261021-TEST", token: "token-1",
    expiresAt: date("2026-10-22"), createdAt: date("2026-10-21"), revokedAt: null, submittedAt: null,
    items: [{ cycle: 2, vehicle: currentVehicle }],
    ...overrides,
  };
}

function request() {
  return {
    nextUrl: new URL("https://cargo.example.com/api/v1/pickups"),
    json: vi.fn(async () => ({ vehicleIds: ["vehicle-1"], expiresAt: "2026-10-22" })),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T02:00:00.000Z"));
  auth.requireUser.mockResolvedValue({ id: "admin-1", roleName: "admin" });
  auth.vehicleScopeWhere.mockReturnValue({});
  auth.pickupTaskScopeWhere.mockReturnValue({});
  database.vehicle.findMany.mockResolvedValue([{ id: currentVehicle.id }]);
  transaction.vehicle.findMany.mockResolvedValue([currentVehicle]);
  transaction.pickupItem.findMany.mockResolvedValue([]);
  transaction.pickupTask.create.mockResolvedValue(task());
  database.$transaction.mockImplementation(async callback => callback(transaction));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("提货任务入库轮次隔离", () => {
  it("新轮次提货只检查当前轮次任务并记录对应轮次", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(transaction.pickupItem.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ vehicleId: "vehicle-1", cycle: 2 }],
        pickupTask: { submittedAt: null, revokedAt: null, expiresAt: { gte: date("2026-10-21") } },
      },
      select: { vehicleId: true },
    });
    expect(transaction.pickupTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ items: { create: [{ vehicleId: "vehicle-1", cycle: 2 }] } }),
    }));
    expect(transaction.inventoryEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "PICKUP_CREATED", vehicleId: "vehicle-1", cycle: 2 }),
    }));
  });

  it("当前轮次仍有有效任务时拒绝重复创建", async () => {
    transaction.pickupItem.findMany.mockResolvedValueOnce([{ vehicleId: "vehicle-1" }]);

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("ACTIVE_TASK_EXISTS");
    expect(transaction.pickupTask.create).not.toHaveBeenCalled();
  });

  it("旧未签任务标记需重新创建，旧已签任务继续保留历史状态", async () => {
    database.pickupTask.findMany.mockResolvedValue([
      task({ id: "old-pending", items: [{ cycle: 1, vehicle: currentVehicle }] }),
      task({ id: "old-signed", submittedAt: date("2026-10-07"), items: [{ cycle: 1, vehicle: currentVehicle }] }),
    ]);

    const response = await GET(request());
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.data.map((item: { id: string; status: string }) => ({ id: item.id, status: item.status }))).toEqual([
      { id: "old-pending", status: "stale" },
      { id: "old-signed", status: "submitted" },
    ]);
  });
});
