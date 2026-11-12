import { afterEach, describe, expect, it, vi } from "vitest";
import { checkEnvironment } from "@/lib/env";
import { buildEnvelope, parseDsn } from "@/lib/monitoring/report";
import { ipFromHeaders } from "@/lib/security/request-info";
import { readJson } from "@/lib/api/body";

vi.mock("server-only", () => ({}));

describe("environment check", () => {
  const prod = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://x",
    AUTH_SECRET: "a".repeat(40),
    AUTH_URL: "https://app.example.com",
    AUTH_TRUST_HOST: "true",
    APP_RELEASE: "abc1234",
    SENTRY_DSN: "https://k@o1.ingest.sentry.io/2",
  };
  it("accepts a complete production configuration", () => {
    expect(checkEnvironment(prod).filter((i) => i.fatal)).toEqual([]);
  });
  it("flags missing or weak secrets and non-https origins as fatal", () => {
    const fatal = (env: Record<string, string | undefined>) =>
      checkEnvironment(env)
        .filter((i) => i.fatal)
        .map((i) => i.name);
    expect(fatal({ ...prod, AUTH_SECRET: "short" })).toContain("AUTH_SECRET");
    expect(fatal({ ...prod, AUTH_URL: "http://app.example.com" })).toContain("AUTH_URL");
    expect(fatal({ ...prod, DATABASE_URL: undefined })).toContain("DATABASE_URL");
  });
  it("refuses placeholder secrets and unsafe deployment settings (M10-05)", async () => {
    const { PLACEHOLDER_SECRETS } = await import("@/lib/env");
    const fatal = (env: Record<string, string | undefined>) =>
      checkEnvironment(env)
        .filter((i) => i.fatal)
        .map((i) => i.name);
    expect(fatal({ ...prod, AUTH_SECRET: PLACEHOLDER_SECRETS[0] })).toContain("AUTH_SECRET");
    expect(fatal({ ...prod, AUTH_TRUST_HOST: undefined })).toContain("AUTH_TRUST_HOST");
    expect(fatal({ ...prod, DATABASE_URL: "mysql://x" })).toContain("DATABASE_URL");
    for (const v of ["0", "101", "ten", "2.5"])
      expect(fatal({ ...prod, DATABASE_POOL_MAX: v })).toContain("DATABASE_POOL_MAX");
    expect(fatal({ ...prod, DATABASE_POOL_MAX: "5" })).toEqual([]);
    for (const v of ["-1", "6", "one"])
      expect(fatal({ ...prod, TRUSTED_PROXY_HOPS: v })).toContain("TRUSTED_PROXY_HOPS");
    expect(fatal({ ...prod, TRUSTED_PROXY_HOPS: "0" })).toEqual([]);
    expect(
      checkEnvironment({ ...prod, APP_RELEASE: undefined }).map((i) => [i.name, i.fatal]),
    ).toContainEqual(["APP_RELEASE", false]);
    // Development stays permissive.
    expect(
      checkEnvironment({ NODE_ENV: "development", DATABASE_URL: "x", DATABASE_POOL_MAX: "0" })
        .filter((i) => i.fatal)
        .map((i) => i.name),
    ).toEqual([]);
  });
  it("requires a named environment on Render and keeps staging invite-only (M11)", async () => {
    const fatal = (env: Record<string, string | undefined>) =>
      checkEnvironment(env)
        .filter((i) => i.fatal)
        .map((i) => i.name);
    expect(fatal({ ...prod, RENDER: "true" })).toContain("APP_ENV");
    expect(fatal({ ...prod, RENDER: "true", APP_ENV: "staging" })).toEqual([]);
    expect(fatal({ ...prod, APP_ENV: "qa" })).toContain("APP_ENV");
    expect(fatal(prod)).toEqual([]); // local production builds (e2e, smoke)
    expect(fatal({ ...prod, APP_ENV: "staging", REGISTRATION_MODE: "open" })).toContain(
      "REGISTRATION_MODE",
    );
    expect(fatal({ ...prod, APP_ENV: "production", REGISTRATION_MODE: "open" })).not.toContain(
      "REGISTRATION_MODE",
    );
    for (const name of ["DATABASE_URL", "AUTH_SECRET", "AUTH_URL", "MIGRATE_DATABASE_URL"])
      expect(fatal({ ...prod, [name]: "postgresql://REPLACE_ME_with_the_value" })).toContain(name);
    const { deploymentEnvironment } = await import("@/features/operations/environment");
    expect(deploymentEnvironment({ APP_ENV: " Staging " })).toBe("staging");
    expect(deploymentEnvironment({ APP_ENV: "dev" })).toBeNull();
    expect(deploymentEnvironment({})).toBeNull();
  });
  it("keeps development servers on a local database (M11)", async () => {
    const fatal = (env: Record<string, string | undefined>) =>
      checkEnvironment(env)
        .filter((i) => i.fatal)
        .map((i) => i.name);
    const hosted = "postgresql://u:p@ep-x-pooler.c-7.eu-central-1.aws.neon.tech/hanziquest";
    expect(fatal({ NODE_ENV: "development", DATABASE_URL: hosted })).toContain("DATABASE_URL");
    expect(
      fatal({ NODE_ENV: "development", DATABASE_URL: hosted, ALLOW_REMOTE_DATABASE: "true" }),
    ).toEqual([]);
    expect(
      fatal({
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://u:p@localhost:5433/hanziquest",
      }),
    ).toEqual([]);
    const { isLocalDatabaseUrl, describeDatabaseUrl } = await import("@/lib/database/locality");
    expect(isLocalDatabaseUrl("postgresql://u:p@127.0.0.1:5433/x")).toBe(true);
    expect(isLocalDatabaseUrl(hosted)).toBe(false);
    expect(isLocalDatabaseUrl("not a url")).toBe(false);
    expect(isLocalDatabaseUrl(undefined)).toBe(false);
    expect(describeDatabaseUrl(hosted)).toBe("ep-x-pooler/hanziquest");
    expect(describeDatabaseUrl(hosted)).not.toContain("p@");
  });
  it("names the running release from APP_RELEASE or Render's commit", async () => {
    const { releaseId } = await import("@/lib/release");
    expect(releaseId({ APP_RELEASE: "v1.2.0", RENDER_GIT_COMMIT: "abc" })).toBe("v1.2.0");
    expect(releaseId({ RENDER_GIT_COMMIT: "0123456789abcdef0123" })).toBe("0123456789ab");
    expect(releaseId({})).toBe("dev");
    expect(
      checkEnvironment({ ...prod, APP_RELEASE: undefined, RENDER_GIT_COMMIT: "abc" }).map(
        (i) => i.name,
      ),
    ).not.toContain("APP_RELEASE");
  });
  it("sizes the connection pool from DATABASE_POOL_MAX, with safe defaults", async () => {
    const { poolSettings } = await import("@/lib/database/client");
    expect(poolSettings({}).max).toBe(10);
    expect(poolSettings({ DATABASE_POOL_MAX: "4" }).max).toBe(4);
    expect(poolSettings({ DATABASE_POOL_MAX: "0" }).max).toBe(10);
    expect(poolSettings({}).connectionTimeoutMillis).toBeGreaterThan(0);
  });
  it("only warns in development", () => {
    expect(
      checkEnvironment({ NODE_ENV: "development", DATABASE_URL: "x" }).filter((i) => i.fatal),
    ).toEqual([]);
  });
});

