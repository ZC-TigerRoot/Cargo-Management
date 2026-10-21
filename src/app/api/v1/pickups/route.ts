import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertSameOrigin, AuthorizationError, pickupTaskScopeWhere, requestIp, requireUser, vehicleScopeWhere } from "@/lib/auth";
import { addCalendarDays, chinaToday, fromPrismaDate, toPrismaDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { buildPickupUrl, getPublicBaseUrl } from "@/lib/public-url";
import { vehicleStatusNames } from "@/lib/vehicle-status";

const pickupInput = z.object({
  vehicleIds: z.array(z.string().min(1)).min(1).max(50),
  expiresAt: z.iso.date(),
});
const revokeInput = z.object({ id: z.string().min(1).max(128), action: z.literal("revoke") });

class PickupCreationError extends Error {
  constructor(public code: string, message: string, public status: 404 | 409) {
    super(message);
  }
}

function taskData(task: {
  id: string; taskNo: string; token: string; expiresAt: Date; revokedAt: Date | null; submittedAt: Date | null; createdAt: Date;
  items: { cycle: number; vehicle: { id: string; vin: string | null; model: string | null; currentCycle: number } }[];
}, publicBaseUrl: string, today = chinaToday()) {
  const tokenPath = `/driver/${encodeURIComponent(task.token)}`;
  const expiresAt = fromPrismaDate(task.expiresAt);
  return {
    id: task.id,
    taskNo: task.taskNo,
    tokenPath,
    pickupUrl: buildPickupUrl(publicBaseUrl, task.token),
    expiresAt,
    createdAt: fromPrismaDate(task.createdAt),
    status: task.revokedAt ? "revoked" : task.submittedAt ? "submitted" : expiresAt < today ? "expired" : task.items.some(item => item.cycle !== item.vehicle.currentCycle) ? "stale" : "pending",
    vehicles: task.items.map(item => ({ id: item.vehicle.id, vin: item.vehicle.vin ?? undefined, model: item.vehicle.model ?? undefined })),
  };
}

const include = { items: { include: { vehicle: { select: { id: true, vin: true, model: true, currentCycle: true } } } } } as const;

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser("coordinatePickups");
    const today = chinaToday();
    const [tasks, publicBaseUrl] = await Promise.all([
      prisma.pickupTask.findMany({ where: pickupTaskScopeWhere(user), include, orderBy: { recordSequence: "desc" }, take: 100 }),
      getPublicBaseUrl(req.nextUrl.origin),
    ]);
    return NextResponse.json({ data: tasks.map(task => taskData(task, publicBaseUrl, today)) });
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
    const today = chinaToday();
    if (parsed.data.expiresAt < today) return NextResponse.json({ error: "INVALID_EXPIRY", message: "二维码有效期不能早于今天" }, { status: 422 });
    if (parsed.data.expiresAt > addCalendarDays(today, 30)) {
      return NextResponse.json({ error: "INVALID_EXPIRY", message: "二维码有效期不能超过 30 天" }, { status: 422 });
    }
    const expiresAt = toPrismaDate(parsed.data.expiresAt);
    const todayDate = toPrismaDate(today);
    const vehicleIds = [...new Set(parsed.data.vehicleIds)];
    const scopedVehicles = await prisma.vehicle.findMany({
      where: { id: { in: vehicleIds }, ...vehicleScopeWhere(user) },
      select: { id: true },
    });
    if (scopedVehicles.length !== vehicleIds.length) return NextResponse.json({ error: "VEHICLE_NOT_FOUND", message: "部分车辆不存在，请刷新后重试" }, { status: 404 });

    const token = randomBytes(24).toString("base64url");
    const publicBaseUrl = await getPublicBaseUrl(req.nextUrl.origin);
    const date = today.replaceAll("-", "");
    const taskNo = `PU-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const task = await prisma.$transaction(async tx => {
      // Serialize task creation per vehicle so concurrent requests cannot both
      // pass the active-task check and create duplicate pickup links.
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "Vehicle"
        WHERE "id" IN (${Prisma.join(vehicleIds)})
        ORDER BY "id"
        FOR UPDATE
      `);
      const vehicles = await tx.vehicle.findMany({
        where: { id: { in: vehicleIds }, ...vehicleScopeWhere(user) },
        select: { id: true, vin: true, model: true, status: true, version: true, currentCycle: true },
      });
      if (vehicles.length !== vehicleIds.length) {
        throw new PickupCreationError("VEHICLE_NOT_FOUND", "部分车辆不存在，请刷新后重试", 404);
      }
      const unavailable = vehicles.filter(vehicle => !["IN_STOCK", "PENDING_RELEASE", "PENDING_PICKUP"].includes(vehicle.status));
      if (unavailable.length) {
        const labels = unavailable.map(vehicle => vehicle.vin || vehicle.model || vehicle.id);
        throw new PickupCreationError("VEHICLE_NOT_AVAILABLE", `以下车辆当前不可提货：${labels.join("、")}`, 409);
      }
      const activeItems = await tx.pickupItem.findMany({
        where: {
          OR: vehicles.map(vehicle => ({ vehicleId: vehicle.id, cycle: vehicle.currentCycle })),
          pickupTask: { submittedAt: null, revokedAt: null, expiresAt: { gte: todayDate } },
        },
        select: { vehicleId: true },
      });
      if (activeItems.length) {
        const activeIds = new Set(activeItems.map(item => item.vehicleId));
        const labels = vehicles.filter(vehicle => activeIds.has(vehicle.id)).map(vehicle => vehicle.vin || vehicle.model || vehicle.id);
        throw new PickupCreationError("ACTIVE_TASK_EXISTS", `以下车辆已有有效提货任务：${labels.join("、")}。请在右侧任务卡片中查看二维码。`, 409);
      }
      const created = await tx.pickupTask.create({
        data: {
          taskNo,
          token,
          expiresAt,
          items: { create: vehicles.map(vehicle => ({ vehicleId: vehicle.id, cycle: vehicle.currentCycle })) },
        },
        include,
      });
      for (const vehicle of vehicles) {
        await tx.vehicle.update({ where: { id: vehicle.id }, data: { status: "PENDING_PICKUP", version: { increment: 1 } } });
        await tx.inventoryEvent.create({
          data: {
            vehicleId: vehicle.id,
            cycle: vehicle.currentCycle,
            type: "PICKUP_CREATED",
            occurredAt: todayDate,
            actorId: user.id,
            idempotencyKey: `${created.id}:${vehicle.id}`,
            payload: { taskNo, expiresAt: fromPrismaDate(expiresAt) },
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: "PICKUP_CREATED",
            entityType: "Vehicle",
            entityId: vehicle.id,
            before: { status: vehicleStatusNames[vehicle.status], version: vehicle.version },
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
          after: { taskNo, expiresAt: fromPrismaDate(expiresAt), vehicleIds },
          ip: requestIp(req),
        },
      });
      return created;
    });
    return NextResponse.json({ data: taskData(task, publicBaseUrl, today) }, { status: 201 });
  } catch (error) {
    if (error instanceof PickupCreationError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    if (error instanceof AuthorizationError) return NextResponse.json({ error: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", message: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "INVALID_JSON", message: "请求内容不是有效的 JSON" }, { status: 400 });
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "创建提货任务失败" }, { status: 503 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser("coordinatePickups");
    assertSameOrigin(req);
    const parsed = revokeInput.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR", message: "撤销请求无效" }, { status: 422 });

    const task = await prisma.pickupTask.findFirst({
      where: { id: parsed.data.id, ...pickupTaskScopeWhere(user) },
      select: { id: true, taskNo: true, expiresAt: true, submittedAt: true, revokedAt: true },
    });
    if (!task) return NextResponse.json({ error: "NOT_FOUND", message: "提货任务不存在" }, { status: 404 });
    if (task.submittedAt) return NextResponse.json({ error: "ALREADY_SUBMITTED", message: "已签收的提货任务不能撤销" }, { status: 409 });
    if (task.revokedAt) return NextResponse.json({ data: { id: task.id, status: "revoked", revokedAt: fromPrismaDate(task.revokedAt) } });

    const today = chinaToday();
    if (fromPrismaDate(task.expiresAt) < today) {
      return NextResponse.json({ error: "TASK_EXPIRED", message: "已过期的提货任务不能撤销" }, { status: 409 });
    }
    const revokedAt = toPrismaDate(today);
    const revoked = await prisma.$transaction(async tx => {
      const updated = await tx.pickupTask.updateMany({
        where: { id: task.id, submittedAt: null, revokedAt: null, expiresAt: { gte: revokedAt } },
        data: { revokedAt },
      });
      if (updated.count !== 1) return false;
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "PICKUP_REVOKED",
          entityType: "PickupTask",
          entityId: task.id,
          before: { taskNo: task.taskNo, status: "pending", revokedAt: null },
          after: { taskNo: task.taskNo, status: "revoked", revokedAt: fromPrismaDate(revokedAt) },
          ip: requestIp(req),
        },
      });
      return true;
    });
    if (!revoked) return NextResponse.json({ error: "SUBMISSION_CONFLICT", message: "任务状态已变化，请刷新后重试" }, { status: 409 });
    return NextResponse.json({ data: { id: task.id, status: "revoked", revokedAt: fromPrismaDate(revokedAt) } });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", message: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "INVALID_JSON", message: "请求内容不是有效的 JSON" }, { status: 400 });
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "撤销提货任务失败" }, { status: 503 });
  }
}
