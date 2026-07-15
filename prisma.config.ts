import { defineConfig } from "prisma/config";

import { databaseUrlFromEnv } from "./database-url.mjs";

try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const databaseUrl = databaseUrlFromEnv();

// Prisma 6 validates the schema's env() reference before applying the
// datasource override from this config file.
process.env.DATABASE_URL = databaseUrl;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    url: databaseUrl,
  },
});