describe("error reporting", () => {
  it("parses a Sentry DSN into the envelope endpoint", () => {
    expect(parseDsn("https://abc@o123.ingest.sentry.io/456")).toEqual({
      envelopeUrl: "https://o123.ingest.sentry.io/api/456/envelope/",
      publicKey: "abc",
    });
    expect(parseDsn("not a dsn")).toBeNull();
    expect(parseDsn(undefined)).toBeNull();
  });
  it("builds an envelope without secrets", () => {
    const body = buildEnvelope(
      new Error("failed with password=hunter2"),
      { source: "api" },
      {
        dsn: "https://abc@host/1",
        eventId: "e".repeat(32),
        now: new Date("2026-11-10T00:00:00Z"),
      },
    );
    const [header, item, event] = body
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(header!.event_id).toBe("e".repeat(32));
    expect(item!.type).toBe("event");
    expect(JSON.stringify(event)).not.toContain("hunter2");
    expect(JSON.stringify(event)).toContain("[redacted]");
  });
});

describe("client IP", () => {
  afterEach(() => {
    delete process.env.TRUSTED_PROXY_HOPS;
  });
  it("uses the address appended by the trusted proxy, not a forged left-most one", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(ipFromHeaders(h)).toBe("203.0.113.9");
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(ipFromHeaders(h)).toBe("6.6.6.6");
    process.env.TRUSTED_PROXY_HOPS = "0";
    expect(ipFromHeaders(h)).toBe("unknown");
  });
});

