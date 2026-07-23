import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { driverSubmission } from "@/lib/validators";
import { prisma } from "@/lib/prisma";
import { requestIp } from "@/lib/auth";
import { MAX_DRIVER_PHOTO_BYTES, removeLocalUpload, storeDriverPhoto, type StoredUpload } from "@/lib/local-upload";
import { isSameOriginRequest } from "@/lib/request-origin";
import { vehicleStatusNames } from "@/lib/vehicle-status";

export const runtime = "nodejs";

const receiptNo = (taskNo: string) => taskNo.replace(/^PU-/, "RC-");

function jsonObject(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
}

function submittedDriver(value: Prisma.JsonValue | null) {
  const submission = jsonObject(value);
  return {
    driverLabel: typeof submission.driverLabel === "string" ? submission.driverLabel : undefined,
    driverName: typeof submission.driverName === "string" ? submission.driverName : undefined,
    driverPhone: typeof submission.driverPhone === "string" ? submission.driverPhone : undefined,
  };
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
      vehicles: task!.items.map(item => ({ id: item.vehicle.id, vin: item.vehicle.vin?.slice(-6), model: item.vehicle.model ?? undefined })),
    } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "暂时无法读取提货任务" }, { status: 503 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let storedUpload: StoredUpload | undefined;
  let uploadCommitted = false;
  try {
    if (!isSameOriginRequest(req)) return NextResponse.json({ error: "INVALID_ORIGIN", message: "请求来源无效" }, { status: 403 });
    if (!req.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
      return NextResponse.json({ error: "INVALID_CONTENT_TYPE", message: "请使用表单上传车辆照片" }, { status: 415 });
    }
    const contentLengthHeader = req.headers.get("content-length");
    if (!contentLengthHeader) return NextResponse.json({ error: "LENGTH_REQUIRED", message: "上传请求必须包含 Content-Length" }, { status: 411 });
    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0) return NextResponse.json({ error: "INVALID_LENGTH", message: "上传请求长度无效" }, { status: 400 });
    if (contentLength > MAX_DRIVER_PHOTO_BYTES + 1_000_000) {
      return NextResponse.json({ error: "PAYLOAD_TOO_LARGE", message: "车辆照片不能超过 5 MB" }, { status: 413 });
    }

    const task = await findTask(token);
    const error = taskError(task);
    if (error) return error;

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "INVALID_FORM", message: "上传表单格式无效" }, { status: 400 });
    }
    const parsed = driverSubmission.safeParse({
      pickupAt: form.get("pickupAt"),
      idempotencyKey: form.get("idempotencyKey"),
      driverName: form.get("driverName"),
      driverPhone: form.get("driverPhone"),
    });
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR", issues: parsed.error.flatten() }, { status: 422 });
    const photo = form.get("photo");
    if (!(photo instanceof File) || !photo.size) {
      return NextResponse.json({ error: "VALIDATION_ERROR", message: "请上传车辆照片" }, { status: 422 });
    }
    if (photo.size > MAX_DRIVER_PHOTO_BYTES) {
      return NextResponse.json({ error: "PAYLOAD_TOO_LARGE", message: "车辆照片不能超过 5 MB" }, { status: 413 });
    }

    if (task!.submittedAt) {
      const previous = jsonObject(task!.driverSubmission);
      if (previous.idempotencyKey === parsed.data.idempotencyKey) {
        return NextResponse.json({ data: { status: "submitted", receiptNo: receiptNo(task!.taskNo), submittedAt: task!.submittedAt.toISOString(), ...submittedDriver(task!.driverSubmission) } });
      }
      return NextResponse.json({ error: "ALREADY_SUBMITTED", message: "该提货任务已经签收" }, { status: 409 });
    }

    const now = new Date();
    storedUpload = await storeDriverPhoto(photo, now);
    const submission = { ...parsed.data, photoPath: storedUpload.objectKey } satisfies Prisma.InputJsonObject;
    const driverActor = `司机：${parsed.data.driverName}`;
    const submitted = await prisma.$transaction(async tx => {
      const claimed = await tx.pickupTask.updateMany({
        where: { id: task!.id, submittedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { submittedAt: now, driverSubmission: submission },
      });
      if (claimed.count !== 1) return false;
      for (const item of task!.items) {
        await tx.vehicle.update({ where: { id: item.vehicle.id }, data: { status: "COMPLETED", version: { increment: 1 } } });
        const signedEvent = await tx.inventoryEvent.create({
          data: {
            vehicleId: item.vehicle.id,
            type: "DRIVER_SIGNED",
            occurredAt: new Date(parsed.data.pickupAt),
            idempotencyKey: `${parsed.data.idempotencyKey}:${item.vehicle.id}`,
            payload: {
              taskNo: task!.taskNo,
              photoUploaded: true,
              driverName: parsed.data.driverName,
              driverPhone: parsed.data.driverPhone,
              actorLabel: driverActor,
              reason: `提货任务 ${task!.taskNo} 已完成，司机已填写信息并上传现场照片。`,
            },
          },
        });
        await tx.attachment.create({
          data: {
            vehicleId: item.vehicle.id,
            inventoryEventId: signedEvent.id,
            objectKey: storedUpload!.objectKey,
            fileName: storedUpload!.fileName,
            mimeType: storedUpload!.mimeType,
            size: storedUpload!.size,
          },
        });
        await tx.auditLog.create({
          data: {
            actorLabel: driverActor,
            action: "PICKUP_SIGNED",
            entityType: "Vehicle",
            entityId: item.vehicle.id,
            before: { status: vehicleStatusNames[item.vehicle.status], version: item.vehicle.version },
            after: { status: "已完成", version: item.vehicle.version + 1, taskNo: task!.taskNo, driverName: parsed.data.driverName, driverPhone: parsed.data.driverPhone },
            ip: requestIp(req),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorLabel: driverActor,
          action: "PICKUP_SIGNED",
          entityType: "PickupTask",
          entityId: task!.id,
          before: { taskNo: task!.taskNo, submittedAt: null, status: "pending" },
          after: { taskNo: task!.taskNo, submittedAt: now.toISOString(), status: "submitted", photoUploaded: true, driverName: parsed.data.driverName, driverPhone: parsed.data.driverPhone, vehicleIds: task!.items.map(item => item.vehicle.id) },
          ip: requestIp(req),
        },
      });
      return true;
    });
    if (!submitted) {
      const latest = await findTask(token);
      const previous = jsonObject(latest?.driverSubmission ?? null);
      if (latest?.submittedAt && previous.idempotencyKey === parsed.data.idempotencyKey) {
        return NextResponse.json({ data: { status: "submitted", receiptNo: receiptNo(latest.taskNo), submittedAt: latest.submittedAt.toISOString(), ...submittedDriver(latest.driverSubmission) } });
      }
      return NextResponse.json({ error: "SUBMISSION_CONFLICT", message: "任务状态已变化，请刷新后重试" }, { status: 409 });
    }
    uploadCommitted = true;
    return NextResponse.json({ data: { status: "submitted", receiptNo: receiptNo(task!.taskNo), submittedAt: now.toISOString(), driverName: parsed.data.driverName, driverPhone: parsed.data.driverPhone } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "IMAGE_TOO_LARGE") {
      return NextResponse.json({ error: "PAYLOAD_TOO_LARGE", message: "车辆照片不能超过 5 MB" }, { status: 413 });
    }
    if (error instanceof Error && (error.message === "EMPTY_IMAGE" || error.message === "UNSUPPORTED_IMAGE")) {
      return NextResponse.json({ error: "INVALID_IMAGE", message: "仅支持 JPEG、PNG、WebP 或 GIF 图片" }, { status: 422 });
    }
    console.error(error);
    return NextResponse.json({ error: "SUBMISSION_FAILED", message: "签收提交失败，请联系仓库人员" }, { status: 503 });
  } finally {
    if (storedUpload && !uploadCommitted) {
      try {
        await removeLocalUpload(storedUpload.objectKey);
      } catch (error) {
        console.error("Failed to clean up uncommitted driver photo", error);
      }
    }
  }
}
