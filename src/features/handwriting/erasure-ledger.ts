/**
 * Erasure ledger (M12 privacy review, D-061, D-062).
 *
 * A backup taken before an erasure still holds the erased samples, and restoring it brings them
 * back. The ledger lists every erased participant code (code, reason, date; no handwriting) so it
 * can be re-applied to any restored database. Restored databases are gated (`ErasureLedgerGate`)
 * and readiness stays 503 until the ledger is applied.
 *
 * Integrity:
 * - entries are canonical (sorted by code, fixed field order), duplicates are rejected, and the
 *   declared `count` must match (an incomplete or truncated ledger is refused)
 * - `entriesSha256` catches corruption; `hmacSha256` (keyed with ERASURE_LEDGER_KEY, held by the
 *   owner and never in the repository) catches unauthorised modification, including a removed
 *   entry
 * - verification happens before any write, and applying is one transaction, so a bad ledger
 *   changes nothing
 * - a ledger never shrinks: exporting over an existing ledger verifies it and keeps its entries
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { ERASURE_REASONS, eraseInTransaction, PARTICIPANT_CODE_PATTERN } from "./participants";

export const LEDGER_FORMAT = "hanziquest-erasure-ledger";
export const LEDGER_VERSION = 2;
export const MIN_LEDGER_KEY_LENGTH = 32;

export type LedgerFailure =
  "corrupted" | "incomplete" | "duplicate" | "checksum" | "signature" | "key";

export class LedgerError extends Error {
  constructor(
    public readonly reason: LedgerFailure,
    message: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

const entrySchema = z.strictObject({
  code: z.string().regex(PARTICIPANT_CODE_PATTERN),
  reason: z.enum(ERASURE_REASONS),
  erasedAt: z.iso.datetime(),
});
export type LedgerEntry = z.infer<typeof entrySchema>;

const ledgerSchema = z.strictObject({
  format: z.literal(LEDGER_FORMAT),
  version: z.literal(LEDGER_VERSION),
  exportedAt: z.iso.datetime(),
  /** Where the entries came from: "live-database", "backup:<name>" or "merged". */
  source: z.string().min(1).max(200),
  count: z.number().int().min(0),
  entries: z.array(entrySchema),
  entriesSha256: z.string().regex(/^[0-9a-f]{64}$/),
  hmacSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ErasureLedger = z.infer<typeof ledgerSchema>;

function canonicalEntries(entries: readonly LedgerEntry[]) {
  return [...entries]
    .map((e) => ({ code: e.code.toUpperCase(), reason: e.reason, erasedAt: e.erasedAt }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

function entriesHash(entries: readonly LedgerEntry[]) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalEntries(entries)))
    .digest("hex");
}

function signature(
  key: string,
  l: Pick<ErasureLedger, "exportedAt" | "source" | "count" | "entriesSha256">,
) {
  const payload = JSON.stringify([
    LEDGER_FORMAT,
    LEDGER_VERSION,
    l.exportedAt,
    l.source,
    l.count,
    l.entriesSha256,
  ]);
  return createHmac("sha256", key).update(payload).digest("hex");
}

function requireKey(key: string | undefined): string {
  if (!key || key.length < MIN_LEDGER_KEY_LENGTH)
    throw new LedgerError(
      "key",
      `ERASURE_LEDGER_KEY must be set (at least ${MIN_LEDGER_KEY_LENGTH} characters). It is held by the owner, never in the repository.`,
    );
  return key;
}

function assertNoDuplicates(entries: readonly LedgerEntry[]) {
  const seen = new Set<string>();
  for (const e of entries) {
    const code = e.code.toUpperCase();
    if (seen.has(code))
      throw new LedgerError("duplicate", `Code ${code} appears more than once in the ledger.`);
    seen.add(code);
  }
}

/** Builds a signed ledger. Rejects duplicates. */
export function signLedger(
  entries: readonly LedgerEntry[],
  source: string,
  key: string | undefined,
  exportedAt = new Date().toISOString(),
): ErasureLedger {
  const k = requireKey(key);
  assertNoDuplicates(entries);
  const canonical = canonicalEntries(entries);
  const base = {
    format: LEDGER_FORMAT,
    version: LEDGER_VERSION,
    exportedAt,
    source,
    count: canonical.length,
    entries: canonical,
    entriesSha256: entriesHash(canonical),
  } as const;
  return { ...base, hmacSha256: signature(k, base) };
}

/** Parses text or an object and verifies structure, completeness, checksum and signature. */
export function verifyLedger(raw: unknown, key: string | undefined): ErasureLedger {
  const k = requireKey(key);
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new LedgerError("corrupted", "The ledger is not valid JSON (corrupted or truncated).");
    }
  }
  const parsed = ledgerSchema.safeParse(value);
  if (!parsed.success)
    throw new LedgerError(
      "corrupted",
      `The ledger doesn't have the expected structure: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
        .join("; ")}`,
    );
  const l = parsed.data;
  if (l.entries.length !== l.count)
    throw new LedgerError(
      "incomplete",
      `The ledger declares ${l.count} entries but holds ${l.entries.length}.`,
    );
  assertNoDuplicates(l.entries);
  if (entriesHash(l.entries) !== l.entriesSha256)
    throw new LedgerError("checksum", "The ledger's entries don't match its checksum.");
  const expected = Buffer.from(signature(k, l), "hex");
  const actual = Buffer.from(l.hmacSha256, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new LedgerError(
      "signature",
      "The ledger's signature doesn't match: it was changed, or signed with another key.",
    );
  return { ...l, entries: canonicalEntries(l.entries) };
}

