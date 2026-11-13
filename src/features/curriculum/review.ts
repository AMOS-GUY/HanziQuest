/**
 * Content review workflow (M14-b, D-071, D-072).
 *
 * - Only holders of `curriculum:review` (Super Admins, Content reviewers) record decisions;
 *   checked here as well as in the action. Editors never change verification (curriculum-admin).
 * - A decision applies to one exact version (fingerprint). The reviewer submits the fingerprint
 *   they saw; if the content changed meanwhile, the decision is refused.
 * - Self-review is refused: whoever changed this version (edit, structure change or import since
 *   the last approval) can't approve it.
 * - Source rules are the import rules (`checkSources`): REVIEWED or VERIFIED needs registered,
 *   owner-APPROVED sources that may supply readings and glosses (examples: examples); VERIFIED
 *   also needs a known licence everywhere.
 * - A curriculum can be approved only when every character and word it teaches holds a current
 *   approval at that level or higher.
 * - `reconcileReviews` returns approved items whose content has changed since approval to
 *   PROVISIONAL (audited). Every edit path and the importer call it in their transaction.
 * - Review rows are never updated or deleted: they are the history.
 */
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { DomainError, type Actor } from "@/features/administration/services";
import { ADMIN_ROLES, hasPermission } from "@/lib/permissions/permissions";
import { VERIFICATION_RANK, type Verification } from "./provenance";
import { sourceRegister, type SourceRegister } from "./sources";
import {
  characterVersions,
  curriculumItems,
  curriculumVersion,
  vocabularyVersions,
  type ContentVersion,
} from "./review-fingerprint";

type Db = PrismaClient | Prisma.TransactionClient;
export type ReviewEntityType = "CURRICULUM" | "CHARACTER" | "VOCABULARY";

/** Audit entity names used by the edit paths, per review entity. */
const AUDIT_ENTITY: Record<ReviewEntityType, string> = {
  CURRICULUM: "Curriculum",
  CHARACTER: "Character",
  VOCABULARY: "Vocabulary",
};

export type ReviewStatus =
  "approved" | "stale" | "changes-requested" | "needs-review" | "unreviewed-status";

export interface ReviewBlocker {
  code:
    | "no-source"
    | "unregistered-source"
    | "source-not-approved"
    | "licence-unknown"
    | "items-not-approved";
  message: string;
}

// ─── Source rules (shared with imports) ─────────────────────────────────────

/** Why `level` can't be granted on the basis of these sources (empty: it can). */
export function sourceBlockers(
  item: {
    sourceRefs: readonly string[];
    licenseStatus: string;
    example?: { sourceRef: string | null } | null;
  },
  level: "REVIEWED" | "VERIFIED",
  kind: ReviewEntityType,
  register: SourceRegister,
): ReviewBlocker[] {
  const byId = new Map(register.sources.map((s) => [s.id, s]));
  const out: ReviewBlocker[] = [];
  if (!item.sourceRefs.length)
    out.push({ code: "no-source", message: "No registered source is recorded for this item." });
  const check = (ref: string, needs: readonly string[]) => {
    const src = byId.get(ref);
    if (!src) {
      out.push({
        code: "unregistered-source",
        message: `Source "${ref}" is not in the source register.`,
      });
      return;
    }
    if (src.approval.status !== "APPROVED")
      out.push({
        code: "source-not-approved",
        message: `Source "${ref}" is awaiting the owner's approval.`,
      });
    if (level === "VERIFIED" && src.licenseStatus === "UNKNOWN")
      out.push({ code: "licence-unknown", message: `Source "${ref}" has an unknown licence.` });
    if (needs.length && !needs.some((n) => (src.provides as readonly string[]).includes(n)))
      out.push({
        code: "unregistered-source",
        message: `Source "${ref}" may not supply ${needs.join(" or ")}.`,
      });
  };
  const needs = kind === "CURRICULUM" ? [] : ["reading", "gloss"];
  // A character or word needs at least one source that may supply readings or glosses; other
  // refs (for example stroke data) are checked for registration and approval only.
  for (const ref of item.sourceRefs) check(ref, []);
  if (
    needs.length &&
    item.sourceRefs.length &&
    !item.sourceRefs.some((ref) =>
      (byId.get(ref)?.provides as readonly string[] | undefined)?.some((p) => needs.includes(p)),
    )
  )
    out.push({
      code: "unregistered-source",
      message: "None of its sources may supply readings or glosses.",
    });
  if (item.example?.sourceRef !== undefined && item.example !== null) {
    if (!item.example.sourceRef)
      out.push({ code: "no-source", message: "The example sentence has no recorded source." });
    else check(item.example.sourceRef, ["example"]);
  }
  if (level === "VERIFIED" && item.licenseStatus === "UNKNOWN")
    out.push({ code: "licence-unknown", message: "The item's licence is unknown." });
  return dedupe(out);
}

