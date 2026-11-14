/**
 * Portable logical backup of the HanziQuest database (gzip NDJSON).
 *   npm run db:backup -- --out backups/hanziquest-2026-11-10.ndjson.gz [--source <url>]
 * Contains personal data: store it encrypted, off the hosting provider, with restricted access.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type pg from "pg";
import {
  appliedMigrations,
  arg,
  client,
  columns,
  listTables,
  tableChecksum,
  topologicalOrder,
} from "./lib/db-tools";

async function main() {
  const source = arg("source") ?? process.env.DATABASE_URL;
  const out = arg("out") ?? `backups/hanziquest-${new Date().toISOString().slice(0, 10)}.ndjson.gz`;
  if (!source) throw new Error("Set DATABASE_URL or pass --source");
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  const db = client(source);
  await db.connect();
  const gzip = zlib.createGzip();
  const file = fs.createWriteStream(out);
  gzip.pipe(file);
  const write = (line: unknown) =>
    new Promise<void>((resolve) => {
      if (gzip.write(`${JSON.stringify(line)}\n`)) resolve();
      else gzip.once("drain", resolve);
    });
  try {
    // One snapshot for the whole backup, so related rows stay consistent.
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables = await topologicalOrder(db, await listTables(db));
    const meta = [];
    for (const t of tables) {
      // Row count and content checksum in the same snapshot, so a restore can be verified
      // against the backup alone (`db:verify -- --backup`), without the source database.
      const { rows, checksum } = await tableChecksum(db, t);
      meta.push({ table: t, rows, checksum, columns: await columns(db, t) });
    }
    await write({
      format: "hanziquest-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      migrations: await appliedMigrations(db),
      tables: meta,
    });
    for (const { table, rows, columns: cols } of meta) {
      const names = cols.map((c) => `"${c.name}"`).join(", ");
      // Every row exactly once: a cursor over the snapshot, ordered by the whole primary key.
      // (Paging with `ORDER BY 1 LIMIT … OFFSET …` ordered by the first column only. Where it
      // isn't unique, as in join tables like UserRole, rows tied across a page boundary could be
      // written twice while another was skipped: an unrestorable or incomplete backup.)
      const key = await orderKey(db, table, cols);
      await db.query(
        `DECLARE backup_rows NO SCROLL CURSOR FOR SELECT ${names} FROM "${table}" ORDER BY ${key}`,
      );
      let written = 0;
      for (;;) {
        const r = await db.query({ text: "FETCH 1000 FROM backup_rows", rowMode: "array" });
        for (const row of r.rows) await write({ t: table, r: row });
        written += r.rows.length;
        if (r.rows.length < 1000) break;
      }
      await db.query("CLOSE backup_rows");
      if (written !== rows)
        throw new Error(
          `${table}: wrote ${written} rows, the snapshot has ${rows}. Backup aborted.`,
        );
      console.log(`  ${table}: ${rows}`);
    }
    await db.query("COMMIT");
  } finally {
    await db.end();
    gzip.end();
    await new Promise<void>((resolve) => file.on("finish", () => resolve()));
  }
  console.log(`Backup written to ${out} (${fs.statSync(out).size} bytes)`);
}

/** ORDER BY clause: the table's primary key columns, or every column if it has none. */
async function orderKey(db: pg.Client, table: string, cols: { name: string }[]) {
  const pk = await db.query<{ name: string }>(
    `SELECT a.attname AS name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = format('%I', $1::text)::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey, a.attnum)`,
    [table],
  );
  const names = pk.rows.length ? pk.rows.map((r) => r.name) : cols.map((c) => c.name);
  return names.map((n) => `"${n}"`).join(", ");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