/** Union of entries; a code keeps its earliest erasure. Never drops an entry. */
export function mergeEntries(...lists: (readonly LedgerEntry[])[]): LedgerEntry[] {
  const byCode = new Map<string, LedgerEntry>();
  for (const list of lists)
    for (const e of list) {
      const code = e.code.toUpperCase();
      const prev = byCode.get(code);
      if (!prev || e.erasedAt < prev.erasedAt) byCode.set(code, { ...e, code });
    }
  return canonicalEntries([...byCode.values()]);
}

/** Entries for every erased code in a database (its tombstones). Read-only. */
export async function erasedEntries(prisma: PrismaClient): Promise<LedgerEntry[]> {
  const rows = await prisma.pilotParticipant.findMany({
    where: { status: { not: "ACTIVE" } },
    select: { code: true, status: true, erasedAt: true, updatedAt: true },
  });
  return canonicalEntries(
    rows.map((r) => ({
      code: r.code,
      reason: r.status === "WITHDRAWN" ? ("WITHDRAWAL" as const) : ("RETENTION_ENDED" as const),
      erasedAt: (r.erasedAt ?? r.updatedAt).toISOString(),
    })),
  );
}

/**
 * Entries from a backup's `PilotParticipant` rows (for rebuilding a lost ledger). Takes the
 * rows already read from the file.
 */
export function entriesFromBackupRows(
  rows: readonly { code: string; status: string; erasedAt: string | null; updatedAt: string }[],
): LedgerEntry[] {
  return canonicalEntries(
    rows
      .filter((r) => r.status !== "ACTIVE")
      .map((r) => ({
        code: r.code,
        reason: r.status === "WITHDRAWN" ? ("WITHDRAWAL" as const) : ("RETENTION_ENDED" as const),
        erasedAt: new Date(r.erasedAt ?? r.updatedAt).toISOString(),
      })),
  );
}

/** Pending restore gates (readiness is 503 while any exist). */
export async function pendingRestoreGates(prisma: Pick<PrismaClient, "erasureLedgerGate">) {
  return prisma.erasureLedgerGate.count({
    where: { ledgerAppliedAt: null, clearedWithoutLedger: false },
  });
}

/**
 * Verifies, then re-applies a ledger in ONE transaction, and clears every pending restore
 * gate. Idempotent: codes already erased with nothing left change nothing and write no
 * per-code audit entry; one summary audit entry is always written.
 */
export async function applyLedger(prisma: PrismaClient, raw: unknown, key: string | undefined) {
  const ledger = verifyLedger(raw, key);
  return prisma.$transaction(
    async (tx) => {
      const changed = [];
      let samplesDeleted = 0;
      for (const entry of ledger.entries) {
        const r = await eraseInTransaction(tx, {
          code: entry.code,
          reason: entry.reason,
          actorId: null,
          requireExisting: false,
          action: "handwriting.participant.erase-reapply",
          auditOnlyIfChanged: true,
        });
        samplesDeleted += r.samplesDeleted;
        if (r.changed) changed.push(entry.code);
      }
      const gates = await tx.erasureLedgerGate.updateMany({
        where: { ledgerAppliedAt: null, clearedWithoutLedger: false },
        data: {
          ledgerAppliedAt: new Date(),
          ledgerSha256: ledger.entriesSha256,
          ledgerEntries: ledger.count,
        },
      });
      const summary = {
        entries: ledger.count,
        codesChanged: changed.length,
        samplesDeleted,
        gatesCleared: gates.count,
        ledgerSha256: ledger.entriesSha256,
      };
      await recordAudit(tx, {
        actorId: null,
        action: "handwriting.erasure-ledger.apply",
        entityType: "System",
        after: summary,
      });
      return summary;
    },
    { timeout: 120_000 },
  );
}

/**
 * Recovery only (no ledger can be found or rebuilt): clears pending gates with a recorded
 * reason. Audited. Erased samples in the restored data may remain; the caller is told so.
 */
export async function clearGatesWithoutLedger(prisma: PrismaClient, reason: string) {
  const text = reason.trim();
  if (text.length < 20) throw new Error("Give a reason of at least 20 characters for the record.");
  return prisma.$transaction(async (tx) => {
    const gates = await tx.erasureLedgerGate.updateMany({
      where: { ledgerAppliedAt: null, clearedWithoutLedger: false },
      data: { clearedWithoutLedger: true, clearanceReason: text.slice(0, 500) },
    });
    await recordAudit(tx, {
      actorId: null,
      action: "handwriting.erasure-ledger.cleared-without-ledger",
      entityType: "System",
      after: { gatesCleared: gates.count, reason: text.slice(0, 500) },
    });
    return gates.count;
  });
}
