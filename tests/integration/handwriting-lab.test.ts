/**
 * M12 handwriting lab: versioned consent, withdrawal enforcement, participant erasure, audit
 * and privacy. Uses TEST participant codes only (CLAUDE.md): the current consent form is a
 * draft, so real codes are refused, which is itself tested here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { DomainError, type Actor } from "@/features/administration/services";
import { loadStrokeData } from "@/features/curriculum/stroke-data";
import { CURRENT_PILOT_CONSENT_VERSION, currentConsentForm } from "@/features/handwriting/consent";
import {
  applyErasureLedger,
  eraseParticipant,
  exportErasureLedger,
  participantOverview,
  recordConsent,
} from "@/features/handwriting/participants";
import { analyseSamples, recordSample } from "@/features/handwriting/samples";
import { hasPermission } from "@/lib/permissions/permissions";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const RUN = `${Date.now() % 1_000_000}`;
const HANZI = "人";
let collector: Actor;
let otherCollector: Actor;

/** A unique TEST code per case (max 16 characters). */
let n = 0;
const code = () => `TEST${RUN}${(n++).toString(36)}`.slice(0, 16).toUpperCase();

function ink() {
  const data = loadStrokeData(HANZI)!;
  return data.medians.map((m) => ({
    points: m.map(([x, y], i) => ({ x: x! / 1024, y: (900 - y!) / 1024, t: i * 10 })),
  }));
}

function sample(participantCode: string, extra: Record<string, unknown> = {}) {
  return {
    participantCode,
    hanzi: HANZI,
    category: "CORRECT",
    style: "normal",
    inputDevice: "mouse",
    strokes: ink(),
    consentConfirmed: true,
    ...extra,
  };
}

const today = () => new Date().toISOString().slice(0, 10);
const consent = (participantCode: string, extra: Record<string, unknown> = {}) => ({
  participantCode,
  version: CURRENT_PILOT_CONSENT_VERSION,
  acceptedAt: today(),
  witnessed: true,
  ...extra,
});

async function newActor(prefix: string): Promise<Actor> {
  const result = await registerUser(prisma, {
    displayName: prefix,
    email: uniqueEmail(prefix),
    password: "password-1234",
  });
  if (!result.ok) throw new Error("setup failed");
  return { id: result.userId, roles: ["CURRICULUM_EDITOR"] };
}

async function domainCode(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return "resolved";
}

beforeAll(async () => {
  await ensureRoles(prisma);
  // The lab needs one character with real reference strokes.
  const existing = await prisma.character.findUnique({ where: { hanzi: HANZI } });
  if (!existing?.hasStrokeData) {
    const data = loadStrokeData(HANZI)!;
    const ch = await prisma.character.upsert({
      where: { hanzi: HANZI },
      create: {
        hanzi: HANZI,
        pinyin: "rén",
        meaning: "person",
        source: "integration test",
        hasStrokeData: true,
        strokeCount: data.medians.length,
      },
      update: { hasStrokeData: true, strokeCount: data.medians.length },
    });
    await prisma.characterStroke.deleteMany({ where: { characterId: ch.id } });
    await prisma.characterStroke.createMany({
      data: data.medians.map((m, i) => ({
        characterId: ch.id,
        strokeIndex: i,
        path: data.strokes[i]!,
        median: m,
      })),
    });
  }
  collector = await newActor("collector");
  otherCollector = await newActor("collector2");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("versioned consent", () => {
  it("refuses to record a sample without recorded consent", async () => {
    const c = code();
    expect(await domainCode(recordSample(prisma, collector, sample(c)))).toBe("forbidden");
    expect(await prisma.handwritingSample.count({ where: { participantCode: c } })).toBe(0);
    // Refusing doesn't create a participant either.
    expect(await prisma.pilotParticipant.count({ where: { code: c } })).toBe(0);
  });

  it("records consent with version and signing time, audited, then allows recording", async () => {
    const c = code();
    const signed = new Date(Date.now() - 3_600_000);
    const { consent: row, participant } = await recordConsent(
      prisma,
      collector,
      consent(c, { acceptedAt: signed.toISOString() }),
    );
    expect(row.version).toBe(CURRENT_PILOT_CONSENT_VERSION);
    expect(row.acceptedAt.getTime()).toBe(signed.getTime());
    expect(row.recordedById).toBe(collector.id);
    expect(participant.status).toBe("ACTIVE");
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "handwriting.consent.record", entityId: row.id },
    });
    expect(audit.actorId).toBe(collector.id);

    const r = await recordSample(prisma, collector, sample(c));
    const stored = await prisma.handwritingSample.findUniqueOrThrow({ where: { id: r.sampleId } });
    expect(stored.consentId).toBe(row.id);
    expect(stored.participantId).toBe(participant.id);
    expect(stored.participantCode).toBe(c);
  });

  it("normalises the code to upper case for consent and recording", async () => {
    const c = code();
    await recordConsent(prisma, collector, consent(c.toLowerCase()));
    const r = await recordSample(prisma, collector, sample(c.toLowerCase()));
    const stored = await prisma.handwritingSample.findUniqueOrThrow({ where: { id: r.sampleId } });
    expect(stored.participantCode).toBe(c);
  });

  it("rejects a missing witness confirmation, unknown or old versions, and bad dates", async () => {
    const c = code();
    await expect(
      recordConsent(prisma, collector, consent(c, { witnessed: false })),
    ).rejects.toThrow();
    expect(
      await domainCode(recordConsent(prisma, collector, consent(c, { version: "pilot-v9" }))),
    ).toBe("not_found");
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      await domainCode(recordConsent(prisma, collector, consent(c, { acceptedAt: future }))),
    ).toBe("conflict");
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
    expect(
      await domainCode(recordConsent(prisma, collector, consent(c, { acceptedAt: old }))),
    ).toBe("conflict");
    await expect(
      recordConsent(prisma, collector, consent(c, { acceptedAt: "not a date" })),
    ).rejects.toThrow();
    expect(await prisma.pilotParticipant.count({ where: { code: c } })).toBe(0);
  });

  it("refuses a second acceptance of the same version", async () => {
    const c = code();
    await recordConsent(prisma, collector, consent(c));
    expect(await domainCode(recordConsent(prisma, collector, consent(c)))).toBe("conflict");
  });

  it("refuses real (non-TEST) codes while the consent form is an unapproved draft", async () => {
    expect(currentConsentForm().ownerApproved).toBe(false);
    expect(await domainCode(recordConsent(prisma, collector, consent("P01")))).toBe("forbidden");
    expect(await domainCode(recordSample(prisma, collector, sample("P01")))).toBe("forbidden");
  });

  it("refuses codes that could hold a name or an email address", async () => {
    for (const bad of ["Jane Doe", "jane@example.com", "P01 (Jane)", "", "A".repeat(17)])
      await expect(recordConsent(prisma, collector, consent(bad))).rejects.toThrow();
  });
});

