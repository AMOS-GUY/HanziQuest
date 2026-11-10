import { z } from "zod";
import { apiError, handleApi, readJson } from "@/lib/api/respond";
import { clientErrorLimiter } from "@/lib/security/rate-limit";
import { ipFromHeaders } from "@/lib/security/request-info";
import { reportError } from "@/lib/monitoring/report";

const bodySchema = z.object({
  message: z.string().max(1000),
  name: z.string().max(100).optional(),
  digest: z.string().max(100).optional(),
  path: z.string().max(300).optional(),
});

/** POST /api/client-errors — error boundaries report crashes here (rate limited, bounded). */
export const POST = handleApi(async (request: Request) => {
  const limit = await clientErrorLimiter.consume(ipFromHeaders(request.headers));
  if (!limit.allowed) return apiError(429, "rate_limited", "Too many reports.");
  const body = bodySchema.parse(await readJson(request, 8_000));
  const error = new Error(body.message);
  error.name = body.name ?? "ClientError";
  await reportError(error, {
    source: "client",
    path: body.path?.split("?")[0],
    digest: body.digest,
  });
  return new Response(null, { status: 204 });
});
