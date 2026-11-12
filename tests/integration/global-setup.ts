import { execSync } from "node:child_process";
import "dotenv/config";

/**
 * Applies migrations to the integration-test database (non-destructive `migrate deploy`).
 * Tests isolate themselves with unique identifiers, so the database never needs wiping;
 * drop and recreate it manually if it grows too large.
 * Refuses to run unless TEST_DATABASE_URL is a local database whose name contains "test".
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname))
    throw new Error("Refusing: TEST_DATABASE_URL must be a local database (localhost).");
  const dbName = parsed.pathname.slice(1);
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to use "${dbName}": TEST_DATABASE_URL must point to a database whose name contains "test"`,
    );
  }
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    // prisma.config.ts prefers MIGRATE_DATABASE_URL: override it too, so a staging value in the
    // environment can never be migrated by the test setup (M11).
    env: { ...process.env, DATABASE_URL: url, MIGRATE_DATABASE_URL: url },
  });
}
