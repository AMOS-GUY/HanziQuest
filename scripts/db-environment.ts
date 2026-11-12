/**
 * Database environment guard (M11, D-054). Used by the deploy workflow BEFORE any backup or
 * migration, and to mark a new database after its first migration.
 *
 *   npm run db:environment -- --expect staging            check only (exit 1 if unsafe)
 *   npm run db:environment -- --expect staging --mark     check, then write the marker if new
 *
 * The URL is MIGRATE_DATABASE_URL (direct), or DATABASE_URL. It is never printed.
 * The command never changes an existing marker. To re-purpose a database, the owner does it by
 * hand, deliberately.
 */
import "dotenv/config";
import { createPrismaClient } from "../src/lib/database/client";
import {
  DEPLOYMENT_ENVIRONMENTS,
  guardDatabase,
  markDatabase,
  type DeploymentEnvironment,
} from "../src/features/operations/environment";
import { arg } from "./lib/db-tools";

async function main() {
  const expect = arg("expect") as DeploymentEnvironment | undefined;
  if (!expect || !DEPLOYMENT_ENVIRONMENTS.includes(expect))
    throw new Error(`Usage: --expect ${DEPLOYMENT_ENVIRONMENTS.join("|")} [--mark]`);
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Set MIGRATE_DATABASE_URL (direct) or DATABASE_URL");
  // The Prisma CLI (migrations) skips certificate verification unless sslaccept=strict. The deploy
  // workflow runs this guard before migrating, so a hosted URL without it is refused here.
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname) &&
    parsed.searchParams.get("sslaccept") !== "strict"
  ) {
    console.error(
      "REFUSED: the direct database URL must include sslaccept=strict (and sslmode=require), so migrations verify the server certificate.",
    );
    process.exitCode = 1;
    return;
  }
  const prisma = createPrismaClient(url);
  try {
    const guard = await guardDatabase(prisma, expect);
    if (!guard.ok) {
      console.error(
        guard.reason === "mismatch"
          ? `REFUSED: this database is marked "${guard.marker}", not "${expect}". Check the secrets of the ${expect} environment.`
          : `REFUSED: this database has accounts but no environment marker. It may belong to another deployment. Mark it by hand only if you are certain (docs/M11_STAGING_CONFIGURATION.md).`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      guard.state === "ok"
        ? `Database marker: ${expect} (ok)`
        : "Database is new and unmarked (no accounts).",
    );
    if (process.argv.includes("--mark")) {
      const result = await markDatabase(prisma, expect);
      console.log(result === "marked" ? `Marked the database as ${expect}.` : "Already marked.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
