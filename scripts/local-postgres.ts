/**
 * Local development PostgreSQL without Docker.
 *
 * Runs a real PostgreSQL server (via the `embedded-postgres` binaries) with its
 * data directory in `.local/postgres`. Keep this process running while you
 * develop; press Ctrl+C to stop it. Data persists between runs.
 *
 * Production and CI use a regular PostgreSQL server instead (see docs/DEPLOYMENT.md).
 */
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
const dataDir = path.resolve(".local/postgres");
const databases = ["hanziquest", "hanziquest_test"];

async function main() {
  const firstRun = !fs.existsSync(path.join(dataDir, "PG_VERSION"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "hanziquest",
    password: "hanziquest",
    port,
    persistent: true,
    // Windows defaults to WIN1252, which cannot store Chinese characters.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
  });

  if (firstRun) {
    console.log("Initialising local PostgreSQL cluster in .local/postgres ...");
    await pg.initialise();
  }
  await pg.start();

  for (const name of databases) {
    try {
      await pg.createDatabase(name);
      console.log(`Created database ${name}`);
    } catch {
      // Already exists.
    }
  }

  console.log(`Local PostgreSQL running on port ${port}`);
  console.log(`DATABASE_URL=postgresql://hanziquest:hanziquest@localhost:${port}/hanziquest`);

  const shutdown = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // Keep the process alive.
  setInterval(() => {}, 1 << 30);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
