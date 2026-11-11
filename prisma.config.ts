import "dotenv/config";
import { defineConfig, env } from "prisma/config";

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
