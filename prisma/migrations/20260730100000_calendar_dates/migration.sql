BEGIN;

-- Preserve deterministic ordering before timestamp precision is removed.
CREATE SEQUENCE "User_recordSequence_seq";
ALTER TABLE "User" ADD COLUMN "recordSequence" BIGINT;
WITH ranked AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS sequence
  FROM "User"
)
UPDATE "User" AS target
SET "recordSequence" = ranked.sequence
FROM ranked
WHERE target."id" = ranked."id";
SELECT setval('"User_recordSequence_seq"', COALESCE(MAX("recordSequence"), 1), COUNT(*) > 0) FROM "User";
ALTER SEQUENCE "User_recordSequence_seq" OWNED BY "User"."recordSequence";
ALTER TABLE "User" ALTER COLUMN "recordSequence" SET DEFAULT nextval('"User_recordSequence_seq"'), ALTER COLUMN "recordSequence" SET NOT NULL;

CREATE SEQUENCE "Vehicle_updateSequence_seq";
ALTER TABLE "Vehicle" ADD COLUMN "updateSequence" BIGINT;
WITH ranked AS (
  SELECT "id", row_number() OVER (ORDER BY "updatedAt", "id") AS sequence
  FROM "Vehicle"
)
UPDATE "Vehicle" AS target
SET "updateSequence" = ranked.sequence
FROM ranked
WHERE target."id" = ranked."id";
SELECT setval('"Vehicle_updateSequence_seq"', COALESCE(MAX("updateSequence"), 1), COUNT(*) > 0) FROM "Vehicle";
ALTER SEQUENCE "Vehicle_updateSequence_seq" OWNED BY "Vehicle"."updateSequence";
ALTER TABLE "Vehicle" ALTER COLUMN "updateSequence" SET DEFAULT nextval('"Vehicle_updateSequence_seq"'), ALTER COLUMN "updateSequence" SET NOT NULL;

CREATE SEQUENCE "InventoryEvent_recordSequence_seq";
ALTER TABLE "InventoryEvent" ADD COLUMN "recordSequence" BIGINT;
WITH ranked AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS sequence
  FROM "InventoryEvent"
)
UPDATE "InventoryEvent" AS target
SET "recordSequence" = ranked.sequence
FROM ranked
WHERE target."id" = ranked."id";
SELECT setval('"InventoryEvent_recordSequence_seq"', COALESCE(MAX("recordSequence"), 1), COUNT(*) > 0) FROM "InventoryEvent";
ALTER SEQUENCE "InventoryEvent_recordSequence_seq" OWNED BY "InventoryEvent"."recordSequence";
ALTER TABLE "InventoryEvent" ALTER COLUMN "recordSequence" SET DEFAULT nextval('"InventoryEvent_recordSequence_seq"'), ALTER COLUMN "recordSequence" SET NOT NULL;

CREATE SEQUENCE "PickupTask_recordSequence_seq";
ALTER TABLE "PickupTask" ADD COLUMN "recordSequence" BIGINT;
WITH ranked AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS sequence
  FROM "PickupTask"
)
UPDATE "PickupTask" AS target
SET "recordSequence" = ranked.sequence
FROM ranked
WHERE target."id" = ranked."id";
SELECT setval('"PickupTask_recordSequence_seq"', COALESCE(MAX("recordSequence"), 1), COUNT(*) > 0) FROM "PickupTask";
ALTER SEQUENCE "PickupTask_recordSequence_seq" OWNED BY "PickupTask"."recordSequence";
ALTER TABLE "PickupTask" ALTER COLUMN "recordSequence" SET DEFAULT nextval('"PickupTask_recordSequence_seq"'), ALTER COLUMN "recordSequence" SET NOT NULL;

-- Exact-time expiry cannot be preserved as a date. Revoke open links so an
-- already expired link cannot become valid again through end-of-day semantics.
WITH revoked AS (
  UPDATE "PickupTask"
  SET "revokedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
  WHERE "submittedAt" IS NULL AND "revokedAt" IS NULL
  RETURNING "id", "taskNo"
)
INSERT INTO "AuditLog" ("id", "actorLabel", "action", "entityType", "entityId", "before", "after", "createdAt")
SELECT
  'calendar-date-migration-' || "id",
  '系统迁移',
  'PICKUP_REVOKED_DATE_MIGRATION',
  'PickupTask',
  "id",
  jsonb_build_object('taskNo', "taskNo", 'status', 'pending'),
  jsonb_build_object('taskNo', "taskNo", 'status', 'revoked', 'reason', '日期精度迁移后请重新生成二维码'),
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM revoked;