describe("structured observations replace free-text notes", () => {
  it("stores fixed observations", async () => {
    const c = code();
    await recordConsent(prisma, collector, consent(c));
    const r = await recordSample(
      prisma,
      collector,
      sample(c, { observations: ["HESITATED", "USED_UNDO"] }),
    );
    const stored = await prisma.handwritingSample.findUniqueOrThrow({ where: { id: r.sampleId } });
    expect(stored.observations).toEqual(["HESITATED", "USED_UNDO"]);
    expect(stored.notes).toBeNull();
  });

  it("rejects free-text notes, free-text styles, unknown keys and unknown observations", async () => {
    const c = code();
    await recordConsent(prisma, collector, consent(c));
    for (const extra of [
      { notes: "Jane was tired" },
      { style: "left-handed Jane" },
      { observations: ["Jane hesitated"] },
      { observations: ["HESITATED", "HESITATED"] },
      { comment: "free text under another key" },
    ])
      await expect(recordSample(prisma, collector, sample(c, extra))).rejects.toThrow();
    expect(await prisma.handwritingSample.count({ where: { participantCode: c } })).toBe(0);
  });
});

describe("participant erasure and withdrawal enforcement", () => {
  async function participantWithSamples(count: number, actor = collector) {
    const c = code();
    await recordConsent(prisma, actor, consent(c));
    const ids: string[] = [];
    for (let i = 0; i < count; i++)
      ids.push((await recordSample(prisma, actor, sample(c))).sampleId);
    return { c, ids };
  }

  it("deletes every sample for the code, redacts their audit entries and revokes consent", async () => {
    const { c, ids } = await participantWithSamples(3);
    const bystander = await participantWithSamples(2, otherCollector);

    const result = await eraseParticipant(prisma, collector, {
      participantCode: c,
      reason: "WITHDRAWAL",
      confirmCode: c,
    });
    expect(result).toMatchObject({
      samplesDeleted: 3,
      auditEntriesRedacted: 3,
      consentsRevoked: 1,
    });

    expect(await prisma.handwritingSample.count({ where: { id: { in: ids } } })).toBe(0);
    expect(await prisma.handwritingSample.count({ where: { participantCode: c } })).toBe(0);
    // Sample audit entries keep the fact of the action but lose the content.
    const entries = await prisma.auditLog.findMany({
      where: { entityType: "HandwritingSample", entityId: { in: ids } },
    });
    expect(entries).toHaveLength(3);
    for (const e of entries) {
      expect(e.after).toEqual({ redacted: "participant-erasure" });
      expect(JSON.stringify(e)).not.toContain(c);
    }
    const participant = await prisma.pilotParticipant.findUniqueOrThrow({
      where: { code: c },
      include: { consents: true },
    });
    expect(participant.status).toBe("WITHDRAWN");
    expect(participant.erasedAt).not.toBeNull();
    expect(participant.consents.every((k) => k.revokedAt !== null)).toBe(true);

    // The erasure itself is audited with counts only.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "handwriting.participant.erase", entityId: participant.id },
    });
    expect(audit.after).toMatchObject({ reason: "WITHDRAWAL", samplesDeleted: 3 });

    // Other participants are untouched.
    expect(await prisma.handwritingSample.count({ where: { id: { in: bystander.ids } } })).toBe(2);
    const bystanderAudit = await prisma.auditLog.findMany({
      where: { entityType: "HandwritingSample", entityId: { in: bystander.ids } },
    });
    expect(bystanderAudit.every((e) => JSON.stringify(e.after).includes(bystander.c))).toBe(true);
  });

  it("blocks further recording and re-consent after withdrawal", async () => {
    const { c } = await participantWithSamples(1);
    await eraseParticipant(prisma, collector, {
      participantCode: c,
      reason: "WITHDRAWAL",
      confirmCode: c,
    });
    expect(await domainCode(recordSample(prisma, collector, sample(c)))).toBe("forbidden");
    expect(await domainCode(recordConsent(prisma, collector, consent(c)))).toBe("conflict");
    expect(await prisma.handwritingSample.count({ where: { participantCode: c } })).toBe(0);
    const row = (await participantOverview(prisma)).find((p) => p.code === c)!;
    expect(row).toMatchObject({ status: "WITHDRAWN", canRecord: false, samples: 0 });
  });

  it("erases pre-M12 samples that have no participant row, and blocks the code", async () => {
    const c = code();
    const character = await prisma.character.findUniqueOrThrow({ where: { hanzi: HANZI } });
    const legacy = await prisma.handwritingSample.create({
      data: {
        participantCode: c,
        characterId: character.id,
        category: "CORRECT",
        shouldAccept: true,
        strokes: ink(),
        engineVersion: "hq-eval-1",
        band: "GOOD",
        score: 80,
        identityVerified: true,
        notes: "legacy free text",
        consentConfirmed: true,
      },
    });
    const r = await eraseParticipant(prisma, collector, {
      participantCode: c,
      reason: "RETENTION_ENDED",
      confirmCode: c,
    });
    expect(r.samplesDeleted).toBe(1);
    expect(await prisma.handwritingSample.findUnique({ where: { id: legacy.id } })).toBeNull();
    const tomb = await prisma.pilotParticipant.findUniqueOrThrow({ where: { code: c } });
    expect(tomb.status).toBe("RETENTION_ENDED");
    expect(await domainCode(recordConsent(prisma, collector, consent(c)))).toBe("conflict");
  });

  it("requires the typed confirmation and an existing code", async () => {
    const { c } = await participantWithSamples(1);
    await expect(
      eraseParticipant(prisma, collector, {
        participantCode: c,
        reason: "WITHDRAWAL",
        confirmCode: "WRONG",
      }),
    ).rejects.toThrow();
    await expect(
      eraseParticipant(prisma, collector, { participantCode: c, reason: "OOPS", confirmCode: c }),
    ).rejects.toThrow();
    expect(await prisma.handwritingSample.count({ where: { participantCode: c } })).toBe(1);
    const missing = code();
    expect(
      await domainCode(
        eraseParticipant(prisma, collector, {
          participantCode: missing,
          reason: "WITHDRAWAL",
          confirmCode: missing,
        }),
      ),
    ).toBe("not_found");
  });

  it("is atomic with recording: a sample racing an erasure is either erased or refused", async () => {
    const { c } = await participantWithSamples(1);
    const results = await Promise.allSettled([
      recordSample(prisma, collector, sample(c)),
      eraseParticipant(prisma, collector, {
        participantCode: c,
        reason: "WITHDRAWAL",
        confirmCode: c,
      }),
      recordSample(prisma, collector, sample(c)),
    ]);
    expect(results[1]!.status).toBe("fulfilled");
    expect(await prisma.handwritingSample.count({ where: { participantCode: c } })).toBe(0);
  });

  it("removes erased samples from the analysis", async () => {
    const { c, ids } = await participantWithSamples(1);
    const before = await analyseSamples(prisma, 20_000, { includeTests: true });
    expect(before.samples.some((s) => ids.includes(s.id))).toBe(true);
    await eraseParticipant(prisma, collector, {
      participantCode: c,
      reason: "WITHDRAWAL",
      confirmCode: c,
    });
    const after = await analyseSamples(prisma, 20_000, { includeTests: true });
    expect(after.samples.some((s) => s.participant === c)).toBe(false);
  });
});

