import { execSync } from "node:child_process";
import "dotenv/config";

/**
 * Applies migrations to the integration-test database (non-destructive `migrate deploy`).
 * Tests isolate themselves with unique identifiers, so the database never needs wiping;
 * drop and recreate it manually if it grows too large.
 * Refuses to run unless TEST_DATABASE_URL names a database containing "test".
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
  const dbName = new URL(url).pathname.slice(1);
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to use "${dbName}": TEST_DATABASE_URL must point to a database whose name contains "test"`,
    );
  }
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
