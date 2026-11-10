import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthorizationError } from "@/lib/auth/session";
import { DomainError } from "@/features/administration/services";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function apiError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json<ApiErrorBody>({ error: { code, message, details } }, { status });
}

/** Wraps a route handler with consistent error mapping. Unknown errors become 500 without leaking internals. */
export function handleApi<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
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
      console.error("[api] unhandled error", error);
      return apiError(500, "internal_error", "Something went wrong. Please try again.");
    }
  };
}
