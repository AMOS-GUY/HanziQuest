/**
 * The route-handler boundary (`handleApi`): every failure maps to a stable, non-leaky response.
 * Database failures, unexpected exceptions and hostile requests must never expose internals.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const reportError = vi.fn(async (...args: [unknown, unknown]) => void args);
vi.mock("@/lib/monitoring/report", () => ({ reportError }));
const queryRaw = vi.fn();
vi.mock("@/lib/database/prisma", () => ({ prisma: { $queryRaw: queryRaw } }));
vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn(async () => null) }));

const { handleApi, readJson } = await import("@/lib/api/respond");
const { AuthorizationError } = await import("@/lib/auth/session");
const { DomainError } = await import("@/features/administration/services");
const { GET: health } = await import("@/app/api/health/route");
const { GET: liveness } = await import("@/app/api/health/live/route");
const { expectedMigrations } = await import("@/features/operations/health");

function post(body: string, headers: Record<string, string> = {}) {
  return new Request("http://app.test/api/x", {
    method: "POST",
    headers: { host: "app.test", "content-type": "application/json", ...headers },
    body,
  });
}

async function json(response: Response) {
  return (await response.json()) as { error: { code: string; message: string } };
}

beforeEach(() => {
  reportError.mockClear();
  queryRaw.mockReset();
});

describe("handleApi error mapping", () => {
  it.each([
    [new AuthorizationError(401), 401, "unauthenticated"],
    [new AuthorizationError(403), 403, "forbidden"],
    [new DomainError("not_found", "Lesson not found."), 404, "not_found"],
    [new DomainError("forbidden", "Locked."), 403, "forbidden"],
    [new DomainError("conflict", "Already done."), 409, "conflict"],
    [new SyntaxError("Unexpected token"), 400, "invalid_json"],
  ])("maps %s to %i", async (error, status, code) => {
    const handler = handleApi(async (request: Request) => {
      void request;
      throw error;
    });
    const response = await handler(post("{}"));
    expect(response.status).toBe(status);
    expect((await json(response)).error.code).toBe(code);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("maps validation errors to 400 with field details", async () => {
    const handler = handleApi(async (r: Request) => {
      z.object({ deviceId: z.uuid() }).parse(await readJson(r, 1000));
      return new Response("ok");
    });
    const response = await handler(post(JSON.stringify({ deviceId: "nope" })));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.details).toHaveProperty("deviceId");
  });

  it("hides unexpected errors (e.g. a database outage) behind a generic 500 and reports them", async () => {
    const secret = "connect ECONNREFUSED postgres://hanziquest:s3cret@db:5432";
    const handler = handleApi(async (request: Request) => {
      void request;
      throw new Error(secret);
    });
    const response = await handler(post("{}"));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("ECONNREFUSED");
    expect(JSON.parse(text).error.code).toBe("internal_error");
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0]![1]).toMatchObject({ source: "api", path: "/api/x" });
  });

  it("rejects malformed JSON and oversized bodies before the handler sees them", async () => {
    const handler = handleApi(async (r: Request) => {
      await readJson(r, 100);
      return new Response("ok");
    });
    expect((await handler(post("{not json"))).status).toBe(400);
    expect((await handler(post(JSON.stringify({ x: "y".repeat(500) })))).status).toBe(413);
    // Lying about Content-Length doesn't help: the stream is counted.
    expect(
      (await handler(post(JSON.stringify({ x: "y".repeat(500) }), { "content-length": "10" })))
        .status,
    ).toBe(413);
  });

  it("refuses cross-site POSTs but allows same-origin and header-less requests", async () => {
    const handler = handleApi(async (request: Request) => new Response(request.method));
    expect((await handler(post("{}", { origin: "https://evil.example" }))).status).toBe(403);
    expect((await handler(post("{}", { origin: "not a url" }))).status).toBe(403);
    expect((await handler(post("{}", { origin: "http://app.test" }))).status).toBe(200);
    expect((await handler(post("{}"))).status).toBe(200);
  });
});

describe("GET /api/health (readiness)", () => {
  const shipped = expectedMigrations()!;
  const applied = (names: readonly string[], unfinished = false) =>
    names.map((migration_name) => ({ migration_name, unfinished }));

  it("ships with the build's migration list", () => {
    expect(shipped.length).toBeGreaterThan(0);
    expect(shipped).toEqual([...shipped].sort());
  });

  it("reports ok when the database answers and every migration is applied", async () => {
    queryRaw.mockResolvedValueOnce([{ "?column?": 1 }]).mockResolvedValueOnce(applied(shipped));
    const response = await health();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      status: "ok",
      database: "ok",
      migrations: "ok",
    });
  });

  it("returns 503 while a migration is unfinished or failed", async () => {
    queryRaw
      .mockResolvedValueOnce([{ "?column?": 1 }])
      .mockResolvedValueOnce([
        ...applied(shipped.slice(0, -1)),
        ...applied(shipped.slice(-1), true),
      ]);
    const response = await health();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "degraded",
      database: "ok",
      migrations: "incomplete",
    });
  });

  it("returns 503 when this build's migrations aren't applied yet (M10-02)", async () => {
    queryRaw
      .mockResolvedValueOnce([{ "?column?": 1 }])
      .mockResolvedValueOnce(applied(shipped.slice(0, -2)));
    const response = await health();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "degraded",
      migrations: "pending",
      pendingMigrations: 2,
    });
  });

  it("stays ready when the database is ahead of the code (after a rollback)", async () => {
    queryRaw
      .mockResolvedValueOnce([{ "?column?": 1 }])
      .mockResolvedValueOnce(applied([...shipped, "29991231000000_future"]));
    expect((await health()).status).toBe(200);
  });

  it("returns 503 without details when the database is down", async () => {
    queryRaw.mockRejectedValue(new Error("password authentication failed for user hanziquest"));
    const response = await health();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ status: "degraded", database: "unavailable" });
    expect(text).not.toContain("password");
    queryRaw.mockReset();
  });
});

describe("GET /api/health/live (liveness)", () => {
  it("answers without touching the database (M10-01)", async () => {
    queryRaw.mockReset();
    queryRaw.mockRejectedValue(new Error("database down"));
    const response = liveness();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ status: "ok" });
    expect(queryRaw).not.toHaveBeenCalled();
    queryRaw.mockReset();
  });
});

describe("structured logging", () => {
  it("masks emails, tokens and URL credentials, and drops credential fields", async () => {
    const { logEvent, redact } = await import("@/lib/monitoring/log");
    expect(redact("user mei@example.com failed")).toBe("user [email] failed");
    expect(redact("postgres://hq:s3cret@db:5432/x")).toBe("postgres://[redacted]@db:5432/x");
    expect(redact("token abcdefghijklmnopqrstuvwxyz0123456789ABCD end")).toBe(
      "token [redacted] end",
    );

    const lines: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((line: string) => void lines.push(line));
    process.env.LOG_IN_TESTS = "1";
    try {
      logEvent("info", "api.request", {
        path: "/api/sync",
        status: 200,
        password: "hunter2",
        authorization: "Bearer x",
        note: "from mei@example.com",
      });
    } finally {
      delete process.env.LOG_IN_TESTS;
      spy.mockRestore();
    }
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({
      level: "info",
      event: "api.request",
      path: "/api/sync",
      status: 200,
    });
    expect(entry).not.toHaveProperty("password");
    expect(entry).not.toHaveProperty("authorization");
    expect(entry.note).toBe("from [email]");
  });
});
