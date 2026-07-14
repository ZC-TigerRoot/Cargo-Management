import { NextResponse } from "next/server";
import { AuthorizationError, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await requireUser("manageUsers");
    const [warehouses, customers] = await Promise.all([
      prisma.warehouse.findMany({ orderBy: { name: "asc" } }),
      prisma.customer.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { vehicles: true } } } }),
    ]);
    return NextResponse.json({ data: {
      warehouses: warehouses.map(warehouse => ({ id: warehouse.id, name: warehouse.name, location: warehouse.location, bonded: warehouse.bonded })),
      customers: customers.map(customer => ({ id: customer.id, name: customer.name, vehicleCount: customer._count.vehicles })),
    } });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: "FORBIDDEN", message: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "DATABASE_ERROR", message: "无法读取基础设置" }, { status: 503 });
  }
}
