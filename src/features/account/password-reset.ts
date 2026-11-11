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
 * - The policy is checked again when the link is used (security review, D-047): the issuer must
 *   still be an active moderator, and if the account has become staff since, the issuer must be
 *   a Super Admin. Granting a staff role or suspending the account discards unused links.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { RoleKey } from "@/generated/prisma/enums";
import { ROLE_PERMISSIONS } from "@/lib/permissions/permissions";
import { recordAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { passwordSchema } from "@/lib/validation/auth";
import { DomainError, type Actor } from "@/features/administration/services";

export const RESET_TTL_HOURS = 24;

/**
 * Staff reset links are off in production until the owner approves the procedure in
 * SECURITY.md (D-047): PASSWORD_RESET_LINKS=on enables them, "off" disables them anywhere.
 * Development and test default to on.
 */
export function resetLinksEnabled(env: Record<string, string | undefined> = process.env) {
  const value = env.PASSWORD_RESET_LINKS?.trim().toLowerCase();
  if (value === "on" || value === "off") return value === "on";
  return env.NODE_ENV !== "production";
}

const DISABLED = "Password reset links are turned off on this server.";

export function hashResetToken(token: string) {
  return createHash("sha256").update(`hanziquest-reset:${token}`).digest("hex");
}

export function generateResetToken() {
  return randomBytes(32).toString("base64url");
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Roles that may issue reset links: those with `users:moderate`. */
export const RESET_ISSUER_ROLES = (Object.keys(ROLE_PERMISSIONS) as RoleKey[]).filter((role) =>
  ROLE_PERMISSIONS[role].includes("users:moderate"),
);

/**
 * SQL condition (token `t`, account `u`) that a link is usable *now*: unused, unexpired, the
 * account active, the issuer still an active moderator, and a Super Admin if the account holds
 * a staff role today. Shared by the check and the atomic use so they can't drift apart.
 */
function usableNow(tokenHash: string, now: Date) {
  return Prisma.sql`t."tokenHash" = ${tokenHash}
    AND t."usedAt" IS NULL
    AND t."expiresAt" > ${now}
    AND u."id" = t."userId"
    AND u."status" = 'ACTIVE'
    AND EXISTS (
      SELECT 1 FROM "User" i
      JOIN "UserRole" ir ON ir."userId" = i."id"
      JOIN "Role" ri ON ri."id" = ir."roleId"
      WHERE i."id" = t."createdById" AND i."status" = 'ACTIVE'
        AND ri."key"::text IN (${Prisma.join(RESET_ISSUER_ROLES)}))
    AND (
      NOT EXISTS (
        SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r."id" = ur."roleId"
        WHERE ur."userId" = u."id" AND r."key"::text <> 'LEARNER')
      OR EXISTS (
        SELECT 1 FROM "UserRole" sr JOIN "Role" rs ON rs."id" = sr."roleId"
        WHERE sr."userId" = t."createdById" AND rs."key"::text = 'SUPER_ADMIN'))`;
}

/**
 * Discards an account's unused reset links. Called inside the transaction that grants a staff
 * role or suspends the account, so a link never outlives the decision it was issued under.
 */
export async function discardResetLinks(tx: Prisma.TransactionClient, userId: string) {
  const { count } = await tx.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
  return count;
}

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
  if (!resetLinksEnabled()) throw new DomainError("forbidden", DISABLED);
  const { reason } = issueResetSchema.parse(raw);
  if (userId === actor.id)
    throw new DomainError("conflict", "Use Change password on your profile for your own account.");
  const token = generateResetToken();
  const expiresAt = new Date(now.getTime() + RESET_TTL_HOURS * 3_600_000);
  await prisma.$transaction(async (tx) => {
    // Serialise link creation per account, so concurrent requests can't leave two live links.
    await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
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
    const discarded = await discardResetLinks(tx, userId);
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
        discardedLinks: discarded,
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
  if (!resetLinksEnabled() || !TOKEN_PATTERN.test(token)) return false;
  const rows = await prisma.$queryRaw<{ ok: number }[]>`
    SELECT 1 AS ok FROM "PasswordResetToken" t, "User" u
    WHERE ${usableNow(hashResetToken(token), now)}`;
  return rows.length > 0;
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
  if (!resetLinksEnabled()) throw new DomainError("not_found", INVALID);
  if (!TOKEN_PATTERN.test(token)) throw new DomainError("not_found", INVALID);
  const passwordHash = await hashPassword(input.newPassword);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; userId: string }[]>`
      UPDATE "PasswordResetToken" t SET "usedAt" = ${now}
      FROM "User" u
      WHERE ${usableNow(hashResetToken(token), now)}
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
