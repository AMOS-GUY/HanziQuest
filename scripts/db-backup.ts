/**
 * Portable logical backup of the HanziQuest database (gzip NDJSON).
 *   npm run db:backup -- --out backups/hanziquest-2026-11-10.ndjson.gz [--source <url>]
 * Contains personal data: store it encrypted, off the hosting provider, with restricted access.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  appliedMigrations,
  arg,
  client,
  columns,
  listTables,
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
      const n = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${t}"`);
      meta.push({ table: t, rows: Number(n.rows[0]!.n), columns: await columns(db, t) });
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
      const batch = 1000;
      for (let offset = 0; offset < rows; offset += batch) {
        const r = await db.query({
          text: `SELECT ${names} FROM "${table}" ORDER BY 1 LIMIT ${batch} OFFSET ${offset}`,
          rowMode: "array",
        });
        for (const row of r.rows) await write({ t: table, r: row });
      }
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

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
