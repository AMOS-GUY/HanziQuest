/**
 * Backup and disaster-recovery drill (M11, Phase G), on disposable local databases:
 *   npm run drill:backup
 *
 * Source: a disposable database migrated and seeded with synthetic data. The drill never reads
 * the development database's learners.
 * 1. Backup, then restore into a new database. Verify against the source (checksums, FKs, app
 *    reads) and against the backup alone.
 * 2. Corruption and tampering, each against a fresh empty target. Each must be REJECTED and
 *    leave the target empty:
 *    a. truncated gzip;
 *    b. a changed value (valid file, same row count): rejected by the checksum inside restore;
 *    c. an orphaned foreign key: rejected by the enforced constraints;
 *    d. a header row count that disagrees with the rows;
 *    e. a backup from a different schema version;
 *    f. a non-empty target.
 * 3. Encryption round trip: only if the `age` CLI is installed (CI installs it). Otherwise it is
 *    reported as skipped.
 * 4. Erasure survives a restore (M12, D-061, D-062): synthetic TEST handwriting is backed up
 *    and erased. Restoring the old backup brings the samples back but gates the database
 *    (readiness 503); a tampered ledger is refused; the signed ledger erases them again and
 *    clears the gate; restore --erasure-ledger does it in one step; a lost ledger is rebuilt
 *    from a later backup.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import pg from "pg";
import { check, cli, createDb, finish, PRISMA, TSX } from "./lib";
import { signLedger } from "../../src/features/handwriting/erasure-ledger";

/** Drill-only signing key (disposable databases; never a real ledger key). */
const LEDGER_KEY = "drill-only-erasure-ledger-key-0123456789";

const work = path.resolve(".local", "drills", `backup-${process.pid}`);
fs.mkdirSync(work, { recursive: true });
const file = (name: string) => path.join(work, name);

function readLines(f: string) {
  return zlib.gunzipSync(fs.readFileSync(f)).toString("utf8").split("\n").filter(Boolean);
}
function writeLines(f: string, lines: string[]) {
  fs.writeFileSync(f, zlib.gzipSync(`${lines.join("\n")}\n`));
}

/** Accounts in the target: zero means nothing was restored. */
async function rowCount(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const users = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "User"`);
    const chars = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM "Character"`);
    return Number(users.rows[0]!.n) + Number(chars.rows[0]!.n);
  } finally {
    await c.end();
  }
}

const tsx = (script: string, args: string[], env: Record<string, string> = {}) =>
  cli([TSX, script, ...args], env);

async function freshTarget(name: string) {
  const url = await createDb(name);
  const m = cli([PRISMA, "migrate", "deploy"], { MIGRATE_DATABASE_URL: url });
  if (!m.ok) throw new Error(`migrate failed for ${name}`);
  return url;
}

