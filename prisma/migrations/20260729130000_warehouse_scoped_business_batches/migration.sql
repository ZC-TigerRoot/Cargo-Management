-- A business reference may be reused by different warehouses, but its batch
-- master data must never be shared across those warehouse boundaries.
BEGIN;

ALTER TABLE "BusinessBatch"
  ADD COLUMN "warehouseId" TEXT,
  ADD COLUMN "warehouseKey" TEXT;

-- Preserve every existing vehicle association. A historically shared batch is
-- copied once per warehouse, while unassigned vehicles retain their own scope.
CREATE TEMP TABLE "_BusinessBatchWarehouseMap" AS
WITH "scopes" AS (
  SELECT DISTINCT
    batch."id" AS "oldBatchId",
    vehicle."warehouseId"
  FROM "BusinessBatch" AS batch
  LEFT JOIN "Vehicle" AS vehicle ON vehicle."batchId" = batch."id"
),
"rankedScopes" AS (
  SELECT
    "oldBatchId",
    "warehouseId",
    COALESCE("warehouseId", '__unassigned__') AS "warehouseKey",
    ROW_NUMBER() OVER (
      PARTITION BY "oldBatchId"
      ORDER BY COALESCE("warehouseId", '__unassigned__')
    ) AS "scopeOrder"
  FROM "scopes"
)
SELECT
  "oldBatchId",
  "warehouseId",
  "warehouseKey",
  "scopeOrder",
  CASE
    WHEN "scopeOrder" = 1 THEN "oldBatchId"
    ELSE 'batch_' || md5("oldBatchId" || ':' || "warehouseKey")
  END AS "newBatchId"
FROM "rankedScopes";

UPDATE "BusinessBatch" AS batch
SET
  "warehouseId" = mapping."warehouseId",
  "warehouseKey" = mapping."warehouseKey"
FROM "_BusinessBatchWarehouseMap" AS mapping
WHERE mapping."oldBatchId" = batch."id"
  AND mapping."scopeOrder" = 1;

DROP INDEX "BusinessBatch_type_referenceNo_key";

INSERT INTO "BusinessBatch" (
  "id",
  "type",
  "referenceNo",
  "warehouseId",
  "warehouseKey",
  "portOfLoad",
  "portOfDischarge",
  "vesselVoyage",
  "etd",
  "eta",
  "manufacturer",
  "extra",
  "createdAt"
)
SELECT
  mapping."newBatchId",
  batch."type",
  batch."referenceNo",
  mapping."warehouseId",
  mapping."warehouseKey",
  batch."portOfLoad",
  batch."portOfDischarge",
  batch."vesselVoyage",
  batch."etd",
  batch."eta",
  batch."manufacturer",
  batch."extra",
  batch."createdAt"
FROM "_BusinessBatchWarehouseMap" AS mapping
JOIN "BusinessBatch" AS batch ON batch."id" = mapping."oldBatchId"
WHERE mapping."scopeOrder" > 1;

UPDATE "Vehicle" AS vehicle
SET "batchId" = mapping."newBatchId"
FROM "_BusinessBatchWarehouseMap" AS mapping
WHERE vehicle."batchId" = mapping."oldBatchId"
  AND vehicle."warehouseId" IS NOT DISTINCT FROM mapping."warehouseId";

ALTER TABLE "BusinessBatch"
  ALTER COLUMN "warehouseKey" SET DEFAULT '__unassigned__',
  ALTER COLUMN "warehouseKey" SET NOT NULL;

CREATE UNIQUE INDEX "BusinessBatch_type_referenceNo_warehouseKey_key"
  ON "BusinessBatch"("type", "referenceNo", "warehouseKey");
CREATE INDEX "BusinessBatch_warehouseId_idx" ON "BusinessBatch"("warehouseId");

ALTER TABLE "BusinessBatch"
  ADD CONSTRAINT "BusinessBatch_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "BusinessBatch_warehouseKey_matches_warehouseId_check"
    CHECK ("warehouseKey" = COALESCE("warehouseId", '__unassigned__'));

DROP TABLE "_BusinessBatchWarehouseMap";

COMMIT;
