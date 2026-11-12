/**
 * Pilot participants, consent and erasure (M12, docs/M12_PILOT_PROTOCOL.md sections 4 and 8).
 *
 * - A participant is only a pseudonymous code. No names, contacts or demographics are stored.
 * - Samples can be recorded only for an ACTIVE code holding an unrevoked acceptance of the
 *   current consent version (`requireRecordingConsent`, checked inside the recording
 *   transaction under a row lock, so it can't race an erasure).
 * - Erasure (withdrawal or end of retention) deletes every sample for the code, including
 *   pre-M12 rows matched by code, redacts the sample audit entries, revokes consent and leaves
 *   a tombstone so the code can never collect again. One transaction, one audit entry.
 */
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { DomainError, type Actor } from "@/features/administration/services";
import { consentForm, CURRENT_PILOT_CONSENT_VERSION, currentConsentForm } from "./consent";
import { isTestParticipant } from "./pilot";

type Tx = Prisma.TransactionClient;

export const PARTICIPANT_CODE_PATTERN = /^[A-Za-z0-9-]{1,16}$/;

export const participantCodeSchema = z
  .string()
  .trim()
  .regex(PARTICIPANT_CODE_PATTERN, "Use a short code such as P07 (no names or emails)")
  .transform((c) => c.toUpperCase());

/** Allowed clock skew for a signing time entered by the collector. */
const FUTURE_SKEW_MS = 5 * 60_000;
const MAX_CONSENT_AGE_MS = 366 * 86_400_000;

export const consentInputSchema = z.object({
  participantCode: participantCodeSchema,
  version: z.string().trim().min(1).max(40),
  /** When the participant signed the paper form (ISO date or date-time). */
  acceptedAt: z.coerce.date({ error: "Enter when the form was signed." }),
  witnessed: z.literal(true, "Confirm you have the signed paper form in front of you."),
});

export const ERASURE_REASONS = ["WITHDRAWAL", "RETENTION_ENDED"] as const;
export type ErasureReason = (typeof ERASURE_REASONS)[number];

export const erasureInputSchema = z
  .object({
    participantCode: participantCodeSchema,
    reason: z.enum(ERASURE_REASONS),
    /** The collector types the code again to confirm the irreversible erasure. */
    confirmCode: z
      .string()
      .trim()
      .transform((c) => c.toUpperCase()),
  })
  .refine((v) => v.confirmCode === v.participantCode, {
    path: ["confirmCode"],
    message: "Type the participant code exactly to confirm.",
  });

