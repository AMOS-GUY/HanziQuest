/**
 * Staff-issued password reset links (integration audit, D-045).
 *
 * There is no email provider yet, so a learner who forgets their password asks the team. A
 * moderator creates a single-use link and gives it to them through the channel the beta
 * already uses. When email is configured, the same tokens can be sent by email instead.
 *
 * - Only a SHA-256 hash of the 256-bit token is stored. The link is shown once.
 * - A link expires after RESET_TTL_HOURS and works once: it is consumed by a guarded UPDATE
 *   inside the reset transaction. Creating a new link discards older unused ones.
 * - Resetting sets `credentialsChangedAt`, which signs out every existing session.
 * - Only a Super Admin can create a link for a staff account, and nobody for their own account
 *   (they use "Change password" instead). Creation and use are both audited.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { passwordSchema } from "@/lib/validation/auth";
import { DomainError, type Actor } from "@/features/administration/services";

export const RESET_TTL_HOURS = 24;

export function hashResetToken(token: string) {
  return createHash("sha256").update(`hanziquest-reset:${token}`).digest("hex");
}

export function generateResetToken() {
  return randomBytes(32).toString("base64url");
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const issueResetSchema = z.object({
  reason: z.string().trim().min(3, "Give a short reason").max(300),
});

export async function issuePasswordReset(
  prisma: PrismaClient,
  actor: Actor,
  userId: string,
  raw: unknown,
  now: Date = new Date(),
) {
  const { reason } = issueResetSchema.parse(raw);
  if (userId === actor.id)
    throw new DomainError("conflict", "Use Change password on your profile for your own account.");
  const token = generateResetToken();
  const expiresAt = new Date(now.getTime() + RESET_TTL_HOURS * 3_600_000);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { status: true, roles: { select: { role: { select: { key: true } } } } },
    });
    if (!user || user.status === "DELETED") throw new DomainError("not_found", "User not found.");
    if (user.status !== "ACTIVE")
      throw new DomainError("conflict", "Reactivate the account before resetting its password.");
    const staff = user.roles.some((r) => r.role.key !== "LEARNER");
    if (staff && !actor.roles.includes("SUPER_ADMIN"))
      throw new DomainError("forbidden", "Only a Super Admin can reset a staff password.");
    // One live link per account.
    const discarded = await tx.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
    const created = await tx.passwordResetToken.create({
      data: { userId, tokenHash: hashResetToken(token), expiresAt, createdById: actor.id },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "user.password.reset_link",
      entityType: "User",
      entityId: userId,
      after: {
        tokenId: created.id,
        expiresAt: expiresAt.toISOString(),
        discardedLinks: discarded.count,
        reason: reason.slice(0, 300),
      },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
  });
  return { token, expiresAt };
}

/** Whether a link can still be used (for the reset page). Never reveals whose it is. */
export async function resetTokenUsable(
  prisma: PrismaClient,
  token: string,
  now: Date = new Date(),
) {
  if (!TOKEN_PATTERN.test(token)) return false;
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: { usedAt: true, expiresAt: true, user: { select: { status: true } } },
  });
  return !!row && !row.usedAt && row.expiresAt > now && row.user.status === "ACTIVE";
}

export const resetPasswordSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z.string().max(128),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "The passwords don't match",
    path: ["confirmPassword"],
  });

const INVALID = "This reset link is not valid any more. Ask the HanziQuest team for a new one.";

/** Sets a new password with a reset link. The link is consumed atomically. */
export async function resetPassword(
  prisma: PrismaClient,
  token: string,
  raw: unknown,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
) {
  const input = resetPasswordSchema.parse(raw);
  if (!TOKEN_PATTERN.test(token)) throw new DomainError("not_found", INVALID);
  const passwordHash = await hashPassword(input.newPassword);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; userId: string }[]>`
      UPDATE "PasswordResetToken" t SET "usedAt" = ${now}
      FROM "User" u
      WHERE t."tokenHash" = ${hashResetToken(token)}
        AND t."usedAt" IS NULL
        AND t."expiresAt" > ${now}
        AND u."id" = t."userId"
        AND u."status" = 'ACTIVE'
      RETURNING t."id", t."userId"`;
    const used = rows[0];
    if (!used) throw new DomainError("not_found", INVALID);
    await tx.user.update({
      where: { id: used.userId },
      data: { passwordHash, credentialsChangedAt: now },
    });
    await tx.passwordResetToken.deleteMany({
      where: { userId: used.userId, usedAt: null },
    });
    await recordAudit(tx, {
      actorId: used.userId,
      action: "user.password.reset",
      entityType: "User",
      entityId: used.userId,
      after: { tokenId: used.id },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    return { userId: used.userId };
  });
}