CREATE SEQUENCE "AuditLog_recordSequence_seq";
ALTER TABLE "AuditLog" ADD COLUMN "recordSequence" BIGINT;
WITH ranked AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS sequence
  FROM "AuditLog"
)
UPDATE "AuditLog" AS target
SET "recordSequence" = ranked.sequence
FROM ranked
WHERE target."id" = ranked."id";
SELECT setval('"AuditLog_recordSequence_seq"', COALESCE(MAX("recordSequence"), 1), COUNT(*) > 0) FROM "AuditLog";
ALTER SEQUENCE "AuditLog_recordSequence_seq" OWNED BY "AuditLog"."recordSequence";
ALTER TABLE "AuditLog" ALTER COLUMN "recordSequence" SET DEFAULT nextval('"AuditLog_recordSequence_seq"'), ALTER COLUMN "recordSequence" SET NOT NULL;

CREATE UNIQUE INDEX "User_recordSequence_key" ON "User"("recordSequence");
CREATE UNIQUE INDEX "Vehicle_updateSequence_key" ON "Vehicle"("updateSequence");
CREATE UNIQUE INDEX "InventoryEvent_recordSequence_key" ON "InventoryEvent"("recordSequence");
CREATE UNIQUE INDEX "PickupTask_recordSequence_key" ON "PickupTask"("recordSequence");
CREATE UNIQUE INDEX "AuditLog_recordSequence_key" ON "AuditLog"("recordSequence");

DROP INDEX "InventoryEvent_vehicleId_occurredAt_idx";
DROP INDEX "AuditLog_entityType_entityId_createdAt_idx";
CREATE INDEX "InventoryEvent_vehicleId_recordSequence_idx" ON "InventoryEvent"("vehicleId", "recordSequence");
CREATE INDEX "AuditLog_entityType_entityId_recordSequence_idx" ON "AuditLog"("entityType", "entityId", "recordSequence");

-- Convert the UTC wall-clock timestamps Prisma currently reads into the same
-- calendar date users see in Asia/Shanghai.
ALTER TABLE "User" ALTER COLUMN "createdAt" DROP DEFAULT;
ALTER TABLE "BusinessBatch" ALTER COLUMN "createdAt" DROP DEFAULT;
ALTER TABLE "Vehicle" ALTER COLUMN "createdAt" DROP DEFAULT;
ALTER TABLE "InventoryEvent" ALTER COLUMN "createdAt" DROP DEFAULT;
ALTER TABLE "PickupTask" ALTER COLUMN "createdAt" DROP DEFAULT;
ALTER TABLE "SystemSetting" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Attachment" ALTER COLUMN "createdAt" DROP DEFAULT;
ALTER TABLE "AuditLog" ALTER COLUMN "createdAt" DROP DEFAULT;

