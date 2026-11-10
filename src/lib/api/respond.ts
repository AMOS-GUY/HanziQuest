import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthorizationError } from "@/lib/auth/session";
import { DomainError } from "@/features/administration/services";
import { reportError } from "@/lib/monitoring/report";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function apiError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json<ApiErrorBody>({ error: { code, message, details } }, { status });
}

export { PayloadTooLargeError, readJson } from "./body";
import { PayloadTooLargeError } from "./body";

/**
 * Rejects cross-site state-changing requests. Session cookies are SameSite=Lax already; this is
 * defence in depth for browsers or proxies that don't honour it.
 */
function crossSite(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  const allowed = new Set(
    [request.headers.get("x-forwarded-host"), request.headers.get("host")].filter(Boolean),
  );
  if (process.env.AUTH_URL) {
    try {
      allowed.add(new URL(process.env.AUTH_URL).host);
    } catch {
      // ignore malformed AUTH_URL here; env validation reports it at startup
    }
  }
  return !allowed.has(originHost);
}

/** Wraps a route handler with consistent error mapping. Unknown errors become 500 without leaking internals. */
export function handleApi<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    const request = args[0] instanceof Request ? args[0] : null;
    if (request && crossSite(request))
      return apiError(403, "forbidden", "Cross-site requests are not allowed.");
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof PayloadTooLargeError)
        return apiError(413, "payload_too_large", "The request is too large.");
      if (error instanceof AuthorizationError) {
        return apiError(
          error.status,
          error.status === 401 ? "unauthenticated" : "forbidden",
          error.message,
        );
      }
      if (error instanceof z.ZodError) {
        return apiError(
          400,
          "invalid_request",
          "The request is invalid.",
          z.flattenError(error).fieldErrors,
        );
      }
      if (error instanceof DomainError) {
        const status = error.code === "not_found" ? 404 : error.code === "forbidden" ? 403 : 409;
        return apiError(status, error.code, error.message);
      }
      if (error instanceof SyntaxError)
        return apiError(400, "invalid_json", "Request body must be valid JSON.");
      await reportError(error, {
        source: "api",
        path: request ? new URL(request.url).pathname : undefined,
      });
      return apiError(500, "internal_error", "Something went wrong. Please try again.");
    }
  };
}