const dedupe = (xs: ReviewBlocker[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => !seen.has(x.message) && (seen.add(x.message), true));
};

// ─── Loading items and their review state ───────────────────────────────────

interface ReviewRow {
  id: string;
  entityType: ReviewEntityType;
  entityId: string;
  fingerprint: string;
  decision: "APPROVED" | "CHANGES_REQUESTED";
  level: Verification | null;
  reviewerRole: string;
  note: string | null;
  createdAt: Date;
  snapshot: unknown;
}

async function reviewsFor(db: Db, type: ReviewEntityType, ids: readonly string[]) {
  const rows = (await db.contentReview.findMany({
    where: { entityType: type, entityId: { in: [...ids] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      entityType: true,
      entityId: true,
      fingerprint: true,
      decision: true,
      level: true,
      reviewerRole: true,
      note: true,
      createdAt: true,
      snapshot: true,
    },
  })) as ReviewRow[];
  const byId = new Map<string, ReviewRow[]>();
  for (const r of rows) byId.set(r.entityId, [...(byId.get(r.entityId) ?? []), r]);
  return byId;
}

/** Status of one item from its current verification, current version and review history. */
export function reviewStatus(
  verification: Verification,
  fingerprint: string,
  history: readonly ReviewRow[],
  /** False when the item's sources no longer support its level (a source approval withdrawn). */
  sourcesAllow = true,
): ReviewStatus {
  const latest = history[0];
  const approval = history.find((r) => r.decision === "APPROVED");
  if (verification !== "PROVISIONAL") {
    if (!approval) return "unreviewed-status"; // set before M14-b, or declared by an import
    if (approval.fingerprint !== fingerprint || !sourcesAllow) return "stale";
    // The status must be the level that was approved (an import may have declared another).
    if (approval.level !== verification) return "unreviewed-status";
    return "approved";
  }
  if (approval && approval.fingerprint !== fingerprint && latest === approval) return "stale";
  if (latest?.decision === "CHANGES_REQUESTED" && latest.fingerprint === fingerprint)
    return "changes-requested";
  return "needs-review";
}

export interface QueueItem {
  entityType: ReviewEntityType;
  entityId: string;
  title: string;
  details: Record<string, string | null>;
  verification: Verification;
  status: ReviewStatus;
  fingerprint: string;
  sourceRefs: string[];
  blockers: { REVIEWED: ReviewBlocker[]; VERIFIED: ReviewBlocker[] };
  history: {
    decision: string;
    level: string | null;
    reviewerRole: string;
    note: string | null;
    createdAt: Date;
    fingerprint: string;
  }[];
  /** Fields that changed since the last approval (for stale items). */
  changedSinceApproval: string[];
}

function changedFields(before: unknown, now: Record<string, unknown>) {
  if (!before || typeof before !== "object") return [];
  const b = before as Record<string, unknown>;
  return Object.keys({ ...b, ...now })
    .filter((k) => JSON.stringify(b[k] ?? null) !== JSON.stringify(now[k] ?? null))
    .sort();
}

/** The review queue for one curriculum: its characters, its words and the curriculum itself. */
export async function reviewQueue(
  prisma: PrismaClient,
  curriculumId: string,
  register: SourceRegister = sourceRegister(),
): Promise<QueueItem[]> {
  const items = await curriculumItems(prisma, curriculumId);
  const [charRows, wordRows, curriculum, cv, wv] = await Promise.all([
    prisma.character.findMany({
      where: { id: { in: items.characterIds } },
      orderBy: { hanzi: "asc" },
      select: {
        id: true,
        hanzi: true,
        pinyin: true,
        meaning: true,
        traditional: true,
        verification: true,
        sourceRefs: true,
        licenseStatus: true,
      },
    }),
    prisma.vocabulary.findMany({
      where: { id: { in: items.vocabularyIds } },
      orderBy: { simplified: "asc" },
      select: {
        id: true,
        simplified: true,
        pinyin: true,
        meaning: true,
        partOfSpeech: true,
        exampleZh: true,
        exampleEn: true,
        exampleSourceRef: true,
        verification: true,
        sourceRefs: true,
        licenseStatus: true,
      },
    }),
    prisma.curriculum.findUnique({
      where: { id: curriculumId },
      select: {
        id: true,
        name: true,
        framework: true,
        version: true,
        verification: true,
        sourceRefs: true,
        licenseStatus: true,
      },
    }),
    characterVersions(prisma, items.characterIds),
    vocabularyVersions(prisma, items.vocabularyIds),
  ]);
  // The curriculum's version reuses the item versions computed above.
  const cuv = await curriculumVersion(prisma, curriculumId, {
    items,
    characters: cv,
    vocabulary: wv,
  });
  if (!curriculum || !cuv) return [];
  const [ch, vo, cu] = await Promise.all([
    reviewsFor(prisma, "CHARACTER", items.characterIds),
    reviewsFor(prisma, "VOCABULARY", items.vocabularyIds),
    reviewsFor(prisma, "CURRICULUM", [curriculumId]),
  ]);
  const build = (
    entityType: ReviewEntityType,
    id: string,
    title: string,
    details: Record<string, string | null>,
    verification: Verification,
    version: ContentVersion,
    history: ReviewRow[],
    provenance: Parameters<typeof sourceBlockers>[0],
    extraBlockers: ReviewBlocker[] = [],
  ): QueueItem => {
    const approval = history.find((r) => r.decision === "APPROVED");
    const blockers = {
      REVIEWED: [...sourceBlockers(provenance, "REVIEWED", entityType, register), ...extraBlockers],
      VERIFIED: [...sourceBlockers(provenance, "VERIFIED", entityType, register), ...extraBlockers],
    };
    const sourcesAllow = verification === "PROVISIONAL" || blockers[verification].length === 0;
    const status = reviewStatus(verification, version.fingerprint, history, sourcesAllow);
    const changed =
      status === "stale" && approval ? changedFields(approval.snapshot, version.snapshot) : [];
    return {
      entityType,
      entityId: id,
      title,
      details,
      verification,
      status,
      fingerprint: version.fingerprint,
      sourceRefs: [...provenance.sourceRefs],
      blockers,
      history: history.slice(0, 10).map((r) => ({
        decision: r.decision,
        level: r.level,
        reviewerRole: r.reviewerRole,
        note: r.note,
        createdAt: r.createdAt,
        fingerprint: r.fingerprint,
      })),
      changedSinceApproval:
        changed.length || status !== "stale" || sourcesAllow
          ? changed
          : [
              blockers[verification as "REVIEWED" | "VERIFIED"].some(
                (b) => b.code === "items-not-approved",
              )
                ? "items no longer approved"
                : "sources no longer support this level",
            ],
    };
  };
  const characters = charRows.map((c) =>
    build(
      "CHARACTER",
      c.id,
      c.hanzi,
      { pinyin: c.pinyin, meaning: c.meaning, traditional: c.traditional },
      c.verification,
      cv.get(c.id)!,
      ch.get(c.id) ?? [],
      { sourceRefs: c.sourceRefs, licenseStatus: c.licenseStatus },
    ),
  );
  const words = wordRows.map((w) =>
    build(
      "VOCABULARY",
      w.id,
      w.simplified,
      {
        pinyin: w.pinyin,
        meaning: w.meaning,
        partOfSpeech: w.partOfSpeech,
        example: w.exampleZh ? `${w.exampleZh} (${w.exampleEn ?? ""})` : null,
      },
      w.verification,
      wv.get(w.id)!,
      vo.get(w.id) ?? [],
      {
        sourceRefs: w.sourceRefs,
        licenseStatus: w.licenseStatus,
        example: w.exampleZh ? { sourceRef: w.exampleSourceRef } : null,
      },
    ),
  );
  const notApproved = [...characters, ...words].filter((x) => x.status !== "approved").length;
  const cur = build(
    "CURRICULUM",
    curriculum.id,
    curriculum.name,
    { framework: curriculum.framework, version: curriculum.version },
    curriculum.verification,
    cuv,
    cu.get(curriculum.id) ?? [],
    { sourceRefs: curriculum.sourceRefs, licenseStatus: curriculum.licenseStatus },
    notApproved
      ? [
          {
            code: "items-not-approved",
            message: `${notApproved} character(s) and word(s) in this curriculum don't have a current approval yet.`,
          },
        ]
      : [],
  );
  return [cur, ...characters, ...words];
}

// ─── Recording a decision ───────────────────────────────────────────────────

export const reviewInputSchema = z
  .object({
    entityType: z.enum(["CURRICULUM", "CHARACTER", "VOCABULARY"]),
    entityId: z.string().min(1).max(64),
    /** The version the reviewer saw. */
    fingerprint: z.string().regex(/^v\d+:[0-9a-f]{64}$/, "Unknown version."),
    decision: z.enum(["APPROVE_REVIEWED", "APPROVE_VERIFIED", "REQUEST_CHANGES"]),
    note: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .refine((v) => v.decision !== "REQUEST_CHANGES" || (v.note?.length ?? 0) >= 5, {
    path: ["note"],
    message: "Say what needs to change (at least a few words).",
  });

async function currentVersion(db: Db, type: ReviewEntityType, id: string) {
  if (type === "CURRICULUM") return curriculumVersion(db, id);
  const map =
    type === "CHARACTER" ? await characterVersions(db, [id]) : await vocabularyVersions(db, [id]);
  return map.get(id) ?? null;
}

/** Curricula whose lessons teach any of these characters or words. */
async function curriculaContaining(
  db: Db,
  characterIds: readonly string[],
  vocabularyIds: readonly string[],
) {
  const rows = await db.curriculum.findMany({
    where: {
      levels: {
        some: {
          units: {
            some: {
              lessons: {
                some: {
                  OR: [
                    { characters: { some: { characterId: { in: [...characterIds] } } } },
                    { vocabulary: { some: { vocabularyId: { in: [...vocabularyIds] } } } },
                  ],
                },
              },
            },
          },
        },
      },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Did this actor change this version? Any audited change by them to the item (or, for a
 * curriculum, to its structure or any item in it), or an import of a curriculum containing it,
 * since the last approval of this item.
 */
async function actorAuthoredVersion(db: Db, actorId: string, type: ReviewEntityType, id: string) {
  const lastApproval = await db.contentReview.findFirst({
    where: { entityType: type, entityId: id, decision: "APPROVED" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const since = lastApproval ? { gt: lastApproval.createdAt } : undefined;
  let entityIds: string[] = [id];
  let curricula: string[] = [];
  if (type === "CURRICULUM") {
    const items = await curriculumItems(db, id);
    entityIds = [id, ...items.structureIds, ...items.characterIds, ...items.vocabularyIds];
    curricula = [id];
  } else {
    curricula = await curriculaContaining(
      db,
      type === "CHARACTER" ? [id] : [],
      type === "VOCABULARY" ? [id] : [],
    );
  }
  const authored = await db.auditLog.count({
    where: {
      actorId,
      createdAt: since,
      action: {
        notIn: [
          "content.review.approve",
          "content.review.request-changes",
          "content.review.invalidated",
        ],
      },
      OR: [
        { entityId: { in: entityIds } },
        { action: "content.import", entityId: { in: curricula } },
      ],
    },
  });
  return authored > 0;
}

export async function recordReview(
  prisma: PrismaClient,
  actor: Actor,
  raw: unknown,
  register: SourceRegister = sourceRegister(),
) {
  if (!hasPermission(actor.roles, "curriculum:review"))
    throw new DomainError("forbidden", "Only content reviewers can record review decisions.");
  const input = reviewInputSchema.parse(raw);
  const level: "REVIEWED" | "VERIFIED" | null =
    input.decision === "APPROVE_REVIEWED"
      ? "REVIEWED"
      : input.decision === "APPROVE_VERIFIED"
        ? "VERIFIED"
        : null;

  return prisma.$transaction(
    async (tx) => {
      // Serialise decisions on the same item.
      await lockForReview(tx, {
        characterIds: input.entityType === "CHARACTER" ? [input.entityId] : [],
        vocabularyIds: input.entityType === "VOCABULARY" ? [input.entityId] : [],
        curriculumIds: input.entityType === "CURRICULUM" ? [input.entityId] : [],
      });
      const version = await currentVersion(tx, input.entityType, input.entityId);
      if (!version) throw new DomainError("not_found", "That item no longer exists.");
      if (version.fingerprint !== input.fingerprint)
        throw new DomainError(
          "conflict",
          "This item changed after you opened it. Reload the review queue and review the current version.",
        );
      if (await actorAuthoredVersion(tx, actor.id, input.entityType, input.entityId))
        throw new DomainError(
          "forbidden",
          "You changed or imported this version, so another reviewer has to review it.",
        );

      if (level) {
        // A repeated or concurrent approval of the same version adds nothing: refuse it rather
        // than writing a duplicate record. Raising REVIEWED to VERIFIED is a new decision.
        const current = await currentState(tx, input.entityType, input.entityId, register);
        if (current && approvedAt(current, level))
          throw new DomainError(
            "conflict",
            `This version is already approved as ${current.verification.toLowerCase()}.`,
          );
        const blockers = await approvalBlockers(
          tx,
          input.entityType,
          input.entityId,
          level,
          register,
        );
        if (blockers.length)
          throw new DomainError(
            "conflict",
            `Can't approve: ${blockers.map((b) => b.message).join(" ")}`,
          );
      }

      const reviewerRole = ADMIN_ROLES.find((r) => actor.roles.includes(r)) ?? "UNKNOWN";
      const review = await tx.contentReview.create({
        data: {
          entityType: input.entityType,
          entityId: input.entityId,
          fingerprint: version.fingerprint,
          decision: level ? "APPROVED" : "CHANGES_REQUESTED",
          level,
          reviewerId: actor.id,
          reviewerRole,
          note: input.note,
          snapshot: version.snapshot as Prisma.InputJsonValue,
        },
      });
      const next: Verification = level ?? "PROVISIONAL";
      const before = await setVerification(
        tx,
        input.entityType,
        input.entityId,
        next,
        level ? reviewerRole : null,
      );
      await recordAudit(tx, {
        actorId: actor.id,
        action: level ? "content.review.approve" : "content.review.request-changes",
        entityType: AUDIT_ENTITY[input.entityType],
        entityId: input.entityId,
        before: { verification: before },
        after: {
          verification: next,
          reviewId: review.id,
          fingerprint: version.fingerprint,
          note: input.note,
        },
        ipAddress: actor.ip,
        userAgent: actor.userAgent,
      });
      // Withdrawing an item's approval can invalidate the curricula that rely on it.
      if (!level && input.entityType !== "CURRICULUM")
        await reconcileReviews(
          tx,
          {
            characterIds: input.entityType === "CHARACTER" ? [input.entityId] : [],
            vocabularyIds: input.entityType === "VOCABULARY" ? [input.entityId] : [],
          },
          actor.id,
        );
      return review;
    },
    // Same limits as edits: an import holds the review lock for a few seconds.
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/** The current review state of one item, or of a curriculum (status from its own history). */
async function currentState(
  db: Db,
  type: ReviewEntityType,
  id: string,
  register: SourceRegister,
): Promise<{ status: ReviewStatus; verification: Verification } | null> {
  if (type !== "CURRICULUM") return (await itemStates(db, type, [id], register)).get(id) ?? null;
  const [row, version, history] = await Promise.all([
    db.curriculum.findUnique({ where: { id }, select: { verification: true } }),
    curriculumVersion(db, id),
    reviewsFor(db, "CURRICULUM", [id]),
  ]);
  if (!row || !version) return null;
  return {
    verification: row.verification,
    status: reviewStatus(row.verification, version.fingerprint, history.get(id) ?? []),
  };
}

async function approvalBlockers(
  tx: Prisma.TransactionClient,
  type: ReviewEntityType,
  id: string,
  level: "REVIEWED" | "VERIFIED",
  /** None: check only that every item of a curriculum is approved (reconciling after edits). */
  register: SourceRegister | null,
): Promise<ReviewBlocker[]> {
  if (type !== "CURRICULUM" && !register) return [];
  if (type === "CHARACTER") {
    const c = await tx.character.findUniqueOrThrow({
      where: { id },
      select: { sourceRefs: true, licenseStatus: true },
    });
    return sourceBlockers(c, level, type, register!);
  }
  if (type === "VOCABULARY") {
    const v = await tx.vocabulary.findUniqueOrThrow({
      where: { id },
      select: { sourceRefs: true, licenseStatus: true, exampleZh: true, exampleSourceRef: true },
    });
    return sourceBlockers(
      { ...v, example: v.exampleZh ? { sourceRef: v.exampleSourceRef } : null },
      level,
      type,
      register!,
    );
  }
  const c = await tx.curriculum.findUniqueOrThrow({
    where: { id },
    select: { sourceRefs: true, licenseStatus: true },
  });
  const blockers = register ? sourceBlockers(c, level, type, register) : [];
  // Every item must hold a current approval at this level or higher.
  const items = await curriculumItems(tx, id);
  const states = [
    ...(await itemStates(tx, "CHARACTER", items.characterIds, register)).values(),
    ...(await itemStates(tx, "VOCABULARY", items.vocabularyIds, register)).values(),
  ];
  const missing = states.filter((x) => !approvedAt(x, level)).length;
  if (missing)
    blockers.push({
      code: "items-not-approved",
      message: `${missing} character(s) and word(s) in this curriculum don't have a current approval at ${level} or higher.`,
    });
  return blockers;
}

/** An item's current review state: its version, history, and status under the source rules. */
interface ItemState {
  id: string;
  verification: Verification;
  version: ContentVersion;
  history: ReviewRow[];
  status: ReviewStatus;
}

async function itemStates(
  db: Db,
  type: "CHARACTER" | "VOCABULARY",
  ids: readonly string[],
  /** None: the source rules aren't checked (versions only). */
  register: SourceRegister | null,
): Promise<Map<string, ItemState>> {
  if (!ids.length) return new Map();
  const where = { id: { in: [...ids] } };
  const [versions, reviews, rows] = await Promise.all([
    type === "CHARACTER" ? characterVersions(db, ids) : vocabularyVersions(db, ids),
    reviewsFor(db, type, ids),
    type === "CHARACTER"
      ? db.character.findMany({
          where,
          select: { id: true, verification: true, sourceRefs: true, licenseStatus: true },
        })
      : db.vocabulary
          .findMany({
            where,
            select: {
              id: true,
              verification: true,
              sourceRefs: true,
              licenseStatus: true,
              exampleZh: true,
              exampleSourceRef: true,
            },
          })
          .then((rs) =>
            rs.map(({ exampleZh, exampleSourceRef, ...r }) => ({
              ...r,
              example: exampleZh ? { sourceRef: exampleSourceRef } : null,
            })),
          ),
  ]);
  const out = new Map<string, ItemState>();
  for (const row of rows) {
    const version = versions.get(row.id)!;
    const history = reviews.get(row.id) ?? [];
    const sourcesAllow =
      !register ||
      row.verification === "PROVISIONAL" ||
      sourceBlockers(row, row.verification, type, register).length === 0;
    out.set(row.id, {
      id: row.id,
      verification: row.verification,
      version,
      history,
      status: reviewStatus(row.verification, version.fingerprint, history, sourcesAllow),
    });
  }
  return out;
}

function approvedAt(
  state: { status: ReviewStatus; verification: Verification },
  level: Verification,
) {
  return (
    state.status === "approved" && VERIFICATION_RANK[state.verification] >= VERIFICATION_RANK[level]
  );
}

/** Sets an item's verification (and stamps); returns the previous value. */
async function setVerification(
  tx: Prisma.TransactionClient,
  type: ReviewEntityType,
  id: string,
  verification: Verification,
  reviewerRole: string | null,
): Promise<Verification> {
  const stamp =
    verification === "PROVISIONAL"
      ? { reviewerRole: null, reviewedAt: null }
      : { reviewerRole, reviewedAt: new Date() };
  if (type === "CURRICULUM") {
    const before = await tx.curriculum.findUniqueOrThrow({
      where: { id },
      select: { verification: true },
    });
    await tx.curriculum.update({ where: { id }, data: { verification } });
    return before.verification;
  }
  if (type === "CHARACTER") {
    const before = await tx.character.findUniqueOrThrow({
      where: { id },
      select: { verification: true },
    });
    await tx.character.update({ where: { id }, data: { verification, ...stamp } });
    return before.verification;
  }
  const before = await tx.vocabulary.findUniqueOrThrow({
    where: { id },
    select: { verification: true, exampleZh: true },
  });
  await tx.vocabulary.update({
    where: { id },
    data: {
      verification,
      ...stamp,
      // The example is part of the reviewed version, so it shares the decision.
      ...(before.exampleZh ? { exampleVerification: verification } : {}),
    },
  });
  return before.verification;
}

/** Serialises review decisions and reconciliation on one item (transaction-scoped, re-entrant). */
async function lockItem(tx: Prisma.TransactionClient, type: ReviewEntityType, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`review:${type}:${id}`}))`;
}

/**
 * Lock order for anything that writes reviewed content (M14-b): take these locks FIRST in the
 * transaction, before updating rows, so that approvals (which lock, then write) and edits never
 * wait on each other in opposite orders.
 * - A global key: shared for approvals and single-item edits, exclusive for imports (which touch
 *   many rows), so imports and approvals serialise.
 * - Then per-item keys, items before curricula, each sorted.
 */
export async function lockForReview(
  tx: Prisma.TransactionClient,
  scope: {
    characterIds?: readonly string[];
    vocabularyIds?: readonly string[];
    curriculumIds?: readonly string[];
  },
  mode: "shared" | "exclusive" = "shared",
) {
  if (mode === "exclusive")
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('review:*'))`;
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('review:*'))`;
  for (const id of [...(scope.characterIds ?? [])].sort()) await lockItem(tx, "CHARACTER", id);
  for (const id of [...(scope.vocabularyIds ?? [])].sort()) await lockItem(tx, "VOCABULARY", id);
  for (const id of [...(scope.curriculumIds ?? [])].sort()) await lockItem(tx, "CURRICULUM", id);
}

// ─── Keeping approvals honest after changes ─────────────────────────────────

/**
 * Returns to PROVISIONAL every approved item whose content changed since its approval, and
 * every approved curriculum whose version changed or whose items no longer all hold an approval
 * at its level. Items with a status but no review record (set before M14-b, or declared by an
 * import) are left as they are and reported by `reviewProgress`. Call inside the transaction of
 * any change to content, structure or provenance.
 */
export async function reconcileReviews(
  tx: Prisma.TransactionClient,
  scope: {
    characterIds?: readonly string[];
    vocabularyIds?: readonly string[];
    curriculumIds?: readonly string[];
  },
  actorId: string | null,
  /**
   * With a register, approvals whose sources no longer support their level are invalidated too
   * (`reconcileAllReviews`, after the owner withdraws a source approval). Edits and imports pass
   * none: they check versions only.
   */
  register: SourceRegister | null = null,
) {
  const characterIds = [...(scope.characterIds ?? [])].sort();
  const vocabularyIds = [...(scope.vocabularyIds ?? [])].sort();
  const invalidated: { type: ReviewEntityType; id: string }[] = [];
  // Same locks as recordReview, taken before reading: a concurrent approval either commits first
  // (and is invalidated here) or waits and then sees the changed version (and is refused).
  // Order: items before curricula, sorted, so concurrent transactions can't deadlock.
  for (const id of characterIds) await lockItem(tx, "CHARACTER", id);
  for (const id of vocabularyIds) await lockItem(tx, "VOCABULARY", id);

  const items = async (type: "CHARACTER" | "VOCABULARY", ids: string[]) => {
    for (const state of (await itemStates(tx, type, ids, register)).values()) {
      // Stale: the content changed since approval (or, with a register, its sources no longer
      // support the level).
      if (state.verification === "PROVISIONAL" || state.status !== "stale") continue;
      const approval = state.history.find((r) => r.decision === "APPROVED")!;
      await invalidate(
        tx,
        type,
        state.id,
        state.verification,
        approval.fingerprint,
        state.version.fingerprint,
        actorId,
      );
      invalidated.push({ type, id: state.id });
    }
  };
  await items("CHARACTER", characterIds);
  await items("VOCABULARY", vocabularyIds);

  const curricula = new Set([
    ...(scope.curriculumIds ?? []),
    ...(characterIds.length || vocabularyIds.length
      ? await curriculaContaining(tx, characterIds, vocabularyIds)
      : []),
  ]);
  for (const id of [...curricula].sort()) {
    await lockItem(tx, "CURRICULUM", id);
    const row = await tx.curriculum.findUnique({ where: { id }, select: { verification: true } });
    if (!row || row.verification === "PROVISIONAL") continue;
    const history = (await reviewsFor(tx, "CURRICULUM", [id])).get(id) ?? [];
    const approval = history.find((r) => r.decision === "APPROVED");
    if (!approval) continue; // status without a review record: reported, not changed
    const version = await curriculumVersion(tx, id);
    const blockers = await approvalBlockers(
      tx,
      "CURRICULUM",
      id,
      row.verification as "REVIEWED" | "VERIFIED",
      register,
    );
    // Still valid only for the approved version, at the approved level, with every item approved
    // (and, with a register, the curriculum's own sources still allowing the level).
    if (
      version &&
      approval.fingerprint === version.fingerprint &&
      approval.level === row.verification &&
      blockers.length === 0
    )
      continue;
    await invalidate(
      tx,
      "CURRICULUM",
      id,
      row.verification,
      approval.fingerprint,
      version?.fingerprint ?? null,
      actorId,
    );
    invalidated.push({ type: "CURRICULUM", id });
  }
  return invalidated;
}

async function invalidate(
  tx: Prisma.TransactionClient,
  type: ReviewEntityType,
  id: string,
  was: Verification,
  approvedFingerprint: string,
  currentFingerprint: string | null,
  actorId: string | null,
) {
  await setVerification(tx, type, id, "PROVISIONAL", null);
  await recordAudit(tx, {
    actorId,
    action: "content.review.invalidated",
    entityType: AUDIT_ENTITY[type],
    entityId: id,
    before: { verification: was, fingerprint: approvedFingerprint },
    after: { verification: "PROVISIONAL", fingerprint: currentFingerprint },
  });
}

// ─── Progress ───────────────────────────────────────────────────────────────

export interface ReviewProgress {
  curriculumId: string;
  total: number;
  byStatus: Record<ReviewStatus, number>;
  byKind: Record<"CHARACTER" | "VOCABULARY", Record<ReviewStatus, number>>;
  curriculum: ReviewStatus;
  /** Items that can't be approved yet because a source awaits the owner's approval. */
  blockedBySources: number;
}

const emptyCounts = (): Record<ReviewStatus, number> => ({
  approved: 0,
  stale: 0,
  "changes-requested": 0,
  "needs-review": 0,
  "unreviewed-status": 0,
});

export function summariseQueue(curriculumId: string, queue: readonly QueueItem[]): ReviewProgress {
  const byStatus = emptyCounts();
  const byKind = { CHARACTER: emptyCounts(), VOCABULARY: emptyCounts() };
  let curriculum: ReviewStatus = "needs-review";
  let blockedBySources = 0;
  for (const q of queue) {
    if (q.entityType === "CURRICULUM") {
      curriculum = q.status;
      continue;
    }
    byStatus[q.status] += 1;
    byKind[q.entityType][q.status] += 1;
    if (q.status !== "approved" && q.blockers.REVIEWED.some((b) => b.code !== "items-not-approved"))
      blockedBySources += 1;
  }
  return {
    curriculumId,
    total: queue.filter((q) => q.entityType !== "CURRICULUM").length,
    byStatus,
    byKind,
    curriculum,
    blockedBySources,
  };
}

export async function reviewProgress(
  prisma: PrismaClient,
  curriculumId: string,
  register?: SourceRegister,
) {
  return summariseQueue(curriculumId, await reviewQueue(prisma, curriculumId, register));
}

/**
 * Every character, word and curriculum whose status is above PROVISIONAL: the only rows that
 * reconciling can change. Imports reconcile all of them, because an import can change shared
 * characters and words that other curricula teach too.
 *
 * Complete only under the EXCLUSIVE review lock: with no approval in flight, no row can become
 * REVIEWED between this read and the reconciliation. (An experiment with a shared import lock left
 * an approval on changed content: an approval still in flight was missed by this read.)
 */
export async function nonProvisionalScope(db: Db) {
  const where = { verification: { not: "PROVISIONAL" as const } };
  const select = { id: true } as const;
  const [characters, words, curricula] = await Promise.all([
    db.character.findMany({ where, select }),
    db.vocabulary.findMany({ where, select }),
    db.curriculum.findMany({ where, select }),
  ]);
  return {
    characterIds: characters.map((x) => x.id),
    vocabularyIds: words.map((x) => x.id),
    curriculumIds: curricula.map((x) => x.id),
  };
}

class DryRun extends Error {}

/**
 * Reconciles every status above PROVISIONAL, for example after the owner withdraws a source
 * approval in `content/sources.json` (a deploy, not a database change). Takes the exclusive
 * review lock like an import. Without `apply` the transaction is rolled back: a preview.
 */
export async function reconcileAllReviews(
  prisma: PrismaClient,
  options: { apply: boolean; register?: SourceRegister },
) {
  let invalidated: { type: ReviewEntityType; id: string }[] = [];
  try {
    await prisma.$transaction(
      async (tx) => {
        await lockForReview(tx, {}, "exclusive");
        invalidated = await reconcileReviews(
          tx,
          await nonProvisionalScope(tx),
          null,
          options.register ?? sourceRegister(),
        );
        if (!options.apply) throw new DryRun();
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (!(error instanceof DryRun)) throw error;
  }
  return invalidated;
}
