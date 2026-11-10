/**
 * Shared helpers for the logical backup / restore / verify scripts. Uses `pg` directly so it
 * works wherever Node runs, with no pg_dump binary needed. Provider point-in-time recovery
 * remains the primary backup (docs/DEPLOYMENT.md); this is the independent, portable copy.
 */
import pg from "pg";

/** Dates and timestamps travel as their exact text, never through JS Date (no time-zone shifts). */
const RAW_TEXT_OIDS = new Set([1082, 1114, 1184, 1083, 1266]);

export function client(connectionString: string) {
  return new pg.Client({
    connectionString,
    types: {
      getTypeParser: ((oid: number, format?: "text" | "binary") =>
        RAW_TEXT_OIDS.has(oid)
          ? (value: string) => value
          : pg.types.getTypeParser(oid, format as "text")) as typeof pg.types.getTypeParser,
    },
  });
}

export interface ColumnInfo {
  name: string;
  /** information_schema data_type, e.g. "jsonb", "ARRAY", "USER-DEFINED". */
  dataType: string;
  udtName: string;
}

export async function listTables(db: pg.Client): Promise<string[]> {
  const r = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
     ORDER BY table_name`,
  );
  return r.rows.map((x) => x.table_name);
}

export async function columns(db: pg.Client, table: string): Promise<ColumnInfo[]> {
  const r = await db.query<{ column_name: string; data_type: string; udt_name: string }>(
    `SELECT column_name, data_type, udt_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return r.rows.map((c) => ({ name: c.column_name, dataType: c.data_type, udtName: c.udt_name }));
}

/** Tables ordered so that every table comes after the tables it references. */
export async function topologicalOrder(db: pg.Client, tables: string[]): Promise<string[]> {
  const r = await db.query<{ child: string; parent: string }>(
    `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
     FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE c.contype = 'f' AND n.nspname = 'public'`,
  );
  const strip = (s: string) => s.replace(/^"|"$/g, "");
  const deps = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const { child, parent } of r.rows) {
    const c = strip(child);
    const p = strip(parent);
    if (c !== p && deps.has(c) && deps.has(p)) deps.get(c)!.add(p);
  }
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visit = (t: string) => {
    if (ordered.includes(t)) return;
    if (visiting.has(t)) throw new Error(`Foreign-key cycle involving ${t}`);
    visiting.add(t);
    for (const p of deps.get(t) ?? []) visit(p);
    visiting.delete(t);
    ordered.push(t);
  };
  tables.forEach(visit);
  return ordered;
}

export async function appliedMigrations(db: pg.Client): Promise<string[]> {
  const r = await db.query<{ migration_name: string }>(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
     ORDER BY migration_name`,
  );
  return r.rows.map((x) => x.migration_name);
}

/** Content checksum independent of physical row order. */
export async function tableChecksum(db: pg.Client, table: string) {
  const r = await db.query<{ n: string; sum: string | null }>(
    `SELECT count(*)::text AS n, md5(string_agg(t::text, '|' ORDER BY t::text)) AS sum FROM "${table}" t`,
  );
  return { rows: Number(r.rows[0]!.n), checksum: r.rows[0]!.sum ?? "empty" };
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
