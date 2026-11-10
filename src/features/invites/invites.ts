/**
 * Invite-only beta registration (M9, D-041).
 *
 * - REGISTRATION_MODE=invite (the default in production) requires a valid invite code to sign
 *   up; "open" lets anyone register (the default in development and test).
 * - Only a SHA-256 hash of each code is stored. The code is shown once, when it is created.
 * - Redemption is atomic: a guarded UPDATE inside the registration transaction, so a code can't
 *   be used more often than allowed even under concurrent sign-ups, and a failed sign-up (for
 *   example an email already in use) doesn't consume it.
 */
import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { DomainError, type Actor } from "@/features/administration/services";

export type RegistrationMode = "open" | "invite";

export function registrationMode(
  env: Record<string, string | undefined> = process.env,
): RegistrationMode {
  const mode = env.REGISTRATION_MODE?.trim().toLowerCase();
  if (mode === "open" || mode === "invite") return mode;
  return env.NODE_ENV === "production" ? "invite" : "open";
}

/** Crockford base32 without look-alikes (no I, L, O, U). */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function normaliseCode(code: string) {
  return code
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/^HQ/, "");
}

export function hashCode(code: string) {
  return createHash("sha256")
    .update(`hanziquest-invite:${normaliseCode(code)}`)
    .digest("hex");
}

/** HQ-XXXXX-XXXXX: 50 bits of randomness from a cryptographic source. */
export function generateCode() {
  const chars = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return `HQ-${chars.slice(0, 5).join("")}-${chars.slice(5).join("")}`;
}

export const inviteInput = z.object({
  label: z.string().trim().min(2, "Say who or what it is for").max(80),
  maxUses: z.coerce.number().int().min(1).max(500).default(1),
  expiresInDays: z.coerce.number().int().min(1).max(180).default(30),
});

export async function createInvite(
  prisma: PrismaClient,
  actor: Actor,
  raw: unknown,
  now: Date = new Date(),
) {
  const input = inviteInput.parse(raw);
  const code = generateCode();
  const invite = await prisma.$transaction(async (tx) => {
    const created = await tx.betaInvite.create({
      data: {
        codeHash: hashCode(code),
        label: input.label,
        maxUses: input.maxUses,
        expiresAt: new Date(now.getTime() + input.expiresInDays * 86_400_000),
        createdById: actor.id,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "invite.create",
      entityType: "BetaInvite",
      entityId: created.id,
      after: {
        label: input.label,
        maxUses: input.maxUses,
        expiresAt: created.expiresAt?.toISOString() ?? null,
      },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    return created;
  });
  return { invite, code };
}

export async function revokeInvite(prisma: PrismaClient, actor: Actor, id: string) {
  return prisma.$transaction(async (tx) => {
    const invite = await tx.betaInvite.findUnique({ where: { id } });
    if (!invite) throw new DomainError("not_found", "Invite not found.");
    if (invite.revokedAt) return invite;
    const updated = await tx.betaInvite.update({ where: { id }, data: { revokedAt: new Date() } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "invite.revoke",
      entityType: "BetaInvite",
      entityId: id,
      before: { uses: invite.uses },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    return updated;
  });
}

/**
 * Consumes one use of a code inside the caller's transaction. Returns the invite id, or null
 * when the code is unknown, revoked, expired or used up.
 */
export async function redeemInvite(
  tx: Prisma.TransactionClient,
  code: string,
  now: Date = new Date(),
): Promise<string | null> {
  if (normaliseCode(code).length !== 10) return null;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "BetaInvite" SET "uses" = "uses" + 1
    WHERE "codeHash" = ${hashCode(code)}
      AND "revokedAt" IS NULL
      AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
      AND "uses" < "maxUses"
    RETURNING "id"`;
  return rows[0]?.id ?? null;
}

export function inviteStatus(
  invite: { uses: number; maxUses: number; expiresAt: Date | null; revokedAt: Date | null },
  now: Date = new Date(),
) {
  if (invite.revokedAt) return "revoked" as const;
  if (invite.expiresAt && invite.expiresAt <= now) return "expired" as const;
  if (invite.uses >= invite.maxUses) return "used up" as const;
  return "active" as const;
}
