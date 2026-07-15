-- Rename the existing role values so deployed users keep their accounts while the
-- database terminology matches the four business roles.
ALTER TYPE "Role" RENAME VALUE 'OPERATOR' TO 'FORWARDER';
ALTER TYPE "Role" RENAME VALUE 'VIEWER' TO 'CUSTOMER';

ALTER TABLE "User" ADD COLUMN "customerId" TEXT;

CREATE TABLE "UserWarehouseScope" (
    "userId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    CONSTRAINT "UserWarehouseScope_pkey" PRIMARY KEY ("userId", "warehouseId")
);

CREATE INDEX "UserWarehouseScope_warehouseId_idx" ON "UserWarehouseScope"("warehouseId");

ALTER TABLE "User" ADD CONSTRAINT "User_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserWarehouseScope" ADD CONSTRAINT "UserWarehouseScope_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserWarehouseScope" ADD CONSTRAINT "UserWarehouseScope_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Vehicle"
  ADD COLUMN "inboundAmount" DECIMAL(18,2),
  ADD COLUMN "inboundBoeNo" TEXT,
  ADD COLUMN "outboundBoeNo" TEXT,
  ADD COLUMN "outboundBoeTitle" TEXT,
  ADD COLUMN "outboundAmount" DECIMAL(18,2);

ALTER TABLE "AuditLog" ADD COLUMN "actorLabel" TEXT;

-- Existing records may contain warehouse-local display preferences. All business
-- dates are now interpreted and displayed in China Standard Time.
UPDATE "Vehicle"
SET "extra" = jsonb_set(COALESCE("extra", '{}'::jsonb), '{warehouseTimezone}', '"Asia/Shanghai"'::jsonb, true);
