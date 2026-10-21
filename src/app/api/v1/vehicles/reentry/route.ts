import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { assertSameOrigin, AuthorizationError, requestIp, requireUser, vehicleScopeWhere } from "@/lib/auth";
import { vehicleReentryInput } from "@/lib/validators";
import { reenterVehicles, toVehicleRecord, VehicleReentryError, VersionConflictError } from "@/lib/vehicle-repository";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser("correct");
    assertSameOrigin(req);
    const parsed = vehicleReentryInput.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "VALIDATION_ERROR", issues: parsed.error.flatten() }, { status: 422 });
    }
    const vehicles = await reenterVehicles(parsed.data, { actorId: user.id, ip: requestIp(req) }, vehicleScopeWhere(user));
    return NextResponse.json({ data: vehicles.map(toVehicleRecord), meta: { total: vehicles.length } });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", message: error.message }, { status: error.status });
    }
    if (error instanceof VersionConflictError) {
      return NextResponse.json({ error: "VERSION_CONFLICT", message: error.message }, { status: 409 });
    }
    if (error instanceof VehicleReentryError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "INVALID_JSON", message: "请求内容不是有效的 JSON" }, { status: 400 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "VALIDATION_ERROR", issues: error.flatten() }, { status: 422 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "NOT_FOUND", message: "车辆档案不存在或已被删除" }, { status: 404 });
      }
      if (error.code === "P2034") {
        return NextResponse.json({ error: "VERSION_CONFLICT", message: "车辆记录已被其他用户更新，请刷新后重试" }, { status: 409 });
      }
    }
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "再次入库失败，请稍后重试" }, { status: 503 });
  }
}