async function main() {
  console.log("Backup and recovery drill");

  // Synthetic source: migrated, then seeded (roles, starter curriculum, a synthetic admin).
  const source = await freshTarget("source");
  const seeded = cli([PRISMA, "db", "seed"], {
    MIGRATE_DATABASE_URL: source,
    DATABASE_URL: source,
    SEED_ADMIN_EMAIL: "drill-admin@example.test",
    SEED_ADMIN_PASSWORD: "drill-only-password-1234",
  });
  check(
    "synthetic source migrated and seeded",
    seeded.ok,
    seeded.ok ? "" : seeded.output.slice(-300),
  );

  console.log("1. Backup, restore, verify");
  const backup = file("drill.ndjson.gz");
  const b = tsx("scripts/db-backup.ts", ["--source", source, "--out", backup]);
  check(
    "backup written",
    b.ok && fs.existsSync(backup),
    `${fs.existsSync(backup) ? fs.statSync(backup).size : 0} bytes`,
  );
  const header = JSON.parse(readLines(backup)[0]!) as {
    tables: { table: string; rows: number; checksum?: string }[];
    migrations: string[];
  };
  check(
    "header has per-table checksums",
    header.tables.every((t) => typeof t.checksum === "string"),
  );

  const target = await freshTarget("restore");
  const r = tsx("scripts/db-restore.ts", ["--in", backup, "--target", target]);
  check("restore into a new database", r.ok, r.ok ? "" : r.output.slice(-300));
  const vs = tsx("scripts/db-verify.ts", ["--source", source, "--target", target]);
  check(
    "verify against the source (checksums, FKs, app reads)",
    vs.ok && /0 orphaned rows/.test(vs.output),
    vs.ok ? "" : vs.output.slice(-400),
  );
  const vb = tsx("scripts/db-verify.ts", ["--backup", backup, "--target", target]);
  check("verify against the backup alone", vb.ok, vb.ok ? "" : vb.output.slice(-400));

  console.log("2. Corrupted or tampered backups are rejected");
  const lines = readLines(backup);
  const tableOf = (l: string) => (JSON.parse(l) as { t?: string }).t;

  // a. truncated gzip
  const truncated = file("truncated.ndjson.gz");
  const raw = fs.readFileSync(backup);
  fs.writeFileSync(truncated, raw.subarray(0, Math.floor(raw.length * 0.6)));
  await expectRejected("a. truncated file", truncated, "trunc");

  // b. changed value, same row count: alter one Character's free-text meaning
  const meta = JSON.parse(lines[0]!) as {
    tables: { table: string; columns: { name: string }[] }[];
  };
  const colIndex = (table: string, column: string) =>
    meta.tables.find((t) => t.table === table)!.columns.findIndex((c) => c.name === column);
  const changed = [...lines];
  const ci = changed.findIndex((l) => tableOf(l) === "Character");
  const row = JSON.parse(changed[ci]!) as { t: string; r: unknown[] };
  row.r[colIndex("Character", "meaning")] =
    `${String(row.r[colIndex("Character", "meaning")])} (tampered)`;
  changed[ci] = JSON.stringify(row);
  const tampered = file("tampered.ndjson.gz");
  writeLines(tampered, changed);
  await expectRejected("b. changed value (same row count)", tampered, "tamper", /checksum/);

  // c. orphaned foreign key: point a LessonCharacter at a character that doesn't exist
  const orphan = [...lines];
  const li = orphan.findIndex((l) => tableOf(l) === "LessonCharacter");
  const cols = header.tables.find((t) => t.table === "LessonCharacter");
  const charCol = colIndex("LessonCharacter", "characterId");
  const orow = JSON.parse(orphan[li]!) as { t: string; r: unknown[] };
  orow.r[charCol] = "does-not-exist";
  orphan[li] = JSON.stringify(orow);
  const orphaned = file("orphan.ndjson.gz");
  writeLines(orphaned, orphan);
  await expectRejected(
    `c. orphaned foreign key${cols ? "" : " (table missing!)"}`,
    orphaned,
    "orphan",
  );

  // d. header row count disagrees
  const miscount = [...lines];
  const h = JSON.parse(miscount[0]!) as typeof header;
  h.tables.find((t) => t.table === "Character")!.rows += 1;
  miscount[0] = JSON.stringify(h);
  const counted = file("miscount.ndjson.gz");
  writeLines(counted, miscount);
  await expectRejected("d. header row count disagrees", counted, "count");

  // e. different schema version
  const version = [...lines];
  const hv = JSON.parse(version[0]!) as typeof header;
  hv.migrations = hv.migrations.slice(0, -1);
  version[0] = JSON.stringify(hv);
  const older = file("older.ndjson.gz");
  writeLines(older, version);
  await expectRejected(
    "e. backup from another schema version",
    older,
    "version",
    /Migrations differ/,
  );

  // f. non-empty target
  const again = tsx("scripts/db-restore.ts", ["--in", backup, "--target", target]);
  check("f. a non-empty target is refused", !again.ok && /not empty/i.test(again.output));

  console.log("3. Encryption round trip (age)");
  let age = false;
  try {
    execFileSync("age", ["--version"], { stdio: "ignore" });
    age = true;
  } catch {
    console.log("  - skipped: the age CLI isn't installed here (CI installs it)");
  }
  if (age) {
    const key = file("drill.key");
    execFileSync("age-keygen", ["-o", key], { stdio: "ignore" });
    const recipient = fs.readFileSync(key, "utf8").match(/age1[0-9a-z]+/)![0];
    execFileSync("age", ["-r", recipient, "-o", `${backup}.age`, backup]);
    execFileSync("age", ["-d", "-i", key, "-o", `${backup}.dec`, `${backup}.age`]);
    const sha = (f: string) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    check("encrypt → decrypt gives the identical file", sha(backup) === sha(`${backup}.dec`));
    check(
      "the encrypted file isn't gzip/plain",
      !fs
        .readFileSync(`${backup}.age`)
        .subarray(0, 2)
        .equals(Buffer.from([0x1f, 0x8b])),
    );
    const wrong = file("wrong.key");
    execFileSync("age-keygen", ["-o", wrong], { stdio: "ignore" });
    let refused = false;
    try {
      execFileSync("age", ["-d", "-i", wrong, "-o", file("x"), `${backup}.age`], {
        stdio: "ignore",
      });
    } catch {
      refused = true;
    }
    check("a different key can't decrypt it", refused);
  }

  await erasureSurvivesRestore();
}

