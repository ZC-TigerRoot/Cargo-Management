-- Allow users to override the date used as the inventory-age start date.
ALTER TABLE "Vehicle" ADD COLUMN "inventoryAt" DATE;
