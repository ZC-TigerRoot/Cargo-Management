import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/lib/**/*.ts"],
      exclude: [
        "src/lib/prisma.ts",
        "src/lib/use-session.ts",
        "src/lib/use-vehicle-records.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 85,
      },
    },
  },
});
