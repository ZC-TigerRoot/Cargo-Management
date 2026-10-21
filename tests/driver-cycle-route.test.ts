import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  $transaction: vi.fn(),
  pickupTask: { findUnique: vi.fn() },
}));
const transaction = vi.hoisted(() => ({
  pickupTask: { updateMany: vi.fn() },
  vehicle: { updateMany: vi.fn() },
  inventoryEvent: { create: vi.fn() },
  attachment: { create: vi.fn() },
  auditLog: { create: vi.fn() },
}));
const uploads = vi.hoisted(() => ({
  MAX_DRIVER_PHOTO_BYTES: 5_000_000,
  storeDriverPhoto: vi.fn(),
  removeLocalUpload: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: database }));
vi.mock("@/lib/datetime", async () => import("../src/lib/datetime"));
vi.mock("@/lib/validators", async () => import("../src/lib/validators"));
vi.mock("@/lib/vehicle-status", async () => import("../src/lib/vehicle-status"));
vi.mock("@/lib/auth", () => ({ requestIp: vi.fn(() => "203.0.113.8") }));
vi.mock("@/lib/request-origin", () => ({ isSameOriginRequest: () => true }));
vi.mock("@/lib/local-upload", () => uploads);

import { GET, POST } from "../src/app/api/v1/driver/[token]/route";

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const item = (id: string, cycle = 2, currentCycle = cycle) => ({
  vehicleId: id, cycle,
  vehicle: { id, vin: `VIN-${id}`, model: "测试车型", status: "PENDING_PICKUP", version: 8, currentCycle },
});
const context = { params: Promise.resolve({ token: "token-1" }) };

function task(overrides = {}) {
  return {
    id: "task-1", taskNo: "PU-20261021-TEST", token: "token-1", expiresAt: date("2026-10-22"),
    revokedAt: null, submittedAt: null, driverSubmission: null, items: [item("vehicle-1")],
    ...overrides,
  };
}

function request() {
  const form = new FormData();
  form.set("idempotencyKey", "driver-submission-1");
  form.set("driverName", "测试司机");
  form.set("driverPhone", "13800000000");
  form.set("photo", new File(["photo"], "vehicle.jpg", { type: "image/jpeg" }));
  return {
    headers: new Headers({ "content-type": "multipart/form-data; boundary=test", "content-length": "1024" }),
    formData: vi.fn(async () => form),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T02:00:00.000Z"));
  database.pickupTask.findUnique.mockResolvedValue(task());
  database.$transaction.mockImplementation(async callback => callback(transaction));
  transaction.pickupTask.updateMany.mockResolvedValue({ count: 1 });
  transaction.vehicle.updateMany.mockResolvedValue({ count: 1 });
  transaction.inventoryEvent.create.mockResolvedValue({ id: "event-1" });
  uploads.storeDriverPhoto.mockResolvedValue({ objectKey: "driver/photo.jpg", fileName: "vehicle.jpg", mimeType: "image/jpeg", size: 5 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("司机签收入库轮次隔离", () => {
  it("有任意一台车辆返库时整条未签任务不能打开或提交", async () => {
    database.pickupTask.findUnique.mockResolvedValue(task({ items: [item("vehicle-1", 1, 2), item("vehicle-2")] }));

    const get = await GET(request(), context);
    const post = await POST(request(), context);

    expect(get.status).toBe(409);
    expect((await get.json()).error).toBe("TASK_CYCLE_CHANGED");
    expect(post.status).toBe(409);
    expect((await post.json()).message).toContain("重新创建提货任务");
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(uploads.storeDriverPhoto).not.toHaveBeenCalled();
  });

  it("返库后仍可查看上一轮已签任务的签收结果", async () => {
    database.pickupTask.findUnique.mockResolvedValue(task({
      submittedAt: date("2026-10-07"),
      driverSubmission: { idempotencyKey: "driver-submission-1", driverName: "原司机", driverPhone: "13800000000" },
      items: [item("vehicle-1", 1, 2)],
    }));

    const response = await GET(request(), context);
    const replay = await POST(request(), context);

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      status: "submitted", receiptNo: "RC-20261021-TEST", submittedAt: "2026-10-07", driverName: "原司机",
    });
    expect(replay.status).toBe(200);
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(uploads.storeDriverPhoto).not.toHaveBeenCalled();
  });

  it("当前任务按轮次与版本更新车辆并记录当前轮次签收历史", async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(201);
    expect(transaction.vehicle.updateMany).toHaveBeenCalledWith({
      where: { id: "vehicle-1", currentCycle: 2, version: 8 },
      data: { status: "COMPLETED", version: { increment: 1 } },
    });
    expect(transaction.inventoryEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ vehicleId: "vehicle-1", cycle: 2, type: "DRIVER_SIGNED" }),
    });
    expect(transaction.attachment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ inventoryEventId: "event-1", objectKey: "driver/photo.jpg" }) });
    expect(uploads.removeLocalUpload).not.toHaveBeenCalled();
  });

  it("上传期间车辆返库或更新则抛出冲突以回滚整个事务并清理文件", async () => {
    database.pickupTask.findUnique.mockResolvedValue(task({ items: [item("vehicle-2"), item("vehicle-1")] }));
    transaction.vehicle.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const rolledBack = vi.fn();
    database.$transaction.mockImplementation(async callback => {
      try {
        return await callback(transaction);
      } catch (error) {
        rolledBack(error);
        throw error;
      }
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("SUBMISSION_CONFLICT");
    expect(rolledBack).toHaveBeenCalledWith(expect.any(Error));
    expect(transaction.vehicle.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { id: "vehicle-1", currentCycle: 2, version: 8 } }));
    expect(transaction.vehicle.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { id: "vehicle-2", currentCycle: 2, version: 8 } }));
    expect(transaction.auditLog.create).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entityType: "PickupTask" }) }));
    expect(uploads.removeLocalUpload).toHaveBeenCalledWith("driver/photo.jpg");
  });
});