/** Synthetic TEST participant with consent, two samples and their audit entries. */
async function seedHandwriting(url: string, code: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const ch = await c.query<{ id: string }>(
      `SELECT id FROM "Character" WHERE "hasStrokeData" LIMIT 1`,
    );
    const characterId = ch.rows[0]!.id;
    await c.query(
      `INSERT INTO "PilotParticipant" (id, code, status, "updatedAt") VALUES ($1, $2, 'ACTIVE', now())`,
      [`drill-p-${code}`, code],
    );
    await c.query(
      `INSERT INTO "PilotConsent" (id, "participantId", version, "acceptedAt") VALUES ($1, $2, 'pilot-v0.1', now())`,
      [`drill-c-${code}`, `drill-p-${code}`],
    );
    for (const i of [1, 2]) {
      const id = `drill-s-${code}-${i}`;
      await c.query(
        `INSERT INTO "HandwritingSample" (id, "participantCode", "participantId", "consentId", "characterId",
           category, "shouldAccept", strokes, "engineVersion", band, score, "identityVerified", "consentConfirmed")
         VALUES ($1, $2, $3, $4, $5, 'CORRECT', true, '[]', 'drill', 'GOOD', 80, true, true)`,
        [id, code, `drill-p-${code}`, `drill-c-${code}`, characterId],
      );
      await c.query(
        `INSERT INTO "AuditLog" (id, action, "entityType", "entityId", after)
         VALUES ($1, 'handwriting.sample.record', 'HandwritingSample', $2, $3)`,
        [`drill-a-${code}-${i}`, id, JSON.stringify({ participant: code })],
      );
    }
  } finally {
    await c.end();
  }
}

async function handwritingState(url: string, code: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const q = async (sql: string) => (await c.query<{ v: string }>(sql, [code])).rows[0]?.v;
    return {
      samples: Number(
        await q(`SELECT count(*)::text AS v FROM "HandwritingSample" WHERE "participantCode" = $1`),
      ),
      status: await q(`SELECT status::text AS v FROM "PilotParticipant" WHERE code = $1`),
      activeConsents: Number(
        await q(`SELECT count(*)::text AS v FROM "PilotConsent" k JOIN "PilotParticipant" p ON p.id = k."participantId"
                 WHERE p.code = $1 AND k."revokedAt" IS NULL`),
      ),
      auditMentions: Number(
        await q(
          `SELECT count(*)::text AS v FROM "AuditLog" WHERE "entityType" = 'HandwritingSample' AND after::text LIKE '%' || $1 || '%'`,
        ),
      ),
    };
  } finally {
    await c.end();
  }
}