describe("request body limit", () => {
  it("rejects bodies over the limit even without Content-Length", async () => {
    const big = new Request("http://x/api", {
      method: "POST",
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(`{"a":"${"x".repeat(5000)}"}`));
          c.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    await expect(readJson(big, 1000)).rejects.toThrow();
    const ok = new Request("http://x/api", { method: "POST", body: '{"a":1}' });
    await expect(readJson(ok, 1000)).resolves.toEqual({ a: 1 });
  });
});

describe("password reset links switch (D-047)", () => {
  it("is off in production unless the owner turns it on", async () => {
    const { resetLinksEnabled } = await import("@/features/account/password-reset");
    expect(resetLinksEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(resetLinksEnabled({ NODE_ENV: "production", PASSWORD_RESET_LINKS: "nonsense" })).toBe(
      false,
    );
    expect(resetLinksEnabled({ NODE_ENV: "production", PASSWORD_RESET_LINKS: " ON " })).toBe(true);
    expect(resetLinksEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(resetLinksEnabled({ NODE_ENV: "test", PASSWORD_RESET_LINKS: "off" })).toBe(false);
  });
});

describe("registration mode and invite codes (D-041)", () => {
  it("is invite-only in production unless explicitly opened", async () => {
    const { registrationMode } = await import("@/features/invites/invites");
    expect(registrationMode({ NODE_ENV: "production" })).toBe("invite");
    expect(registrationMode({ NODE_ENV: "production", REGISTRATION_MODE: "open" })).toBe("open");
    expect(registrationMode({ NODE_ENV: "production", REGISTRATION_MODE: "nonsense" })).toBe(
      "invite",
    );
    expect(registrationMode({ NODE_ENV: "development" })).toBe("open");
    expect(registrationMode({ NODE_ENV: "development", REGISTRATION_MODE: "invite" })).toBe(
      "invite",
    );
  });

  it("generates unambiguous codes and hashes them case- and dash-insensitively", async () => {
    const { generateCode, hashCode } = await import("@/features/invites/invites");
    const codes = new Set(Array.from({ length: 200 }, generateCode));
    expect(codes.size).toBe(200);
    for (const code of codes)
      expect(code).toMatch(/^HQ-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    const code = [...codes][0]!;
    expect(hashCode(code)).toBe(hashCode(code.toLowerCase().replace(/-/g, " ")));
    expect(hashCode(code)).toBe(hashCode(code.slice(3)));
    expect(hashCode(code)).not.toContain(code.slice(3, 8));
  });
});

describe("migration safety check", () => {
  it("flags destructive and rollout-breaking statements", async () => {
    const { checkMigrationSql } = await import("../../scripts/check-migrations");
    const sql = [
      'ALTER TABLE "User" ADD COLUMN "x" TEXT;',
      'ALTER TABLE "User" DROP COLUMN "name";',
      'DROP TABLE "Old";',
      'ALTER TABLE "A" ALTER COLUMN "b" SET DATA TYPE INTEGER;',
      'ALTER TABLE "A" RENAME COLUMN "b" TO "c";',
      'ALTER TABLE "A" ALTER COLUMN "d" SET NOT NULL;',
      'DELETE FROM "Session";',
      "-- DROP TABLE in a comment is fine",
    ].join("\n");
    expect(checkMigrationSql("m", sql).map((f) => f.rule)).toEqual([
      "drop-column",
      "drop-table",
      "alter-type",
      "rename",
      "set-not-null",
      "delete",
    ]);
  });

  it("accepts additive migrations and explicitly allowed rules with a reason", async () => {
    const { checkMigrationSql } = await import("../../scripts/check-migrations");
    expect(
      checkMigrationSql(
        "m",
        'CREATE TABLE "T" ("id" TEXT);\nCREATE INDEX "i" ON "T"("id");\nALTER TABLE "T" DROP CONSTRAINT "fk";',
      ),
    ).toEqual([]);
    expect(
      checkMigrationSql(
        "m",
        '-- migration-safety: allow drop-column unused since 2026-12 (D-099)\nALTER TABLE "U" DROP COLUMN "z";',
      ),
    ).toEqual([]);
    // An allow comment without a reason doesn't count.
    expect(
      checkMigrationSql(
        "m",
        '-- migration-safety: allow drop-column\nALTER TABLE "U" DROP COLUMN "z";',
      ),
    ).toHaveLength(1);
  });
});
