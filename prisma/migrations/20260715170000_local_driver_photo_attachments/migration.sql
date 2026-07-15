DROP INDEX IF EXISTS "Attachment_objectKey_key";

ALTER TABLE "Attachment"
ADD COLUMN "inventoryEventId" TEXT;

CREATE INDEX "Attachment_objectKey_idx" ON "Attachment"("objectKey");
CREATE INDEX "Attachment_inventoryEventId_idx" ON "Attachment"("inventoryEventId");

ALTER TABLE "Attachment"
ADD CONSTRAINT "Attachment_inventoryEventId_fkey"
FOREIGN KEY ("inventoryEventId") REFERENCES "InventoryEvent"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
