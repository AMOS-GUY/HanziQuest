import { NextResponse } from "next/server";
import { prisma } from "@/lib/database/prisma";
import { apiError, handleApi } from "@/lib/api/respond";
import { loadStrokeJson } from "@/features/handwriting/reference-store";
import { publicReadLimiter } from "@/lib/security/rate-limit";
import { ipFromHeaders } from "@/lib/security/request-info";

/**
 * GET /api/characters/:hanzi — stroke data (Make Me a Hanzi format, as used by Hanzi Writer).
 * Public, cacheable: the data is openly licensed (Arphic Public License).
 */
export const GET = handleApi(
  async (request: Request, context: { params: Promise<{ hanzi: string }> }) => {
    if (!(await publicReadLimiter.consume(ipFromHeaders(request.headers))).allowed)
      return apiError(429, "rate_limited", "Too many requests. Please slow down.");
    const { hanzi: raw } = await context.params;
    const hanzi = decodeURIComponent(raw);
    if ([...hanzi].length !== 1 || !/^\p{Script=Han}$/u.test(hanzi)) {
      return apiError(400, "invalid_character", "Provide a single Chinese character.");
    }
    const data = (await loadStrokeJson(prisma, [hanzi]))[hanzi];
    if (!data) return apiError(404, "not_found", "No stroke data for this character.");
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
    });
  },
);
