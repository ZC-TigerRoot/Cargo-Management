import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { VehicleStatus } from "@prisma/client";
import { z } from "zod";
import { assertSameOrigin, AuthorizationError, pickupTaskScopeWhere, requestIp, requireUser, vehicleScopeWhere } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildPickupUrl, getPublicBaseUrl } from "@/lib/public-url";

const pickupInput = z.object({
  vehicleIds: z.array(z.string().min(1)).min(1).max(50),
  expiresAt: z.iso.datetime(),
});

const statusLabels: Record<VehicleStatus, string> = {
  PENDING_INBOUND: "待入库", IN_STOCK: "在库", PENDING_RELEASE: "待放车", PENDING_PICKUP: "待提货",
  OUTBOUND: "已出库", PENDING_RECEIPT: "待签收", COMPLETED: "已完成", EXCEPTION: "异常",
};

function taskData(task: {
  id: string; taskNo: string; token: string; expiresAt: Date; revokedAt: Date | null; submittedAt: Date | null; createdAt: Date;
  items: { vehicle: { id: string; vin: string | null; model: string | null } }[];
}, publicBaseUrl: string) {
  const tokenPath = `/driver/${encodeURIComponent(task.token)}`;
  return {
    id: task.id,
    taskNo: task.taskNo,
    tokenPath,
    pickupUrl: buildPickupUrl(publicBaseUrl, task.token),
    expiresAt: task.expiresAt.toISOString(),
    createdAt: task.createdAt.toISOString(),
    status: task.revokedAt ? "revoked" : task.submittedAt ? "submitted" : task.expiresAt <= new Date() ? "expired" : "pending",
    vehicles: task.items.map(item => ({ ...item.vehicle, vin: item.vehicle.vin ?? undefined, model: item.vehicle.model ?? undefined })),
  };
}

const include = { items: { include: { vehicle: { select: { id: true, vin: true, model: true } } } } } as const;

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser("coordinatePickups");
    const [tasks, publicBaseUrl] = await Promise.all([
      prisma.pickupTask.findMany({ where: pickupTaskScopeWhere(user), include, orderBy: { createdAt: "desc" }, take: 100 }),
      getPublicBaseUrl(req.nextUrl.origin),
    ]);
    return NextResponse.json({ data: tasks.map(task => taskData(task, publicBaseUrl)) });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: "UNAUTHENTICATED", message: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "无法读取提货任务" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser("create");
    assertSameOrigin(req);
    const parsed = pickupInput.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR", issues: parsed.error.flatten() }, { status: 422 });
    const expiresAt = new Date(parsed.data.expiresAt);
    if (expiresAt <= new Date()) return NextResponse.json({ error: "INVALID_EXPIRY", message: "二维码有效期必须晚于当前时间" }, { status: 422 });
    const vehicleIds = [...new Set(parsed.data.vehicleIds)];
    const vehicles = await prisma.vehicle.findMany({
      where: { id: { in: vehicleIds }, ...vehicleScopeWhere(user) },
      select: { id: true, vin: true, model: true, status: true, version: true },
    });
    if (vehicles.length !== vehicleIds.length) return NextResponse.json({ error: "VEHICLE_NOT_FOUND", message: "部分车辆不存在，请刷新后重试" }, { status: 404 });
    const unavailable = vehicles.filter(vehicle => !["IN_STOCK", "PENDING_RELEASE", "PENDING_PICKUP"].includes(vehicle.status));
    if (unavailable.length) return NextResponse.json({ error: "VEHICLE_NOT_AVAILABLE", message: `以下车辆当前不可提货：${unavailable.map(vehicle => vehicle.vin || vehicle.model || vehicle.id).join("、")}` }, { status: 409 });
    const activeItems = await prisma.pickupItem.findMany({
      where: { vehicleId: { in: vehicleIds }, pickupTask: { submittedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } },
      select: { vehicleId: true },
    });
    if (activeItems.length) {
      const vins = vehicles.filter(vehicle => activeItems.some(item => item.vehicleId === vehicle.id)).map(vehicle => vehicle.vin || vehicle.model || vehicle.id);
      return NextResponse.json({ error: "ACTIVE_TASK_EXISTS", message: `以下车辆已有有效提货任务：${vins.join("、")}。请在右侧任务卡片中查看二维码。` }, { status: 409 });
    }

    const token = randomBytes(24).toString("base64url");
    const publicBaseUrl = await getPublicBaseUrl(req.nextUrl.origin);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "");
    const taskNo = `PU-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const task = await prisma.$transaction(async tx => {
      const created = await tx.pickupTask.create({
        data: {
          taskNo,
          token,
          expiresAt,
          items: { create: vehicles.map(vehicle => ({ vehicleId: vehicle.id })) },
        },
        include,
      });
      for (const vehicle of vehicles) {
        await tx.vehicle.update({ where: { id: vehicle.id }, data: { status: "PENDING_PICKUP", version: { increment: 1 } } });
        await tx.inventoryEvent.create({
          data: {
            vehicleId: vehicle.id,
            type: "PICKUP_CREATED",
            occurredAt: new Date(),
            actorId: user.id,
            idempotencyKey: `${created.id}:${vehicle.id}`,
            payload: { taskNo, expiresAt: expiresAt.toISOString() },
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: "PICKUP_CREATED",
            entityType: "Vehicle",
            entityId: vehicle.id,
            before: { status: statusLabels[vehicle.status], version: vehicle.version },
            after: { status: "待提货", version: vehicle.version + 1, taskNo },
            ip: requestIp(req),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "PICKUP_CREATED",
          entityType: "PickupTask",
          entityId: created.id,
          after: { taskNo, expiresAt: expiresAt.toISOString(), vehicleIds },
          ip: requestIp(req),
        },
      });
      return created;
    });
    return NextResponse.json({ data: taskData(task, publicBaseUrl) }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", message: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "INVALID_JSON", message: "请求内容不是有效的 JSON" }, { status: 400 });
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "创建提货任务失败" }, { status: 503 });
  }
}
