-- Store pickup tokens directly so administrators can display an existing QR code again.
ALTER TABLE "PickupTask" ADD COLUMN "token" TEXT;

-- Existing hashes cannot be reversed. Keep the documented demo URL and issue a new,
-- high-entropy token for every other existing task.
UPDATE "PickupTask"
SET "token" = CASE
  WHEN "taskNo" = 'PU-DEMO-001' THEN 'demo-pickup'
  ELSE 'legacy-' || encode(
    sha256(convert_to("id" || ':' || random()::text || ':' || clock_timestamp()::text, 'UTF8')),
    'hex'
  )
END;

ALTER TABLE "PickupTask" ALTER COLUMN "token" SET NOT NULL;
CREATE UNIQUE INDEX "PickupTask_token_key" ON "PickupTask"("token");
DROP INDEX "PickupTask_tokenHash_key";
ALTER TABLE "PickupTask" DROP COLUMN "tokenHash";

CREATE TABLE "SystemSetting" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "publicBaseUrl" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);
