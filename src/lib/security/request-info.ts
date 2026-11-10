import "server-only";
import { headers } from "next/headers";

/** Best-effort client IP and user agent for rate limiting and audit logs. */
export async function getRequestInfo(): Promise<{ ip: string; userAgent: string | null }> {
  const h = await headers();
  return { ip: ipFromHeaders(h), userAgent: h.get("user-agent") };
}

export function ipFromHeaders(h: Headers): string {
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "unknown";
}
