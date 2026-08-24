-- The previous inventoryAt field was incorrectly modeled as a date.
ALTER TABLE "Vehicle" DROP COLUMN "inventoryAt";
ALTER TABLE "Vehicle" ADD COLUMN "inventoryDays" INTEGER;
