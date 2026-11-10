import "server-only";
import { headers } from "next/headers";

/** Best-effort client IP and user agent for rate limiting and audit logs. */
export async function getRequestInfo(): Promise<{ ip: string; userAgent: string | null }> {
  const h = await headers();
  return { ip: ipFromHeaders(h), userAgent: h.get("user-agent") };
}

/**
 * Client IP for rate limiting. The left-most X-Forwarded-For entry is supplied by the client
 * and can be forged, so we take the entry appended by our own proxy: the N-th from the right,
 * where N = TRUSTED_PROXY_HOPS (default 1, e.g. one load balancer or platform edge).
 * With TRUSTED_PROXY_HOPS=0 forwarding headers are ignored (direct exposure).
 */
export function ipFromHeaders(h: Headers): string {
  const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "1", 10);
  if (hops > 0) {
    const forwarded = (h.get("x-forwarded-for") ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (forwarded.length > 0) return forwarded[Math.max(0, forwarded.length - hops)]!;
    const real = h.get("x-real-ip");
    if (real) return real.trim();
  }
  return "unknown";
}
