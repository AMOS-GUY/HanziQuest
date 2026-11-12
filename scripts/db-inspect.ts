/**
 * Read-only connection check (M11): confirms WHICH database a URL points at before anything is
 * written to it. It never writes, and never prints credentials or the full connection string.
 *
 *   read -rs MIGRATE_DATABASE_URL && export MIGRATE_DATABASE_URL   # paste; nothing is echoed
 *   npm run db:inspect
 *   npm run db:inspect -- --pooled      # checks DATABASE_URL instead (the app's pooled URL)
 *
 * Reports:
 * - from the URL: host kind (Neon pooled or direct), the Neon endpoint id (ep-…, matched to a
 *   branch in the Neon console), region, database name and sslmode;
 * - from the server: database, version, whether TLS is in use, read-only transaction;
 * - the schema state: tables, applied migrations, DeploymentMarker and account count.
 */
import "dotenv/config";
import pg from "pg";

function describeUrl(raw: string) {
  const u = new URL(raw);
  const host = u.hostname;
  const neon = /\.neon\.tech$/.test(host);
  const endpoint = host.split(".")[0] ?? "";
  return {
    neon,
    kind: !neon ? "not a Neon host" : endpoint.endsWith("-pooler") ? "pooled" : "direct",
    endpoint: neon ? endpoint.replace(/-pooler$/, "") : "(n/a)",
    // e.g. ep-x-pooler.c-7.eu-central-1.aws.neon.tech: "c-7" is a Neon cell, not the region.
    region: neon
      ? (host.split(".").find((l) => /^[a-z]{2}-[a-z]+-\d$/.test(l)) ?? "(unknown)")
      : "(n/a)",
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "(none)",
    sslmode: u.searchParams.get("sslmode") ?? "(not set)",
    local: ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host),
  };
}

async function main() {
  const pooled = process.argv.includes("--pooled");
  const name = pooled ? "DATABASE_URL" : "MIGRATE_DATABASE_URL";
  const url = process.env[name];
  if (!url) throw new Error(`Set ${name} in this shell (see the header of scripts/db-inspect.ts)`);

  const d = describeUrl(url);
  console.log(`URL in ${name}:`);
  console.log(`  host kind:  ${d.kind}${d.local ? " (LOCAL database)" : ""}`);
  console.log(`  endpoint:   ${d.endpoint}`);
  console.log(`  region:     ${d.region}`);
  console.log(`  database:   ${d.database}`);
  console.log(`  sslmode:    ${d.sslmode}`);

  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    // Everything below runs inside a READ ONLY transaction: the server refuses any write.
    await client.query("BEGIN TRANSACTION READ ONLY");
    const one = async <T extends pg.QueryResultRow>(sql: string) =>
      (await client.query<T>(sql)).rows[0];
    const info = await one<{ db: string; version: string; ro: string }>(
      "SELECT current_database() AS db, split_part(version(), ' ', 2) AS version, current_setting('transaction_read_only') AS ro",
    );
    // TLS as seen by this client. (pg_stat_ssl would describe the server's own hop, which on
    // Neon is the internal proxy-to-compute link, not this connection.)
    const stream = (client as unknown as { connection: { stream: unknown } }).connection.stream as {
      encrypted?: boolean;
      authorized?: boolean;
      getProtocol?: () => string | null;
    };
    const tls = stream.encrypted
      ? `yes, ${stream.getProtocol?.() ?? "TLS"}, certificate ${stream.authorized ? "verified" : "NOT verified"}`
      : "NO";
    const tables = await one<{ n: number }>(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const has = async (table: string) =>
      (await one<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}'`,
      ))!.n > 0;
    console.log("Server:");
    console.log(`  database:   ${info!.db}`);
    console.log(`  PostgreSQL: ${info!.version}`);
    console.log(`  TLS in use: ${tls}`);
    console.log(`  read-only:  ${info!.ro === "on" ? "yes (this check cannot write)" : "no"}`);
    console.log("Schema:");
    console.log(`  public tables:        ${tables!.n}`);
    if (await has("_prisma_migrations")) {
      const m = await one<{ n: number; last: string | null }>(
        'SELECT count(*)::int AS n, max(migration_name) AS last FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
      );
      console.log(`  applied migrations:   ${m!.n} (latest ${m!.last ?? "none"})`);
    } else console.log("  applied migrations:   none (never migrated)");
    if (await has("DeploymentMarker")) {
      const mk = await one<{ environment: string | null }>(
        'SELECT environment FROM "DeploymentMarker" WHERE id = 1',
      );
      console.log(`  environment marker:   ${mk?.environment ?? "none"}`);
    } else console.log("  environment marker:   none (table not created yet)");
    if (await has("User")) {
      const u = await one<{ n: number }>('SELECT count(*)::int AS n FROM "User"');
      console.log(`  accounts:             ${u!.n}`);
    } else console.log("  accounts:             none (table not created yet)");
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error(message.replace(/postgres(ql)?:\/\/\S+/g, "postgresql://[masked]"));
  process.exitCode = 1;
});