async function erasureSurvivesRestore() {
  console.log("4. Erasure survives a restore (erasure ledger and restore gate)");
  const code = "TESTDRILL1";
  const env = { ERASURE_LEDGER_KEY: LEDGER_KEY };
  const erasures = (args: string[]) => tsx("scripts/handwriting-erasures.ts", args, env);
  const live = await freshTarget("erasure-live");
  const seeded = cli([PRISMA, "db", "seed"], {
    MIGRATE_DATABASE_URL: live,
    DATABASE_URL: live,
    SEED_ADMIN_EMAIL: "drill-admin@example.test",
    SEED_ADMIN_PASSWORD: "drill-only-password-1234",
  });
  if (!seeded.ok) throw new Error("seed failed for the erasure drill");
  await seedHandwriting(live, code);
  const before = file("before-erasure.ndjson.gz");
  check(
    "backup taken while the participant's samples exist",
    tsx("scripts/db-backup.ts", ["--source", live, "--out", before]).ok,
  );

  // Erase on the live database through the shared erasure path (a signed one-entry ledger).
  const request = file("erase-request.json");
  fs.writeFileSync(
    request,
    JSON.stringify(
      signLedger(
        [{ code, reason: "WITHDRAWAL", erasedAt: new Date().toISOString() }],
        "drill",
        LEDGER_KEY,
      ),
    ),
  );
  const erased = erasures(["--apply", request, "--target", live]);
  const afterErase = await handwritingState(live, code);
  check(
    "erasure on the live database: samples gone, code withdrawn, consent revoked, audit redacted",
    erased.ok &&
      afterErase.samples === 0 &&
      afterErase.status === "WITHDRAWN" &&
      afterErase.activeConsents === 0 &&
      afterErase.auditMentions === 0,
    JSON.stringify(afterErase),
  );

  const ledger = file("ledger.json");
  const exported = erasures(["--export", ledger, "--source", live]);
  check(
    "signed ledger exported with the erased code",
    exported.ok && fs.readFileSync(ledger, "utf8").includes(code),
  );
  const again = erasures(["--export", ledger, "--source", live]);
  const backups = fs
    .readdirSync(work)
    .filter((f) => f.startsWith("ledger.json.") && f.endsWith(".bak"));
  check(
    "re-exporting merges (never shrinks) and keeps the previous file",
    again.ok && /1 erased code/.test(again.output) && backups.length === 1,
  );
  check("the ledger verifies", erasures(["--verify", ledger]).ok);
  const unsigned = tsx("scripts/handwriting-erasures.ts", ["--verify", ledger], {
    ERASURE_LEDGER_KEY: "",
  });
  check(
    "without the key nothing verifies",
    !unsigned.ok && /ERASURE_LEDGER_KEY/.test(unsigned.output),
  );

  // Restore WITHOUT the ledger: the data comes back, but the database is gated.
  const restored = await freshTarget("erasure-restored");
  const r = tsx("scripts/db-restore.ts", ["--in", before, "--target", restored]);
  const resurrected = await handwritingState(restored, code);
  check(
    "restoring the older backup brings the erased samples back (the risk)",
    r.ok && resurrected.samples === 2 && resurrected.status === "ACTIVE",
    JSON.stringify(resurrected),
  );
  const pending = erasures(["--status", "--target", restored]);
  check(
    "…and gates it: restore gate pending (readiness 503)",
    !pending.ok && /PENDING/.test(pending.output) && /Erasure gate PENDING/.test(r.output),
  );
  const verified = tsx("scripts/db-verify.ts", ["--backup", before, "--target", restored]);
  check(
    "db:verify still matches the backup and reports the pending gate",
    verified.ok && /erasure gate: 1 pending/.test(verified.output),
    verified.ok ? "" : verified.output.slice(-300),
  );

  const tampered = file("tampered.json");
  const t = JSON.parse(fs.readFileSync(ledger, "utf8")) as { entries: { code: string }[] };
  t.entries[0]!.code = "TESTDRILL9";
  fs.writeFileSync(tampered, JSON.stringify(t));
  const refused = erasures(["--apply", tampered, "--target", restored]);
  const stillThere = await handwritingState(restored, code);
  check(
    "a tampered ledger is refused and changes nothing",
    !refused.ok && stillThere.samples === 2 && stillThere.status === "ACTIVE",
    refused.output.trim().split("\n").at(-1)?.slice(0, 120),
  );

  const applied = erasures(["--apply", ledger, "--target", restored]);
  const final = await handwritingState(restored, code);
  check(
    "applying the ledger erases them again, blocks the code and clears the gate",
    applied.ok &&
      final.samples === 0 &&
      final.status === "WITHDRAWN" &&
      final.activeConsents === 0 &&
      final.auditMentions === 0 &&
      erasures(["--status", "--target", restored]).ok,
    JSON.stringify(final),
  );
  const twice = erasures(["--apply", ledger, "--target", restored]);
  check("re-applying is idempotent", twice.ok && /0 changed, 0 sample/.test(twice.output));

  // One-step restore with the ledger, and a tampered ledger refused before restoring anything.
  const oneStep = await freshTarget("erasure-onestep");
  const r2 = tsx(
    "scripts/db-restore.ts",
    ["--in", before, "--target", oneStep, "--erasure-ledger", ledger],
    env,
  );
  const s2 = await handwritingState(oneStep, code);
  check(
    "db:restore --erasure-ledger restores and re-erases in one step, gate cleared",
    r2.ok &&
      s2.samples === 0 &&
      s2.status === "WITHDRAWN" &&
      erasures(["--status", "--target", oneStep]).ok,
    r2.ok ? JSON.stringify(s2) : r2.output.slice(-300),
  );
  const badTarget = await freshTarget("erasure-badledger");
  const r3 = tsx(
    "scripts/db-restore.ts",
    ["--in", before, "--target", badTarget, "--erasure-ledger", tampered],
    env,
  );
  check(
    "db:restore with a tampered ledger restores nothing",
    !r3.ok && (await rowCount(badTarget)) === 0,
  );

  // Lost ledger: rebuild it from a backup taken after the erasure (its tombstones).
  const after = file("after-erasure.ndjson.gz");
  tsx("scripts/db-backup.ts", ["--source", live, "--out", after]);
  const rebuilt = file("rebuilt.json");
  const rb = erasures(["--export", rebuilt, "--from-backup", after]);
  const recovered = await freshTarget("erasure-recovered");
  tsx("scripts/db-restore.ts", ["--in", before, "--target", recovered]);
  const ra = erasures(["--apply", rebuilt, "--target", recovered]);
  check(
    "a lost ledger is rebuilt from a later backup and works",
    rb.ok && ra.ok && (await handwritingState(recovered, code)).samples === 0,
    rb.ok ? "" : rb.output.slice(-200),
  );

  const inRepo = erasures(["--export", "docs/ledger.json", "--source", live]);
  check(
    "the ledger can't be written into the (public) repository",
    !inRepo.ok && !fs.existsSync("docs/ledger.json") && /Refusing/.test(inRepo.output),
  );
}

async function expectRejected(name: string, f: string, db: string, pattern?: RegExp) {
  const t = await freshTarget(db);
  const r = tsx("scripts/db-restore.ts", ["--in", f, "--target", t]);
  const empty = (await rowCount(t)) === 0;
  check(
    `${name}: rejected, nothing restored`,
    !r.ok && empty && (!pattern || pattern.test(r.output)),
    r.ok ? "restore SUCCEEDED" : r.output.trim().split("\n").at(-1)!.slice(0, 160),
  );
}

main()
  .catch((e) => check("drill ran to completion", false, e instanceof Error ? e.message : String(e)))
  .finally(async () => {
    fs.rmSync(work, { recursive: true, force: true });
    await finish("Backup drill");
  });
