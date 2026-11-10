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
