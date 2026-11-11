/**
 * Migration drill (M11, Phase E), on disposable local databases:
 *   npm run drill:migrations
 * 1. A fresh database migrates from empty and is ready.
 * 2. A database at the previous schema version reports `pending`, keeps its data through the
 *    upgrade, and is ready afterwards.
 * 3. A failing migration stops `migrate deploy`. Readiness reports `incomplete`. The documented
 *    recovery (`migrate resolve --rolled-back`) restores readiness. The drill reports whether
 *    the failed migration left partial changes, which it can, because PostgreSQL migrations
 *    aren't wrapped in one transaction by Prisma.
 * 4. The environment marker: a new database can be marked, an existing marker never changes,
 *    and the other environment is refused.
 * 5. An unavailable database is reported as unavailable, quickly and without details.
 */
import fs from "node:fs";
import path from "node:path";
import { createPrismaClient } from "../../src/lib/database/client";
import { checkReadiness, expectedMigrations } from "../../src/features/operations/health";
import { guardDatabase, markDatabase } from "../../src/features/operations/environment";
import { check, cli, createDb, finish, PRISMA } from "./lib";

const shipped = expectedMigrations()!;
const work = path.join(".local", "drills", `migrations-${process.pid}`);

/** A throwaway Prisma config pointing at a copy of the migrations folder. */
function configWith(migrations: string[], extra?: { name: string; sql: string }) {
  const dir = path.resolve(work, String(Date.now() + Math.random()));
  const migDir = path.join(dir, "migrations");
  fs.mkdirSync(migDir, { recursive: true });
  for (const m of migrations)
    fs.cpSync(path.join("prisma", "migrations", m), path.join(migDir, m), { recursive: true });
  fs.copyFileSync(
    path.join("prisma", "migrations", "migration_lock.toml"),
    path.join(migDir, "migration_lock.toml"),
  );
  if (extra) {
    fs.mkdirSync(path.join(migDir, extra.name));
    fs.writeFileSync(path.join(migDir, extra.name, "migration.sql"), extra.sql);
  }
  const config = path.join(dir, "prisma.config.ts");
  fs.writeFileSync(
    config,
    `import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: ${JSON.stringify(path.resolve("prisma", "schema.prisma"))},
  migrations: { path: ${JSON.stringify(migDir)} },
  datasource: { url: process.env.MIGRATE_DATABASE_URL! },
});
`,
  );
  return config;
}

const deploy = (url: string, config?: string) =>
  cli([PRISMA, "migrate", "deploy", ...(config ? ["--config", config] : [])], {
    MIGRATE_DATABASE_URL: url,
  });

async function main() {
  console.log(`Migration drill (${shipped.length} shipped migrations)`);

  console.log("1. Fresh database");
  const fresh = await createDb("fresh");
  const first = deploy(fresh);
  check("migrate deploy from empty", first.ok, first.ok ? "" : first.output.slice(-400));
  const pf = createPrismaClient(fresh);
  check("ready after migrating", (await checkReadiness(pf, shipped)).migrations === "ok");

  console.log("2. Upgrade from the previous schema version");
  const prev = await createDb("previous");
  const older = shipped.slice(0, -1);
  check("migrate to the previous version", deploy(prev, configWith(older)).ok);
  const pp = createPrismaClient(prev);
  const before = await checkReadiness(pp, shipped);
  check(
    "new code sees pending migrations (503)",
    !before.ok && before.migrations === "pending" && before.pendingMigrations === 1,
    JSON.stringify(before),
  );
  await pp.$executeRaw`INSERT INTO "User" (id, email, "updatedAt") VALUES ('drill-user', 'drill@example.test', now())`;
  const upgrade = deploy(prev);
  check(
    "upgrade applies the remaining migration",
    upgrade.ok,
    upgrade.ok ? "" : upgrade.output.slice(-400),
  );
  check("ready after the upgrade", (await checkReadiness(pp, shipped)).ok);
  const kept = await pp.$queryRaw<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM "User" WHERE id = 'drill-user'`;
  check("existing data kept through the upgrade", kept[0]?.n === 1);

  console.log("3. Failed migration and recovery");
  const failing = await createDb("failing");
  const bad = {
    name: "29991231000000_drill_failure",
    sql: 'CREATE TABLE "DrillPartial" (id int);\nSELECT 1/0;\n',
  };
  const badConfig = configWith(shipped, bad);
  const failed = deploy(failing, badConfig);
  check("migrate deploy stops on the failing migration", !failed.ok);
  const pfail = createPrismaClient(failing);
  const during = await checkReadiness(pfail, [...shipped, bad.name]);
  check(
    "readiness reports incomplete (503)",
    !during.ok && during.migrations === "incomplete",
    JSON.stringify(during),
  );
  const partial = await pfail.$queryRaw<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM pg_tables WHERE tablename = 'DrillPartial'`;
  console.log(
    `    note: the failed migration ${partial[0]?.n ? "LEFT a partial change (table DrillPartial)" : "left no partial change"}; undo by hand before resolving (ROLLBACK.md)`,
  );
  await pfail.$executeRawUnsafe('DROP TABLE IF EXISTS "DrillPartial"');
  const resolved = cli(
    [PRISMA, "migrate", "resolve", "--rolled-back", bad.name, "--config", badConfig],
    { MIGRATE_DATABASE_URL: failing },
  );
  check(
    "migrate resolve --rolled-back succeeds",
    resolved.ok,
    resolved.ok ? "" : resolved.output.slice(-300),
  );
  check("ready again on the shipped migrations", (await checkReadiness(pfail, shipped)).ok);

  console.log("4. Environment marker");
  const g1 = await guardDatabase(pf, "staging");
  check("a new, empty database may be marked", g1.ok && g1.state === "new");
  check("marking writes the marker", (await markDatabase(pf, "staging")) === "marked");
  check("ready as staging", (await checkReadiness(pf, shipped, "staging")).ok);
  const asProd = await checkReadiness(pf, shipped, "production");
  check(
    "refused as production (503, mismatch)",
    !asProd.ok && asProd.databaseEnvironment === "mismatch",
  );
  const g2 = await guardDatabase(pf, "production");
  check("the deploy guard refuses the other environment", !g2.ok && g2.reason === "mismatch");
  await markDatabase(pf, "production").then(
    () => check("an existing marker can't be changed", false),
    () => check("an existing marker can't be changed", true),
  );
  const g3 = await guardDatabase(pp, "staging");
  check(
    "an unmarked database with accounts is refused",
    !g3.ok && g3.reason === "unmarked-with-data",
  );
  const unmarked = await checkReadiness(pp, shipped, "staging");
  check(
    "readiness refuses an unmarked database (503)",
    !unmarked.ok && unmarked.databaseEnvironment === "unmarked",
  );

  console.log("5. Database unavailable");
  const dead = createPrismaClient("postgresql://drill:drill@127.0.0.1:1/none");
  const t0 = Date.now();
  const down = await checkReadiness(dead, shipped, "staging");
  check(
    "reported as unavailable",
    !down.ok && down.database === "unavailable",
    `${Date.now() - t0} ms`,
  );
  check("answers within the 10 s connect timeout", Date.now() - t0 < 11_000);

  await Promise.all([pf, pp, pfail, dead].map((p) => p.$disconnect().catch(() => undefined)));
}

main()
  .catch((e) => {
    check("drill ran to completion", false, e instanceof Error ? e.message : String(e));
  })
  .finally(async () => {
    fs.rmSync(work, { recursive: true, force: true });
    await finish("Migration drill");
  });
