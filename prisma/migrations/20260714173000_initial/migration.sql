CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "Role" AS ENUM ('WAREHOUSE', 'OPERATOR', 'VIEWER', 'ADMIN');
CREATE TYPE "BusinessType" AS ENUM ('OVERSEAS', 'DOMESTIC');
CREATE TYPE "VehicleStatus" AS ENUM ('PENDING_INBOUND', 'IN_STOCK', 'PENDING_RELEASE', 'PENDING_PICKUP', 'OUTBOUND', 'PENDING_RECEIPT', 'COMPLETED', 'EXCEPTION');
CREATE TYPE "EventType" AS ENUM ('CREATED', 'INBOUND', 'MERCHANT_RELEASE', 'TRANSFER_DOC_NOTICE', 'CUSTOMER_RELEASE', 'PICKUP_CREATED', 'OUTBOUND', 'DRIVER_SIGNED', 'RECEIPT_DELIVERED', 'OUTBOUND_NOTICE_DELIVERED', 'CUSTOMER_RECEIPT_DELIVERED', 'AGENT_RECEIPT_DELIVERED', 'CORRECTION', 'EXCEPTION');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "scopes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "bonded" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BusinessBatch" (
    "id" TEXT NOT NULL,
    "type" "BusinessType" NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "portOfLoad" TEXT,
    "portOfDischarge" TEXT,
    "vesselVoyage" TEXT,
    "etd" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "manufacturer" TEXT,
    "extra" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "brand" TEXT,
    "hsCode" TEXT,
    "status" "VehicleStatus" NOT NULL DEFAULT 'PENDING_INBOUND',
    "version" INTEGER NOT NULL DEFAULT 1,
    "inboundAt" TIMESTAMP(3),
    "outboundAt" TIMESTAMP(3),
    "pickupDetails" TEXT,
    "notes" TEXT,
    "extra" JSONB NOT NULL DEFAULT '{}',
    "batchId" TEXT,
    "customerId" TEXT,
    "warehouseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryEvent" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "correctionOfId" TEXT,
    "actorId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PickupTask" (
    "id" TEXT NOT NULL,
    "taskNo" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "driverSubmission" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PickupTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PickupItem" (
    "pickupTaskId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    CONSTRAINT "PickupItem_pkey" PRIMARY KEY ("pickupTaskId", "vehicleId")
);

CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Customer_name_key" ON "Customer"("name");
CREATE UNIQUE INDEX "Warehouse_name_location_key" ON "Warehouse"("name", "location");
CREATE UNIQUE INDEX "BusinessBatch_type_referenceNo_key" ON "BusinessBatch"("type", "referenceNo");
CREATE UNIQUE INDEX "Vehicle_vin_key" ON "Vehicle"("vin");
CREATE UNIQUE INDEX "InventoryEvent_idempotencyKey_key" ON "InventoryEvent"("idempotencyKey");
CREATE INDEX "InventoryEvent_vehicleId_occurredAt_idx" ON "InventoryEvent"("vehicleId", "occurredAt");
CREATE UNIQUE INDEX "PickupTask_taskNo_key" ON "PickupTask"("taskNo");
CREATE UNIQUE INDEX "PickupTask_tokenHash_key" ON "PickupTask"("tokenHash");
CREATE UNIQUE INDEX "Attachment_objectKey_key" ON "Attachment"("objectKey");
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BusinessBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PickupItem" ADD CONSTRAINT "PickupItem_pickupTaskId_fkey" FOREIGN KEY ("pickupTaskId") REFERENCES "PickupTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PickupItem" ADD CONSTRAINT "PickupItem_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
