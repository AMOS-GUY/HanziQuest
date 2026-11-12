/**
 * Verifies a restored database.
 *   npm run db:verify -- --source <url> --target <url>     against the database it came from
 *   npm run db:verify -- --backup <file.ndjson.gz> --target <url>   against the backup alone
 *
 * 1. Every table has the same row count and content checksum as the source, or as recorded in
 *    the backup's header. Backups made before M10 recorded only row counts.
 * 2. The applied migrations match (backup mode).
 * 3. Every foreign key is valid (re-checked explicitly).
 * 4. The application can use the data:
 *    - Source mode: for a sample of learners, progress and learning paths computed by the
 *      app's own services match between source and target.
 *    - Both modes: published lesson content loads from the target.
 *
 * Backup mode is what the off-site backup workflow uses, because a live production source keeps
 * changing after the snapshot.
 */
import "dotenv/config";
import fs from "node:fs";
import readline from "node:readline";
import zlib from "node:zlib";
import type pg from "pg";
import { appliedMigrations, arg, client, listTables, tableChecksum } from "./lib/db-tools";
import { createPrismaClient } from "../src/lib/database/client";
import type { PrismaClient } from "../src/generated/prisma/client";
import { getProgressSummary } from "../src/features/progress/queries";
import { getLessonStatesForLevel } from "../src/features/progression/lesson-states";

interface BackupHeader {
  format: string;
  migrations: string[];
  tables: { table: string; rows: number; checksum?: string }[];
}

let failures = 0;
const fail = (m: string) => {
  failures += 1;
  console.log(`  ✗ ${m}`);
};

