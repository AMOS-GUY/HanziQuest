/**
 * Fixed-window in-memory rate limiter.
 *
 * LIMITATION: state lives in the current server process. On a multi-instance or serverless
 * deployment each instance keeps its own counters, so limits are per instance. Replace the
 * store with a shared one (PostgreSQL or Redis) before relying on it for abuse prevention at
 * scale. See docs/SECURITY.md.
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

const globalForLimiters = globalThis as unknown as { hqLimiters?: Record<string, RateLimiter> };
const limiters = (globalForLimiters.hqLimiters ??= {});

/** 10 sign-in attempts per 15 minutes per (email, IP). */
export const loginLimiter = (limiters.login ??= new RateLimiter(10, 15 * 60 * 1000));
/** 5 registrations per hour per IP. */
export const registerLimiter = (limiters.register ??= new RateLimiter(5, 60 * 60 * 1000));
/** 60 admin mutations per minute per user. */
export const adminMutationLimiter = (limiters.admin ??= new RateLimiter(60, 60 * 1000));
