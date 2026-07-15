-- Incrementing this value invalidates all previously issued sessions for a user.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