async function readHeader(file: string): Promise<BackupHeader> {
  const lines = readline.createInterface({
    input: fs.createReadStream(file).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    lines.close();
    const header = JSON.parse(line) as BackupHeader;
    if (header.format !== "hanziquest-backup") throw new Error("Not a HanziQuest backup file");
    return header;
  }
  throw new Error("Empty backup file");
}

/**
 * The erasure restore gate (D-062) differs by design: every restore adds a pending row. It is
 * reported separately instead of compared.
 */
const GATE_TABLE = "ErasureLedgerGate";

async function reportGate(b: pg.Client) {
  const exists = await b.query<{ ok: boolean }>(
    `SELECT to_regclass('"${GATE_TABLE}"') IS NOT NULL AS ok`,
  );
  if (!exists.rows[0]!.ok) return;
  const r = await b.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM "${GATE_TABLE}" WHERE "ledgerAppliedAt" IS NULL`,
  );
  console.log(
    r.rows[0]!.n
      ? `  ! erasure gate: ${r.rows[0]!.n} pending (readiness 503 until the erasure ledger is applied)`
      : "  ✓ erasure gate: none pending",
  );
}

async function compareWithSource(a: pg.Client, b: pg.Client) {
  console.log("Tables (rows, checksum) against the source:");
  for (const t of await listTables(a)) {
    if (t === GATE_TABLE) continue;
    const [x, y] = await Promise.all([tableChecksum(a, t), tableChecksum(b, t)]);
    if (x.rows !== y.rows || x.checksum !== y.checksum)
      fail(
        `${t}: source ${x.rows}/${x.checksum.slice(0, 8)} vs target ${y.rows}/${y.checksum.slice(0, 8)}`,
      );
    else console.log(`  ✓ ${t}: ${x.rows}`);
  }
}

async function compareWithBackup(header: BackupHeader, b: pg.Client) {
  const migrations = await appliedMigrations(b);
  if (JSON.stringify(migrations) !== JSON.stringify([...header.migrations].sort()))
    fail(
      `migrations differ: backup ${header.migrations.length}, target ${migrations.length} applied`,
    );
  console.log("Tables (rows, checksum) against the backup header:");
  const inBackup = new Set(header.tables.map((t) => t.table));
  for (const t of header.tables) {
    if (t.table === GATE_TABLE) continue;
    const y = await tableChecksum(b, t.table);
    if (y.rows !== t.rows || (t.checksum && y.checksum !== t.checksum))
      fail(`${t.table}: backup ${t.rows}/${t.checksum?.slice(0, 8) ?? "-"} vs target ${y.rows}`);
    else console.log(`  ✓ ${t.table}: ${t.rows}${t.checksum ? "" : " (rows only)"}`);
  }
  for (const t of await listTables(b)) {
    if (inBackup.has(t) || t === GATE_TABLE) continue;
    const y = await tableChecksum(b, t);
    if (y.rows > 0) fail(`${t}: ${y.rows} rows in the target but not in the backup`);
  }
}

async function checkForeignKeys(b: pg.Client) {
  // Re-validate every foreign key in the target by counting orphaned rows.
  const fks = await b.query<{ table: string; name: string }>(
    `SELECT c.conrelid::regclass::text AS table, c.conname AS name FROM pg_constraint c
     JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.contype = 'f' AND n.nspname = 'public'`,
  );
  let orphans = 0;
  for (const fk of fks.rows) {
    const def = await b.query<{ q: string }>(
      `SELECT 'SELECT count(*)::int AS n FROM ' || c.conrelid::regclass || ' ch WHERE ' ||
         string_agg(format('ch.%I IS NOT NULL', a.attname), ' AND ') ||
         ' AND NOT EXISTS (SELECT 1 FROM ' || c.confrelid::regclass || ' p WHERE ' ||
         string_agg(format('p.%I = ch.%I', fa.attname, a.attname), ' AND ') || ')' AS q
       FROM pg_constraint c
       JOIN LATERAL unnest(c.conkey, c.confkey) AS k(child, parent) ON true
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.child
       JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = k.parent
       WHERE c.conname = $1 GROUP BY c.conrelid, c.confrelid`,
      [fk.name],
    );
    const n = (await b.query<{ n: number }>(def.rows[0]!.q)).rows[0]!.n;
    if (n > 0) {
      orphans += n;
      fail(`${fk.table}.${fk.name}: ${n} orphaned rows`);
    }
  }
  console.log(`Foreign keys: ${fks.rows.length} checked, ${orphans} orphaned rows.`);
}

async function compareApplication(pa: PrismaClient, pb: PrismaClient) {
  // The app's own services give the same answers on both databases.
  const learners = await pa.user.findMany({
    where: { attempts: { some: {} } },
    take: 5,
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const now = new Date();
  const level = await pa.hSKLevel.findFirst({ select: { id: true } });
  for (const { id } of learners) {
    const [x, y] = await Promise.all([
      getProgressSummary(pa, id, now),
      getProgressSummary(pb, id, now),
    ]);
    if (JSON.stringify(x) !== JSON.stringify(y)) fail(`progress summary differs for a learner`);
    if (level) {
      const [sx, sy] = await Promise.all([
        getLessonStatesForLevel(pa, id, level.id),
        getLessonStatesForLevel(pb, id, level.id),
      ]);
      if (JSON.stringify([...sx.states]) !== JSON.stringify([...sy.states]))
        fail(`lesson states differ for a learner`);
    }
  }
  console.log(`Application check: ${learners.length} learner(s) compared.`);
}

async function checkLessonLoads(pb: PrismaClient, expectContent: boolean) {
  const lesson = await pb.lesson.findFirst({
    where: { status: "PUBLISHED" },
    include: {
      exercises: true,
      vocabulary: true,
      characters: { include: { character: { include: { strokes: true } } } },
    },
  });
  if (!lesson) {
    if (expectContent) fail("no published lesson could be loaded from the target");
    else console.log("No published lessons in the backup; lesson check skipped.");
    return;
  }
  if (
    lesson.exercises.length === 0 ||
    lesson.characters.some((c) => c.character.strokes.length === 0)
  )
    fail("a published lesson with exercises and stroke data could not be loaded from the target");
  else console.log("Lesson content loads from the target.");
}

async function main() {
  const source = arg("source");
  const backup = arg("backup");
  const target = arg("target");
  if (!target || (!source && !backup) || (source && backup))
    throw new Error("Usage: --target <url> and either --source <url> or --backup <file>");

  const b = client(target);
  await b.connect();
  const a = source ? client(source) : null;
  try {
    if (a) {
      await a.connect();
      await compareWithSource(a, b);
    } else {
      const header = await readHeader(backup!);
      await compareWithBackup(header, b);
    }
    await checkForeignKeys(b);
    await reportGate(b);
  } finally {
    await Promise.all([b.end(), a?.end()]);
  }

  const pb = createPrismaClient(target);
  const pa = source ? createPrismaClient(source) : null;
  try {
    if (pa) await compareApplication(pa, pb);
    let expectContent = true;
    if (pa) expectContent = (await pa.lesson.count({ where: { status: "PUBLISHED" } })) > 0;
    else {
      const header = await readHeader(backup!);
      expectContent = (header.tables.find((t) => t.table === "Lesson")?.rows ?? 0) > 0;
    }
    await checkLessonLoads(pb, expectContent);
  } finally {
    await Promise.all([pb.$disconnect(), pa?.$disconnect()]);
  }

  console.log(
    failures
      ? `${failures} problem(s) found.`
      : "Restore verified: data, relationships and app reads match.",
  );
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
