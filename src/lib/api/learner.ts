import "server-only";
import { AuthorizationError, getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { learningWriteLimiter } from "@/lib/security/rate-limit";
import { apiError } from "./respond";

/** Resolves the signed-in learner for an API route, or throws 401. */
export async function requireApiUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError(401);
  return user;
}

/** Returns a 429 response when the learner exceeded the write rate, else null. */
export function rateLimitWrite(userId: string): Response | null {
  const limit = learningWriteLimiter.consume(userId);
  if (limit.allowed) return null;
  const response = apiError(429, "rate_limited", "Too many requests. Please slow down.");
  response.headers.set("Retry-After", String(limit.retryAfterSeconds));
  return response;
}
