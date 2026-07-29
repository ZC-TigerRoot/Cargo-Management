import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { databaseUrlFromEnv } from "../database-url.mjs";

const prisma = new PrismaClient({ datasourceUrl: databaseUrlFromEnv() });
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME?.trim() || "系统管理员";

if (!email || !password || password.length < 12) {
  throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) before seeding");
}

try {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash, role: "ADMIN" },
    update: { name, passwordHash, role: "ADMIN", active: true, sessionVersion: { increment: 1 } },
  });
  console.log(`Administrator ${email} is ready`);

  if (process.env.SEED_DEMO_DATA === "true") {
    const [customer, warehouse] = await Promise.all([
      prisma.customer.upsert({ where: { name: "新程汽车" }, create: { name: "新程汽车" }, update: {} }),
      prisma.warehouse.upsert({
        where: { name_location: { name: "宁波北仑仓", location: "宁波市北仑区" } },
        create: { name: "宁波北仑仓", location: "宁波市北仑区", bonded: false },
        update: {},
      }),
    ]);
    const batch = await prisma.businessBatch.upsert({
      where: { type_referenceNo_warehouseKey: { type: "DOMESTIC", referenceNo: "PO-240708-C", warehouseKey: warehouse.id } },
      create: { type: "DOMESTIC", referenceNo: "PO-240708-C", warehouseId: warehouse.id, warehouseKey: warehouse.id, manufacturer: "浙江吉利汽车有限公司" },
      update: {},
    });
    const vehicle = await prisma.vehicle.upsert({
      where: { vin: "LGXCE6DB1R0127654" },
      create: {
        vin: "LGXCE6DB1R0127654", model: "星越 L", brand: "吉利", status: "PENDING_PICKUP",
        batchId: batch.id, customerId: customer.id, warehouseId: warehouse.id,
        extra: { warehouseTimezone: "Asia/Shanghai" },
      },
      update: { status: "PENDING_PICKUP", batchId: batch.id, customerId: customer.id, warehouseId: warehouse.id },
    });
    const demoToken = "demo-pickup";
    const task = await prisma.pickupTask.upsert({
      where: { taskNo: "PU-DEMO-001" },
      create: {
        taskNo: "PU-DEMO-001",
        token: demoToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        items: { create: { vehicleId: vehicle.id } },
      },
      update: {
        token: demoToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        revokedAt: null,
        submittedAt: null,
        driverSubmission: Prisma.DbNull,
      },
    });
    await prisma.pickupItem.upsert({
      where: { pickupTaskId_vehicleId: { pickupTaskId: task.id, vehicleId: vehicle.id } },
      create: { pickupTaskId: task.id, vehicleId: vehicle.id },
      update: {},
    });
    console.log("Demo pickup task is available at /driver/demo-pickup");
  }
} finally {
  await prisma.$disconnect();
}