ALTER TABLE "User"
  ALTER COLUMN "createdAt" TYPE DATE USING (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date;
ALTER TABLE "BusinessBatch"
  ALTER COLUMN "etd" TYPE DATE USING (("etd" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date,
  ALTER COLUMN "eta" TYPE DATE USING (("eta" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date,
  ALTER COLUMN "createdAt" TYPE DATE USING (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date;
ALTER TABLE "Vehicle"
  ALTER COLUMN "inboundAt" TYPE DATE USING (("inboundAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date,
  ALTER COLUMN "outboundAt" TYPE DATE USING (("outboundAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date,
  ALTER COLUMN "createdAt" TYPE DATE USING (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date,
  ALTER COLUMN "updatedAt" TYPE DATE USING (("updatedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date;
ALTER TABLE "InventoryEvent"
  ALTER COLUMN "occurredAt" TYPE DATE USING (("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date,
  ALTER COLUMN "createdAt" TYPE DATE USING (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date;
ALTER TABLE "PickupTask"
  ALTER COLUMN "expiresAt" TYPE DATE USING (("expiresAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date,
  ALTER COLUMN "revokedAt" TYPE DATE USING (("revokedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date,
  ALTER COLUMN "submittedAt" TYPE DATE USING (("submittedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date,
  ALTER COLUMN "createdAt" TYPE DATE USING (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date;
ALTER TABLE "SystemSetting"
  ALTER COLUMN "updatedAt" TYPE DATE USING (("updatedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date;
ALTER TABLE "Attachment"
  ALTER COLUMN "createdAt" TYPE DATE USING (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date;
ALTER TABLE "AuditLog"
  ALTER COLUMN "createdAt" TYPE DATE USING (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date;

ALTER TABLE "User" ALTER COLUMN "createdAt" SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date);
ALTER TABLE "BusinessBatch" ALTER COLUMN "createdAt" SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date);
ALTER TABLE "Vehicle"
  ALTER COLUMN "createdAt" SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date),
  ALTER COLUMN "updatedAt" SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date);
ALTER TABLE "InventoryEvent" ALTER COLUMN "createdAt" SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date);
ALTER TABLE "PickupTask" ALTER COLUMN "createdAt" SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date);
ALTER TABLE "SystemSetting" ALTER COLUMN "updatedAt" SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date);
ALTER TABLE "Attachment" ALTER COLUMN "createdAt" SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date);
ALTER TABLE "AuditLog" ALTER COLUMN "createdAt" SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date);

ALTER TABLE "PickupTask" ADD CONSTRAINT "PickupTask_terminal_state_check"
  CHECK (NOT ("revokedAt" IS NOT NULL AND "submittedAt" IS NOT NULL));

-- Normalize known timestamp strings stored in JSON snapshots and payloads.
CREATE FUNCTION pg_temp.calendar_date_json(value TEXT) RETURNS JSONB AS $$
DECLARE
  instant TIMESTAMPTZ;
BEGIN
  IF value IS NULL OR value = '' OR value ~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN to_jsonb(value);
  END IF;
  BEGIN
    instant := value::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RETURN to_jsonb(value);
  END;
  RETURN to_jsonb(((instant AT TIME ZONE 'Asia/Shanghai')::date)::text);
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.normalize_date_keys(document JSONB, keys TEXT[]) RETURNS JSONB AS $$
DECLARE
  key TEXT;
  result JSONB := document;
BEGIN
  IF result IS NULL THEN
    RETURN NULL;
  END IF;
  FOREACH key IN ARRAY keys LOOP
    IF jsonb_typeof(result -> key) = 'string' THEN
      result := jsonb_set(result, ARRAY[key], pg_temp.calendar_date_json(result ->> key));
    END IF;
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

UPDATE "Vehicle"
SET "extra" = pg_temp.normalize_date_keys("extra", ARRAY['etd', 'eta']);

UPDATE "BusinessBatch"
SET "extra" = pg_temp.normalize_date_keys("extra", ARRAY['etd', 'eta']);

UPDATE "InventoryEvent"
SET "payload" = pg_temp.normalize_date_keys("payload", ARRAY['expiresAt', 'previousValue', 'pickupAt', 'submittedAt', 'revokedAt']);

UPDATE "PickupTask"
SET "driverSubmission" = pg_temp.normalize_date_keys("driverSubmission", ARRAY['pickupAt', 'pickupDate', 'submittedAt'])
WHERE "driverSubmission" IS NOT NULL;

UPDATE "AuditLog"
SET
  "before" = pg_temp.normalize_date_keys("before", ARRAY[
    'etd', 'eta', 'inboundAt', 'merchantReleaseAt', 'transferDocNoticeAt', 'customerReleaseAt',
    'outboundAt', 'outboundNoticeDeliveredAt', 'customerReceiptDeliveredAt', 'agentReceiptDeliveredAt',
    'createdAt', 'updatedAt', 'occurredAt', 'recordedAt', 'changedAt', 'expiresAt', 'revokedAt',
    'submittedAt', 'pickupAt', 'pickupDate'
  ]),
  "after" = pg_temp.normalize_date_keys("after", ARRAY[
    'etd', 'eta', 'inboundAt', 'merchantReleaseAt', 'transferDocNoticeAt', 'customerReleaseAt',
    'outboundAt', 'outboundNoticeDeliveredAt', 'customerReceiptDeliveredAt', 'agentReceiptDeliveredAt',
    'createdAt', 'updatedAt', 'occurredAt', 'recordedAt', 'changedAt', 'expiresAt', 'revokedAt',
    'submittedAt', 'pickupAt', 'pickupDate'
  ]);

-- Preserve last-modified ordering while updatedAt itself only stores a date.
CREATE FUNCTION set_vehicle_calendar_update() RETURNS trigger AS $$
BEGIN
  NEW."updatedAt" := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date;
  NEW."updateSequence" := nextval(pg_get_serial_sequence('"Vehicle"', 'updateSequence'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Vehicle_calendar_update"
BEFORE UPDATE ON "Vehicle"
FOR EACH ROW EXECUTE FUNCTION set_vehicle_calendar_update();

CREATE FUNCTION set_setting_calendar_update() RETURNS trigger AS $$
BEGIN
  NEW."updatedAt" := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SystemSetting_calendar_update"
BEFORE UPDATE ON "SystemSetting"
FOR EACH ROW EXECUTE FUNCTION set_setting_calendar_update();

COMMIT;
