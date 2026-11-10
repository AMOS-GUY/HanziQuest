/**
 * Fixed-window rate limiting.
 *
 * Two stores: an in-memory one (per process; development and tests) and a PostgreSQL one
 * (`RateLimitBucket`, shared by every instance). Production uses PostgreSQL unless
 * RATE_LIMIT_STORE=memory. If the database is unreachable the memory store takes over, so
 * limits still apply per instance rather than not at all. See docs/SECURITY.md.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  consume(key: string): RateLimitResult {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (this.buckets.size > 10_000) this.prune(now);
    const allowed = bucket.count <= this.limit;
    return {
      allowed,
      remaining: Math.max(0, this.limit - bucket.count),
      retryAfterSeconds: allowed ? 0 : Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  reset(key: string) {
    this.buckets.delete(key);
  }

  private prune(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

type Store = "memory" | "postgres";

function storeKind(): Store {
  const configured = process.env.RATE_LIMIT_STORE;
  if (configured === "memory" || configured === "postgres") return configured;
  return process.env.NODE_ENV === "production" ? "postgres" : "memory";
}

async function consumePostgres(key: string, limit: number, windowMs: number) {
  // Imported lazily so unit tests of the memory limiter don't need a database.
  const { prisma } = await import("@/lib/database/prisma");
  // Times come from the app, never the database's now(): the column is a UTC timestamp without
  // time zone, and now() would be shifted by the database session's time zone.
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  const rows = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt") VALUES (${key}, 1, ${resetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN EXCLUDED."resetAt" ELSE "RateLimitBucket"."resetAt" END
    RETURNING "count", "resetAt"`;
  if (Math.random() < 0.01) {
    void prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "resetAt" < ${new Date(now.getTime() - 3_600_000)}`.catch(
      () => undefined,
    );
  }
  const row = rows[0]!;
  const allowed = row.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - row.count),
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil((row.resetAt.getTime() - Date.now()) / 1000)),
  };
}

export interface Limit {
  consume(key: string): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

const globalForLimiters = globalThis as unknown as { hqLimiters?: Record<string, RateLimiter> };
const memory = (globalForLimiters.hqLimiters ??= {});

/** A named limit of `limit` events per `windowMs`, backed by the configured store. */
export function createLimit(name: string, limit: number, windowMs: number): Limit {
  const local = (memory[name] ??= new RateLimiter(limit, windowMs));
  return {
    async consume(key) {
      if (storeKind() === "postgres") {
        try {
          return await consumePostgres(`${name}:${key}`, limit, windowMs);
        } catch (error) {
          console.error("[rate-limit] shared store unavailable, using memory", error);
        }
      }
      return local.consume(key);
    },
    async reset(key) {
      local.reset(key);
      if (storeKind() === "postgres") {
        const { prisma } = await import("@/lib/database/prisma");
        await prisma.rateLimitBucket
          .deleteMany({ where: { key: `${name}:${key}` } })
          .catch(() => undefined);
      }
    },
  };
}

function envLimit(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 10 sign-in attempts per 15 minutes per (email, IP). */
export const loginLimiter = createLimit("login", 10, 15 * 60 * 1000);
/** 30 sign-in attempts per hour per email across all IPs. */
export const loginEmailLimiter = createLimit("login-email", 30, 60 * 60 * 1000);
/** 3 account deletions per hour per IP. */
export const accountDeletionLimiter = createLimit("delete-account", 3, 60 * 60 * 1000);
/** 5 registrations per hour per IP (override with REGISTER_LIMIT_PER_HOUR, e.g. for e2e tests). */
export const registerLimiter = createLimit(
  "register",
  envLimit("REGISTER_LIMIT_PER_HOUR", 5),
  60 * 60 * 1000,
);
/** 120 learning API writes (attempts, sessions, sync) per minute per user. */
export const learningWriteLimiter = createLimit("learning", 120, 60 * 1000);
/** 60 admin mutations per minute per user. */
export const adminMutationLimiter = createLimit("admin", 60, 60 * 1000);
/** 5 password changes per hour per user. */
export const passwordChangeLimiter = createLimit("password", 5, 60 * 60 * 1000);
/** 30 client error reports per 10 minutes per IP. */
export const clientErrorLimiter = createLimit("client-error", 30, 10 * 60 * 1000);
