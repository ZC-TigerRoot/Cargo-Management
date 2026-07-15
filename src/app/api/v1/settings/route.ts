import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AuthorizationError, requestIp, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPublicBaseUrl, normalizePublicBaseUrl } from "@/lib/public-url";

const settingInput = z.object({ publicBaseUrl: z.string().trim().min(1) });

export async function GET(req: NextRequest) {
  try {
    await requireUser("manageUsers");
    const [warehouses, customers, publicBaseUrl] = await Promise.all([
      prisma.warehouse.findMany({ orderBy: { name: "asc" } }),
      prisma.customer.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { vehicles: true } } } }),
      getPublicBaseUrl(req.nextUrl.origin),
    ]);
    return NextResponse.json({ data: {
      publicBaseUrl,
      warehouses: warehouses.map(warehouse => ({ id: warehouse.id, name: warehouse.name, location: warehouse.location, bonded: warehouse.bonded })),
      customers: customers.map(customer => ({ id: customer.id, name: customer.name, vehicleCount: customer._count.vehicles })),
    } });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: "FORBIDDEN", message: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "无法读取基础设置" }, { status: 503 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser("manageUsers");
    assertSameOrigin(req);
    const parsed = settingInput.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR", message: "请输入完整的当前域名，例如 https://cargo.example.com" }, { status: 422 });

    let publicBaseUrl: string;
    try {
      publicBaseUrl = normalizePublicBaseUrl(parsed.data.publicBaseUrl);
    } catch (error) {
      return NextResponse.json({ error: "INVALID_PUBLIC_URL", message: error instanceof Error ? error.message : "当前域名格式不正确" }, { status: 422 });
    }

    const previous = await prisma.systemSetting.findUnique({ where: { id: "default" } });
    await prisma.$transaction([
      prisma.systemSetting.upsert({
        where: { id: "default" },
        create: { id: "default", publicBaseUrl },
        update: { publicBaseUrl },
      }),
      prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: "SETTINGS_UPDATED",
          entityType: "SystemSetting",
          entityId: "default",
          before: { publicBaseUrl: previous?.publicBaseUrl ?? null },
          after: { publicBaseUrl },
          ip: requestIp(req),
        },
      }),
    ]);
    return NextResponse.json({ data: { publicBaseUrl } });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", message: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "INVALID_JSON", message: "请求内容不是有效的 JSON" }, { status: 400 });
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "无法保存基础设置" }, { status: 503 });
  }
}
