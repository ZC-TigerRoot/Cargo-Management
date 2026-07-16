-- Manual vehicle records may be created before any business data is known.
ALTER TABLE "Vehicle"
  ALTER COLUMN "vin" DROP NOT NULL,
  ALTER COLUMN "model" DROP NOT NULL;