describe("privacy review: feedback and restored backups", () => {
  it("reports, but never deletes, feedback that mentions an erased code", async () => {
    const c = code();
    await recordConsent(prisma, collector, consent(c));
    await recordSample(prisma, collector, sample(c));
    const fb = await prisma.feedback.create({
      data: { kind: "HANDWRITING", message: `Pilot note for ${c}: the checker felt strict` },
    });
    const r = await eraseParticipant(prisma, collector, {
      participantCode: c,
      reason: "WITHDRAWAL",
      confirmCode: c,
    });
    expect(r.feedbackToReview).toBe(1);
    // Kept for a person to review: free text can't be erased safely by pattern.
    expect(await prisma.feedback.findUnique({ where: { id: fb.id } })).not.toBeNull();
    await prisma.feedback.delete({ where: { id: fb.id } });
  });

  it("exports a ledger of erased codes and re-applies it to resurrected data", async () => {
    const c = code();
    const { participant, consent: k } = await recordConsent(prisma, collector, consent(c));
    const { sampleId } = await recordSample(prisma, collector, sample(c));
    const snapshot = await prisma.handwritingSample.findUniqueOrThrow({ where: { id: sampleId } });
    await eraseParticipant(prisma, collector, {
      participantCode: c,
      reason: "WITHDRAWAL",
      confirmCode: c,
    });
    const ledger = await exportErasureLedger(prisma);
    const entry = ledger.entries.find((e) => e.code === c);
    expect(entry).toMatchObject({ reason: "WITHDRAWAL" });
    expect(JSON.stringify(ledger)).not.toMatch(/strokes|points/);

    // Simulate restoring a backup taken before the erasure: the old rows come back.
    await prisma.pilotParticipant.update({
      where: { id: participant.id },
      data: { status: "ACTIVE", erasedAt: null },
    });
    await prisma.pilotConsent.update({ where: { id: k.id }, data: { revokedAt: null } });
    await prisma.handwritingSample.create({
      data: {
        ...snapshot,
        strokes: snapshot.strokes as object,
        deviceInfo: snapshot.deviceInfo ?? undefined,
      },
    });
    expect(await prisma.handwritingSample.count({ where: { participantCode: c } })).toBe(1);

    const results = await applyErasureLedger(prisma, { ...ledger, entries: [entry] });
    expect(results[0]!.samplesDeleted).toBe(1);
    expect(await prisma.handwritingSample.count({ where: { participantCode: c } })).toBe(0);
    expect(await domainCode(recordSample(prisma, collector, sample(c)))).toBe("forbidden");
    const reapply = await prisma.auditLog.findFirst({
      where: { action: "handwriting.participant.erase-reapply", entityId: participant.id },
    });
    expect(reapply?.actorId).toBeNull();
  });

  it("re-applying blocks a code the restored database has never seen", async () => {
    const c = code();
    await applyErasureLedger(prisma, {
      format: "hanziquest-erasure-ledger",
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: [{ code: c, reason: "RETENTION_ENDED", erasedAt: new Date().toISOString() }],
    });
    const row = await prisma.pilotParticipant.findUniqueOrThrow({ where: { code: c } });
    expect(row.status).toBe("RETENTION_ENDED");
    expect(await domainCode(recordConsent(prisma, collector, consent(c)))).toBe("conflict");
  });

  it("rejects a malformed ledger without erasing anything", async () => {
    await expect(applyErasureLedger(prisma, { entries: [{ code: "P01" }] })).rejects.toThrow();
    await expect(
      applyErasureLedger(prisma, {
        format: "hanziquest-erasure-ledger",
        version: 1,
        exportedAt: new Date().toISOString(),
        entries: [
          { code: "jane@example.com", reason: "WITHDRAWAL", erasedAt: new Date().toISOString() },
        ],
      }),
    ).rejects.toThrow();
  });
});

describe("authorization", () => {
  it("lets only super admins erase; collectors can validate but not erase", () => {
    expect(hasPermission(["SUPER_ADMIN"], "handwriting:erase")).toBe(true);
    for (const role of ["CURRICULUM_EDITOR", "MODERATOR", "ANALYST", "SUPPORT", "LEARNER"] as const)
      expect(hasPermission([role], "handwriting:erase")).toBe(false);
    expect(hasPermission(["CURRICULUM_EDITOR"], "handwriting:validate")).toBe(true);
    for (const role of ["MODERATOR", "ANALYST", "SUPPORT", "LEARNER"] as const)
      expect(hasPermission([role], "handwriting:validate")).toBe(false);
  });
});
