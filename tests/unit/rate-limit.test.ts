import { describe, expect, it } from "vitest";
import { RateLimiter } from "@/lib/security/rate-limit";

describe("RateLimiter", () => {
  it("allows up to the limit within a window, then blocks", () => {
    let now = 0;
    const limiter = new RateLimiter(3, 1000, () => now);
    expect(limiter.consume("k").allowed).toBe(true);
    expect(limiter.consume("k").allowed).toBe(true);
    const third = limiter.consume("k");
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = limiter.consume("k");
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBe(1);

    now = 1000;
    expect(limiter.consume("k").allowed).toBe(true);
  });

  it("tracks keys independently and supports reset", () => {
    const limiter = new RateLimiter(1, 1000, () => 0);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("b").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
    limiter.reset("a");
    expect(limiter.consume("a").allowed).toBe(true);
  });
});
