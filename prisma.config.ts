import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// M11: `migrate dev`, `migrate reset`, `db push` and `db execute` may rewrite or wipe a schema.
// They only ever run against a database on this machine. Hosted databases are migrated only by
// `migrate deploy` in the deploy workflow (docs/M11_STAGING_CONFIGURATION.md).
{
  const target = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  const args = process.argv.slice(2);
  const devOnly =
    (args.includes("migrate") && (args.includes("dev") || args.includes("reset"))) ||
    (args.includes("db") && (args.includes("push") || args.includes("execute")));
  let local = false;
  try {
    local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(target ?? "").hostname);
  } catch {
    local = false;
  }
  if (devOnly && target && !local)
    throw new Error(
      "Refusing: this Prisma command only runs against a local database (localhost). Hosted databases are migrated with `migrate deploy` by the deploy workflow.",
    );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations need a direct (unpooled) connection. On a host whose DATABASE_URL is a pooled
    // URL (Neon, PgBouncer), set MIGRATE_DATABASE_URL to the direct URL for the release step.
    url: process.env.MIGRATE_DATABASE_URL || env("DATABASE_URL"),
  },
});
