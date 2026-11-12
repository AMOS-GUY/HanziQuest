import { NextResponse } from "next/server";
import { prisma } from "@/lib/database/prisma";
import { handleApi } from "@/lib/api/respond";
import { assertPermission } from "@/lib/auth/session";
import { analyseSamples } from "@/features/handwriting/samples";
import { ENGINE_VERSION } from "@/features/handwriting/evaluate";

/**
 * GET /api/admin/handwriting/samples — validation samples re-scored with the current engine.
 * `?strokes=1` adds raw ink for offline analysis. Participants appear only by code.
 */
export const GET = handleApi(async (request: Request) => {
  await assertPermission("handwriting:validate");
  const withStrokes = new URL(request.url).searchParams.get("strokes") === "1";
  const { samples, metrics } = await analyseSamples(prisma);
  let rows: unknown[] = samples;
  if (withStrokes) {
    const raw = await prisma.handwritingSample.findMany({
      where: { id: { in: samples.map((s) => s.id) } },
      select: {
        id: true,
        strokes: true,
        style: true,
        canvasSizePx: true,
        writtenHanzi: true,
        observations: true,
      },
    });
    const byId = new Map(raw.map((r) => [r.id, r]));
    rows = samples.map((s) => ({ ...s, ...byId.get(s.id) }));
  }
  return NextResponse.json(
    { engineVersion: ENGINE_VERSION, exportedAt: new Date().toISOString(), metrics, samples: rows },
    { headers: { "Cache-Control": "no-store" } },
  );
});
