/**
 * Local check of backup.yml's restore verification (as far as is possible without GitHub):
 *   npm run drill:backup-workflow
 *
 * 1. Every workflow file parses; backup.yml is still manual-only, read-only, environment-scoped,
 *    and its restore step targets a separate disposable database with the guard first.
 * 2. The old command (DATABASE_URL equal to the restore target) is refused by db:restore,
 *    which is the bug this fixes.
 * 3. The fixed sequence runs against disposable local databases standing in for the runner's
 *    PostgreSQL service: guard, create the target, migrate, restore, verify.
 * Not covered here: GitHub's runner, its psql client, the postgres:17 service container,
 * secrets, the production/staging environment protection and the encryption step.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import pg from "pg";
import { check, cli, createDb, finish, PRISMA, TSX, urlFor } from "./lib";

// js-yaml is present only through ESLint (no new dependency). If it disappears, the YAML parse
// check reports itself as skipped and the structural checks run on the text.
let yaml: { load(text: string): unknown } | null = null;
try {
  yaml = createRequire(__filename)("js-yaml") as { load(text: string): unknown };
} catch {
  yaml = null;
}

const work = path.resolve(".local", "drills", `backup-workflow-${process.pid}`);
fs.mkdirSync(work, { recursive: true });
const tsx = (script: string, args: string[], env: Record<string, string> = {}) =>
  cli([TSX, script, ...args], env);

interface Step {
  name?: string;
  run?: string;
  env?: Record<string, string>;
}
interface Workflow {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, { environment?: string; env?: Record<string, string>; steps: Step[] }>;
}

async function main() {
  console.log("backup.yml restore verification (local check)");

  console.log("1. Workflow configuration");
  const dir = ".github/workflows";
  if (!yaml)
    throw new Error("No YAML parser available (js-yaml via ESLint): can't check the workflows.");
  const parser = yaml;
  const parsed = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yml"))
    .map((f) => {
      try {
        parser.load(fs.readFileSync(path.join(dir, f), "utf8"));
        return [f, true] as const;
      } catch {
        return [f, false] as const;
      }
    });
  check(
    "every workflow file parses",
    parsed.every(([, ok]) => ok),
    parsed.map(([f]) => f).join(", "),
  );
  const wf = parser.load(fs.readFileSync(path.join(dir, "backup.yml"), "utf8")) as Workflow;
  const job = wf.jobs.backup!;
  check(
    "still manual only (no push, pull_request or active schedule)",
    Object.keys(wf.on).join() === "workflow_dispatch",
  );
  check("token stays read-only", JSON.stringify(wf.permissions) === '{"contents":"read"}');
  check(
    "still bound to the protected environment",
    /inputs\.environment/.test(job.environment ?? ""),
  );
  const restoreUrl = job.env!.RESTORE_URL!;
  const scratchUrl = job.env!.SCRATCH_URL!;
  check(
    "the restore target is its own disposable database, not the scratch database",
    new URL(restoreUrl).pathname === "/hq_restore_verify" &&
      new URL(scratchUrl).pathname !== new URL(restoreUrl).pathname,
  );
  const step = job.steps.find((s) => s.name === "Restore into a disposable database and verify")!;
  const run = step.run ?? "";
  check(
    "the guard runs before anything else, then the target is created",
    run.indexOf("db:check-restore-target") >= 0 &&
      run.indexOf("db:check-restore-target") < run.indexOf("CREATE DATABASE hq_restore_verify") &&
      run.indexOf("CREATE DATABASE") < run.indexOf("db:restore"),
  );
  check(
    "db:restore and db:verify no longer run with DATABASE_URL set to the target",
    !/DATABASE_URL="\$RESTORE_URL" npm run db:(restore|verify)/.test(run) &&
      /DATABASE_URL="\$SCRATCH_URL" npm run db:restore/.test(run),
  );

  console.log("2. The old command is refused (the bug)");
  const source = await createDb("wf-source");
  if (!cli([PRISMA, "migrate", "deploy"], { MIGRATE_DATABASE_URL: source }).ok)
    throw new Error("migrate failed");
  const seeded = cli([PRISMA, "db", "seed"], {
    MIGRATE_DATABASE_URL: source,
    DATABASE_URL: source,
    SEED_ADMIN_EMAIL: "drill-admin@example.test",
    SEED_ADMIN_PASSWORD: "drill-only-password-1234",
  });
  if (!seeded.ok) throw new Error("seed failed");
  const backup = path.join(work, "plain.ndjson.gz");
  tsx("scripts/db-backup.ts", ["--source", source, "--out", backup]);
  const scratch = await createDb("wf-scratch");
  const targetName = `hq_restore_verify_drill_${process.pid}`;
  const target = urlFor(targetName);
  const old = tsx("scripts/db-restore.ts", ["--in", backup, "--target", target], {
    DATABASE_URL: target,
  });
  check(
    "db:restore with DATABASE_URL equal to the target is refused",
    !old.ok && /Target equals DATABASE_URL/.test(old.output),
  );

  console.log("3. The fixed sequence");
  const guardSame = tsx(
    "scripts/check-restore-target.ts",
    ["--source", target, "--target", target],
    {
      DATABASE_URL: scratch,
    },
  );
  const guardApp = tsx(
    "scripts/check-restore-target.ts",
    ["--source", source, "--target", target],
    {
      DATABASE_URL: target,
    },
  );
  const guard = tsx("scripts/check-restore-target.ts", ["--source", source, "--target", target], {
    DATABASE_URL: scratch,
  });
  check(
    "guard: refuses target = source and target = DATABASE_URL; accepts the disposable target",
    !guardSame.ok && !guardApp.ok && guard.ok,
  );
  check(
    "guard output never contains a URL",
    ![guardSame, guardApp, guard].some((r) => /postgres(ql)?:\/\/(?!\[masked\])/.test(r.output)),
  );
  const admin = new pg.Client({ connectionString: urlFor("postgres") });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${targetName}"`);
    const migrated = cli([PRISMA, "migrate", "deploy"], {
      MIGRATE_DATABASE_URL: target,
      DATABASE_URL: target,
    });
    const restored = tsx(
      "scripts/db-restore.ts",
      ["--in", backup, "--target", target, "--pre-gate-backup"],
      { DATABASE_URL: scratch },
    );
    const verified = tsx("scripts/db-verify.ts", ["--backup", backup, "--target", target], {
      DATABASE_URL: scratch,
    });
    check("migrate the target", migrated.ok);
    check(
      "restore into the separate target",
      restored.ok,
      restored.ok ? "" : restored.output.slice(-200),
    );
    check(
      "verify against the backup (gate reported, not compared)",
      verified.ok && /erasure gate: 1 pending/.test(verified.output),
      verified.ok ? "" : verified.output.slice(-300),
    );
  } finally {
    await admin
      .query(`DROP DATABASE IF EXISTS "${targetName}" WITH (FORCE)`)
      .catch(() => undefined);
    await admin.end();
  }
}

main()
  .catch((e) => check("drill ran to completion", false, e instanceof Error ? e.message : String(e)))
  .finally(async () => {
    fs.rmSync(work, { recursive: true, force: true });
    await finish("Backup workflow drill");
  });
