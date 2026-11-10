import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Integration tests run against a real PostgreSQL database named by TEST_DATABASE_URL.
 * The database is reset (migrations re-applied) before the run. NEVER point it at real data.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/support/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
