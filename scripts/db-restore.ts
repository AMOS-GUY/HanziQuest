/**
 * Restores a logical backup into an EMPTY database that already has the same migrations applied.
 *   DATABASE_URL=<target> npx prisma migrate deploy
 *   npm run db:restore -- --in backups/x.ndjson.gz --target <url>
 * Refuses to touch a database that already contains data. Foreign keys stay enforced, so a
 * successful restore also proves every relationship in the backup is valid. Row counts and
 * (from M10 backups on) per-table content checksums are compared with the header before the
 * single transaction commits; any mismatch rolls everything back.
 */
import "dotenv/config";
import fs from "node:fs";
import readline from "node:readline";
import zlib from "node:zlib";
import { appliedMigrations, arg, client, tableChecksum, type ColumnInfo } from "./lib/db-tools";

interface Header {
  format: string;
  version: number;
  migrations: string[];
  tables: { table: string; rows: number; checksum?: string; columns: ColumnInfo[] }[];
}

function encode(value: unknown, col: ColumnInfo) {
  if (value === null || value === undefined) return null;
  if (col.dataType === "json" || col.dataType === "jsonb") return JSON.stringify(value);
  return value;
}

async function main() {
  const input = arg("in");
  const target = arg("target");
  if (!input || !target) throw new Error("Usage: --in <backup.ndjson.gz> --target <database url>");
  if (
    target === process.env.DATABASE_URL &&
    !process.argv.includes("--i-know-this-is-the-app-database")
  )
    throw new Error("Target equals DATABASE_URL. Restore into a new database, then switch over.");

  const db = client(target);
  await db.connect();
  // Create the reader only now: lines emitted before the loop starts listening would be lost.
  const lines = readline.createInterface({
    input: fs.createReadStream(input).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  let header: Header | null = null;
  const counts = new Map<string, number>();
  let pending = null as { table: string; rows: unknown[][] } | null;

  const flush = async () => {
    if (!pending || pending.rows.length === 0 || !header) return;
    const meta = header.tables.find((t) => t.table === pending!.table)!;
    const names = meta.columns.map((c) => `"${c.name}"`).join(", ");
    const values: unknown[] = [];
    const tuples = pending.rows.map((row) => {
      const ph = meta.columns.map((c, i) => {
        values.push(encode(row[i], c));
        return `$${values.length}`;
      });
      return `(${ph.join(", ")})`;
    });
    await db.query(`INSERT INTO "${pending.table}" (${names}) VALUES ${tuples.join(", ")}`, values);
    counts.set(pending.table, (counts.get(pending.table) ?? 0) + pending.rows.length);
    pending.rows = [];
  };

  try {
    for await (const line of lines) {
      if (!line) continue;
      const item = JSON.parse(line) as Header | { t: string; r: unknown[] };
      if (!header) {
        header = item as Header;
        if (header.format !== "hanziquest-backup" || header.version !== 1)
          throw new Error("Not a HanziQuest backup (version 1).");
        const applied = await appliedMigrations(db);
        if (JSON.stringify(applied) !== JSON.stringify(header.migrations))
          throw new Error(
            `Migrations differ. Backup: ${header.migrations.at(-1)}; target: ${applied.at(-1) ?? "none"}. Run prisma migrate deploy on the target first (same release).`,
          );
        for (const t of header.tables) {
          const n = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${t.table}"`);
          if (Number(n.rows[0]!.n) > 0)
            throw new Error(`Target is not empty (${t.table}). Refusing.`);
        }
        await db.query("BEGIN");
        continue;
      }
      const row = item as { t: string; r: unknown[] };
      if (pending?.table !== row.t) {
        await flush();
        pending = { table: row.t, rows: [] };
      }
      pending.rows.push(row.r);
      // Keep each statement under PostgreSQL's 65535-parameter limit.
      const width = header.tables.find((t) => t.table === row.t)!.columns.length;
      if (pending.rows.length * width >= 30_000) await flush();
    }
    await flush();
    if (!header) throw new Error("Empty backup file.");
    for (const t of header.tables) {
      if ((counts.get(t.table) ?? 0) !== t.rows)
        throw new Error(`${t.table}: restored ${counts.get(t.table) ?? 0} of ${t.rows} rows`);
    }
    // Content check before committing (M11, S-07): a value changed in the file after the backup
    // was taken (corruption or tampering) rolls the whole restore back. Pre-M10 backups have no
    // checksums and get the row-count check only.
    for (const t of header.tables) {
      if (!t.checksum) continue;
      const restored = await tableChecksum(db, t.table);
      if (restored.checksum !== t.checksum)
        throw new Error(
          `${t.table}: content checksum doesn't match the backup header. The file is corrupted or was changed. Nothing was restored.`,
        );
    }
    await db.query("COMMIT");
    for (const t of header.tables) console.log(`  ${t.table}: ${t.rows}`);
    console.log("Restore committed. Run npm run db:verify next.");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
