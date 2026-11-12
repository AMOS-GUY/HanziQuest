/**
 * Read-only provenance report over the database (M14): what is still unreviewed, what cites
 * no registered source, which edition tags exist. Writes nothing.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import type { SourceRegister } from "./sources";

type Row = {
  verification: "PROVISIONAL" | "REVIEWED" | "VERIFIED";
  sourceRefs: string[];
  reviewedAt: Date | null;
};

function summarise(rows: Row[], register: SourceRegister) {
  const known = new Map(register.sources.map((s) => [s.id, s]));
  const byVerification = { PROVISIONAL: 0, REVIEWED: 0, VERIFIED: 0 };
  let noSource = 0;
  let unregistered = 0;
  let pendingOnly = 0;
  let raisedWithoutReview = 0;
  for (const r of rows) {
    byVerification[r.verification] += 1;
    if (!r.sourceRefs.length) noSource += 1;
    if (r.sourceRefs.some((ref) => !known.has(ref))) unregistered += 1;
    if (
      r.sourceRefs.length &&
      r.sourceRefs.every((ref) => known.get(ref)?.approval.status !== "APPROVED")
    )
      pendingOnly += 1;
    if (r.verification !== "PROVISIONAL" && !r.reviewedAt) raisedWithoutReview += 1;
  }
  return {
    total: rows.length,
    byVerification,
    /** No source register id at all (e.g. imported before M14). */
    noSource,
    /** Cites an id that isn't in the register. */
    unregistered,
    /** Cites only sources the owner hasn't approved yet. */
    pendingOnly,
    /** REVIEWED or VERIFIED without review metadata (set before M14, or outside the admin). */
    raisedWithoutReview,
  };
}

export async function provenanceReport(prisma: PrismaClient, register: SourceRegister) {
  const select = { verification: true, sourceRefs: true, reviewedAt: true } as const;
  const [curricula, characters, words] = await Promise.all([
    prisma.curriculum.findMany({ select: { slug: true, framework: true, sourceRefs: true } }),
    prisma.character.findMany({
      select: { ...select, hsk20Level: true, hsk30Level: true, hsk30Handwriting: true },
    }),
    prisma.vocabulary.findMany({
      select: {
        ...select,
        hsk20Level: true,
        hsk30Level: true,
        exampleZh: true,
        exampleSourceRef: true,
      },
    }),
  ]);
  return {
    curricula: curricula.map((c) => ({
      slug: c.slug,
      framework: c.framework,
      sourceRefs: c.sourceRefs,
    })),
    characters: {
      ...summarise(characters, register),
      taggedHsk20: characters.filter((c) => c.hsk20Level !== null).length,
      taggedHsk30: characters.filter((c) => c.hsk30Level !== null).length,
      taggedHsk30Handwriting: characters.filter((c) => c.hsk30Handwriting !== null).length,
    },
    words: {
      ...summarise(words, register),
      taggedHsk20: words.filter((w) => w.hsk20Level !== null).length,
      taggedHsk30: words.filter((w) => w.hsk30Level !== null).length,
      withExample: words.filter((w) => w.exampleZh).length,
      exampleWithoutSource: words.filter((w) => w.exampleZh && !w.exampleSourceRef).length,
    },
    sources: register.sources.map((s) => ({
      id: s.id,
      kind: s.kind,
      licenseStatus: s.licenseStatus,
      approval: s.approval.status,
    })),
  };
}
