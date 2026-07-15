import { NextRequest, NextResponse } from "next/server";
import type { Prisma, VehicleStatus } from "@prisma/client";
import { driverSubmission } from "@/lib/validators";
import { prisma } from "@/lib/prisma";
import { requestIp } from "@/lib/auth";

const receiptNo = (taskNo: string) => taskNo.replace(/^PU-/, "RC-");
const statusLabels: Record<VehicleStatus, string> = {
  PENDING_INBOUND: "待入库", IN_STOCK: "在库", PENDING_RELEASE: "待放车", PENDING_PICKUP: "待提货",
  OUTBOUND: "已出库", PENDING_RECEIPT: "待签收", COMPLETED: "已完成", EXCEPTION: "异常",
};

function jsonObject(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
}

async function findTask(token: string) {
  return prisma.pickupTask.findUnique({
    where: { token },
    include: { items: { include: { vehicle: { select: { id: true, vin: true, model: true, status: true, version: true } } } } },
  });
}

function taskError(task: Awaited<ReturnType<typeof findTask>>, now = new Date()) {
  if (!task) return NextResponse.json({ error: "TASK_NOT_FOUND", message: "提货任务不存在" }, { status: 404 });
  if (task.revokedAt) return NextResponse.json({ error: "TASK_REVOKED", message: "该提货链接已撤销" }, { status: 410 });
  if (task.expiresAt <= now) return NextResponse.json({ error: "TASK_EXPIRED", message: "该提货链接已过期" }, { status: 410 });
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const task = await findTask(token);
    const error = taskError(task);
    if (error) return error;
    return NextResponse.json({ data: {
      taskNo: task!.taskNo,
      expiresAt: task!.expiresAt.toISOString(),
      status: task!.submittedAt ? "submitted" : "pending",
      submittedAt: task!.submittedAt?.toISOString(),
      receiptNo: task!.submittedAt ? receiptNo(task!.taskNo) : undefined,
      vehicles: task!.items.map(item => ({ vin: item.vehicle.vin, model: item.vehicle.model })),
    } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "暂时无法读取提货任务" }, { status: 503 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const origin = req.headers.get("origin");
    if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: "INVALID_ORIGIN", message: "请求来源无效" }, { status: 403 });
    const parsed = driverSubmission.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR", issues: parsed.error.flatten() }, { status: 422 });

    const task = await findTask(token);
    const error = taskError(task);
    if (error) return error;
    if (task!.submittedAt) {
      const previous = jsonObject(task!.driverSubmission);
      if (previous.idempotencyKey === parsed.data.idempotencyKey) {
        return NextResponse.json({ data: { status: "submitted", receiptNo: receiptNo(task!.taskNo), submittedAt: task!.submittedAt.toISOString() } });
      }
      return NextResponse.json({ error: "ALREADY_SUBMITTED", message: "该提货任务已经签收" }, { status: 409 });
    }

    const now = new Date();
    const submission = JSON.parse(JSON.stringify(parsed.data)) as Prisma.InputJsonValue;
    const submitted = await prisma.$transaction(async tx => {
      const claimed = await tx.pickupTask.updateMany({
        where: { id: task!.id, submittedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { submittedAt: now, driverSubmission: submission },
      });
      if (claimed.count !== 1) return false;
      for (const item of task!.items) {
        await tx.vehicle.update({ where: { id: item.vehicle.id }, data: { status: "COMPLETED", version: { increment: 1 } } });
        await tx.inventoryEvent.create({
          data: {
            vehicleId: item.vehicle.id,
            type: "DRIVER_SIGNED",
            occurredAt: new Date(parsed.data.pickupAt),
            idempotencyKey: `${parsed.data.idempotencyKey}:${item.vehicle.id}`,
            payload: { taskNo: task!.taskNo, photoUploaded: true, actorLabel: "司机（提货链接）" },
          },
        });
        await tx.auditLog.create({
          data: {
            actorLabel: "司机（提货链接）",
            action: "PICKUP_SIGNED",
            entityType: "Vehicle",
            entityId: item.vehicle.id,
            before: { status: statusLabels[item.vehicle.status], version: item.vehicle.version },
            after: { status: "已完成", version: item.vehicle.version + 1, taskNo: task!.taskNo },
            ip: requestIp(req),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorLabel: "司机（提货链接）",
          action: "PICKUP_SIGNED",
          entityType: "PickupTask",
          entityId: task!.id,
          before: { taskNo: task!.taskNo, submittedAt: null, status: "pending" },
          after: { taskNo: task!.taskNo, submittedAt: now.toISOString(), status: "submitted", photoUploaded: true, vehicleIds: task!.items.map(item => item.vehicle.id) },
          ip: requestIp(req),
        },
      });
      return true;
    });
    if (!submitted) {
      const latest = await findTask(token);
      const previous = jsonObject(latest?.driverSubmission ?? null);
      if (latest?.submittedAt && previous.idempotencyKey === parsed.data.idempotencyKey) {
        return NextResponse.json({ data: { status: "submitted", receiptNo: receiptNo(latest.taskNo), submittedAt: latest.submittedAt.toISOString() } });
      }
      return NextResponse.json({ error: "SUBMISSION_CONFLICT", message: "任务状态已变化，请刷新后重试" }, { status: 409 });
    }
    return NextResponse.json({ data: { status: "submitted", receiptNo: receiptNo(task!.taskNo), submittedAt: now.toISOString() } }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "INVALID_JSON", message: "请求内容不是有效的 JSON" }, { status: 400 });
    console.error(error);
    return NextResponse.json({ error: "SUBMISSION_FAILED", message: "签收提交失败，请联系仓库人员" }, { status: 503 });
  }
}
