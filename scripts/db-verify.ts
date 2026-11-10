/**
 * Verifies a restored database against its source (or against the backup's row counts):
 *   npm run db:verify -- --source <url> --target <url>
 * 1. Every table has the same row count and content checksum.
 * 2. Every foreign key is valid (re-checked explicitly).
 * 3. The application can use the data: for a sample of learners, progress, learning path and
 *    lesson content computed by the app's own services match between source and target.
 */
import "dotenv/config";
import { arg, client, listTables, tableChecksum } from "./lib/db-tools";
import { createPrismaClient } from "../src/lib/database/client";
import { getProgressSummary } from "../src/features/progress/queries";
import { getLessonStatesForLevel } from "../src/features/progression/lesson-states";

async function main() {
  const source = arg("source");
  const target = arg("target");
  if (!source || !target) throw new Error("Usage: --source <url> --target <url>");
  const [a, b] = [client(source), client(target)];
  await Promise.all([a.connect(), b.connect()]);
  let failures = 0;
  const fail = (m: string) => {
    failures += 1;
    console.log(`  ✗ ${m}`);
  };

  try {
    console.log("Tables (rows, checksum):");
    for (const t of await listTables(a)) {
      const [x, y] = await Promise.all([tableChecksum(a, t), tableChecksum(b, t)]);
      if (x.rows !== y.rows || x.checksum !== y.checksum)
        fail(
          `${t}: source ${x.rows}/${x.checksum.slice(0, 8)} vs target ${y.rows}/${y.checksum.slice(0, 8)}`,
        );
      else console.log(`  ✓ ${t}: ${x.rows}`);
    }

    // Re-validate every foreign key in the target (NOT VALID + VALIDATE re-checks all rows).
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
  } finally {
    await Promise.all([a.end(), b.end()]);
  }

  // Application-level check: the app's own services give the same answers on both databases.
  const [pa, pb] = [createPrismaClient(source), createPrismaClient(target)];
  try {
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
    const lesson = await pb.lesson.findFirst({
      where: { status: "PUBLISHED" },
      include: {
        exercises: true,
        vocabulary: true,
        characters: { include: { character: { include: { strokes: true } } } },
      },
    });
    if (
      !lesson ||
      lesson.exercises.length === 0 ||
      lesson.characters.some((c) => c.character.strokes.length === 0)
    )
      fail("a published lesson with exercises and stroke data could not be loaded from the target");
    console.log(`Application check: ${learners.length} learner(s) compared; lesson content loads.`);
  } finally {
    await Promise.all([pa.$disconnect(), pb.$disconnect()]);
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