/** Locks a participant row for the rest of the transaction (recording vs erasure). */
async function lockParticipant(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "PilotParticipant" WHERE id = ${id} FOR UPDATE`;
}

/** Records that a participant code accepted the current written consent form. */
export async function recordConsent(prisma: PrismaClient, actor: Actor, raw: unknown) {
  const input = consentInputSchema.parse(raw);
  const form = consentForm(input.version);
  if (!form) throw new DomainError("not_found", "Unknown consent form version.");
  if (form.version !== CURRENT_PILOT_CONSENT_VERSION)
    throw new DomainError(
      "conflict",
      `Only the current form (${CURRENT_PILOT_CONSENT_VERSION}) can be accepted now.`,
    );
  if (!form.ownerApproved && !isTestParticipant(input.participantCode))
    throw new DomainError(
      "forbidden",
      `Consent form ${form.version} is a draft awaiting owner approval. Only TEST rehearsal codes can be used until it's approved.`,
    );
  const now = Date.now();
  if (input.acceptedAt.getTime() > now + FUTURE_SKEW_MS)
    throw new DomainError("conflict", "The signing time can't be in the future.");
  if (input.acceptedAt.getTime() < now - MAX_CONSENT_AGE_MS)
    throw new DomainError("conflict", "That signing date is over a year old. Ask for a new form.");

  return prisma.$transaction(async (tx) => {
    let participant = await tx.pilotParticipant.findUnique({
      where: { code: input.participantCode },
    });
    if (participant) {
      await lockParticipant(tx, participant.id);
      participant = await tx.pilotParticipant.findUniqueOrThrow({ where: { id: participant.id } });
      if (participant.status !== "ACTIVE")
        throw new DomainError(
          "conflict",
          "This code was withdrawn or closed and can't be reused. Use a new code.",
        );
    } else {
      participant = await tx.pilotParticipant.create({
        data: { code: input.participantCode, createdById: actor.id },
      });
    }
    const existing = await tx.pilotConsent.findUnique({
      where: { participantId_version: { participantId: participant.id, version: form.version } },
    });
    if (existing)
      throw new DomainError("conflict", "Consent for this version is already recorded.");
    const consent = await tx.pilotConsent.create({
      data: {
        participantId: participant.id,
        version: form.version,
        acceptedAt: input.acceptedAt,
        recordedById: actor.id,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "handwriting.consent.record",
      entityType: "PilotConsent",
      entityId: consent.id,
      after: {
        participant: participant.code,
        version: consent.version,
        acceptedAt: consent.acceptedAt.toISOString(),
      },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    return { participant, consent };
  });
}

/**
 * Inside a recording transaction: locks the participant and returns the consent to attach to
 * the sample, or refuses. Never creates a participant.
 */
export async function requireRecordingConsent(tx: Tx, code: string) {
  const participant = await tx.pilotParticipant.findUnique({ where: { code } });
  if (!participant)
    throw new DomainError(
      "forbidden",
      "No consent is recorded for this code. Record the signed consent form first.",
    );
  await lockParticipant(tx, participant.id);
  const fresh = await tx.pilotParticipant.findUniqueOrThrow({ where: { id: participant.id } });
  if (fresh.status !== "ACTIVE")
    throw new DomainError(
      "forbidden",
      "This participant has withdrawn (or their data was erased). No more samples can be recorded.",
    );
  const consent = await tx.pilotConsent.findFirst({
    where: { participantId: fresh.id, version: CURRENT_PILOT_CONSENT_VERSION, revokedAt: null },
  });
  if (!consent)
    throw new DomainError(
      "forbidden",
      `This code has no current consent (${CURRENT_PILOT_CONSENT_VERSION}). Record the signed form first.`,
    );
  const form = currentConsentForm();
  if (!form.ownerApproved && !isTestParticipant(fresh.code))
    throw new DomainError(
      "forbidden",
      `Consent form ${form.version} isn't approved yet; only TEST rehearsal codes can record.`,
    );
  return { participant: fresh, consent };
}

/**
 * Erases one participant's handwriting data and blocks the code. Irreversible.
 * Returns the counts, which are also written to the audit log (no sample content).
 */
export async function eraseParticipant(prisma: PrismaClient, actor: Actor, raw: unknown) {
  const input = erasureInputSchema.parse(raw);
  const code = input.participantCode;
  return prisma.$transaction(async (tx) => {
    let participant = await tx.pilotParticipant.findUnique({ where: { code } });
    if (participant) {
      await lockParticipant(tx, participant.id);
    } else {
      // Samples recorded before M12 have no participant row. Erase them by code and leave a
      // tombstone so the code is blocked like any other.
      const legacy = await tx.handwritingSample.count({ where: { participantCode: code } });
      if (!legacy) throw new DomainError("not_found", "No participant or samples with that code.");
      participant = await tx.pilotParticipant.create({
        data: { code, createdById: actor.id },
      });
    }
    const where = { OR: [{ participantId: participant.id }, { participantCode: code }] };
    const ids = (await tx.handwritingSample.findMany({ where, select: { id: true } })).map(
      (s) => s.id,
    );
    const redacted = ids.length
      ? await tx.auditLog.updateMany({
          where: { entityType: "HandwritingSample", entityId: { in: ids } },
          data: { before: Prisma.DbNull, after: { redacted: "participant-erasure" } },
        })
      : { count: 0 };
    const deleted = await tx.handwritingSample.deleteMany({ where });
    const revoked = await tx.pilotConsent.updateMany({
      where: { participantId: participant.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const wasActive = participant.status === "ACTIVE";
    await tx.pilotParticipant.update({
      where: { id: participant.id },
      data: {
        status: wasActive
          ? input.reason === "WITHDRAWAL"
            ? "WITHDRAWN"
            : "RETENTION_ENDED"
          : participant.status,
        erasedAt: new Date(),
      },
    });
    const counts = {
      samplesDeleted: deleted.count,
      auditEntriesRedacted: redacted.count,
      consentsRevoked: revoked.count,
    };
    await recordAudit(tx, {
      actorId: actor.id,
      action: "handwriting.participant.erase",
      entityType: "PilotParticipant",
      entityId: participant.id,
      after: { participant: code, reason: input.reason, ...counts },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    return { code, reason: input.reason, ...counts };
  });
}

/** Lab overview: every participant code with its status, consent and sample count. */
export async function participantOverview(prisma: PrismaClient) {
  const rows = await prisma.pilotParticipant.findMany({
    orderBy: { code: "asc" },
    select: {
      code: true,
      status: true,
      erasedAt: true,
      consents: {
        orderBy: { acceptedAt: "desc" },
        select: { version: true, acceptedAt: true, revokedAt: true },
      },
      _count: { select: { samples: true } },
    },
  });
  return rows.map((r) => {
    const current = r.consents.find(
      (c) => c.version === CURRENT_PILOT_CONSENT_VERSION && !c.revokedAt,
    );
    return {
      code: r.code,
      status: r.status,
      erasedAt: r.erasedAt,
      test: isTestParticipant(r.code),
      currentConsentAt: current?.acceptedAt ?? null,
      canRecord:
        r.status === "ACTIVE" &&
        Boolean(current) &&
        (currentConsentForm().ownerApproved || isTestParticipant(r.code)),
      samples: r._count.samples,
    };
  });
}
