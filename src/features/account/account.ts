/** Self-service account management and moderation. Business rules only; callers authorize. */
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { passwordSchema } from "@/lib/validation/auth";
import { DAILY_GOAL_OPTIONS } from "@/features/onboarding/schema";
import { DomainError, type Actor } from "@/features/administration/services";
import { LEGAL_VERSION } from "@/features/legal/version";

function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const profileSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a name").max(60),
  dailyGoalXp: z.coerce
    .number()
    .int()
    .refine((v) => DAILY_GOAL_OPTIONS.some((o) => o.value === v), "Choose one of the goals"),
  timezone: z.string().trim().max(64).refine(isValidTimeZone, "Unknown time zone"),
});

export async function updateProfile(
  prisma: PrismaClient,
  userId: string,
  raw: unknown,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const input = profileSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const before = await tx.profile.findUnique({ where: { userId } });
    if (!before) throw new DomainError("not_found", "Profile not found.");
    await tx.profile.update({ where: { userId }, data: input });
    await tx.user.update({ where: { id: userId }, data: { name: input.displayName } });
    await recordAudit(tx, {
      actorId: userId,
      action: "profile.update",
      entityType: "User",
      entityId: userId,
      before: {
        displayName: before.displayName,
        dailyGoalXp: before.dailyGoalXp,
        timezone: before.timezone,
      },
      after: input,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  });
}

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string().max(128),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "The new passwords don't match",
    path: ["confirmPassword"],
  });

/** Changes the password and invalidates every existing session, including this one. */
export async function changePassword(
  prisma: PrismaClient,
  userId: string,
  raw: unknown,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const input = changePasswordSchema.parse(raw);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.passwordHash || !(await verifyPassword(input.currentPassword, user.passwordHash)))
    throw new DomainError("forbidden", "Your current password is incorrect.");
  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, credentialsChangedAt: new Date() },
    });
    await recordAudit(tx, {
      actorId: userId,
      action: "user.password.change",
      entityType: "User",
      entityId: userId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  });
}

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Enter your password").max(128),
  confirm: z.literal("DELETE", "Type DELETE to confirm"),
});

/**
 * Permanently deletes the account and its learning data (attempts, progress, XP, devices).
 * Audit entries stay, with the actor cleared. The last Super Admin can't delete themselves.
 */
export async function deleteAccount(
  prisma: PrismaClient,
  userId: string,
  raw: unknown,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const input = deleteAccountSchema.parse(raw);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash)))
    throw new DomainError("forbidden", "Your password is incorrect.");
  await prisma.$transaction(async (tx) => {
    if (user.roles.some((r) => r.role.key === "SUPER_ADMIN")) {
      const supers = await tx.userRole.count({ where: { role: { key: "SUPER_ADMIN" } } });
      if (supers <= 1)
        throw new DomainError(
          "conflict",
          "You are the only Super Admin. Make someone else Super Admin first.",
        );
    }
    await recordAudit(tx, {
      actorId: null,
      action: "user.delete.self",
      entityType: "User",
      entityId: userId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    await tx.user.delete({ where: { id: userId } });
  });
}

/**
 * Suspends or reactivates an account. Suspension takes effect on the user's next request,
 * because status is checked every time. Guards: no self-moderation, and only a Super Admin
 * can moderate an account that holds admin roles.
 */
export async function setUserStatus(
  prisma: PrismaClient,
  actor: Actor,
  userId: string,
  status: "ACTIVE" | "SUSPENDED",
  reason: string,
) {
  if (userId === actor.id) throw new DomainError("conflict", "You can't change your own status.");
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user || user.status === "DELETED") throw new DomainError("not_found", "User not found.");
    const privileged = user.roles.some((r) => r.role.key !== "LEARNER");
    if (privileged && !actor.roles.includes("SUPER_ADMIN"))
      throw new DomainError("forbidden", "Only a Super Admin can suspend staff accounts.");
    if (user.status === status) return { changed: false };
    await tx.user.update({ where: { id: userId }, data: { status } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: status === "SUSPENDED" ? "user.suspend" : "user.reactivate",
      entityType: "User",
      entityId: userId,
      before: { status: user.status },
      after: { status, reason: reason.slice(0, 300) },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    return { changed: true };
  });
}

/** Records acceptance of the current beta terms and privacy notice (audited). */
export async function acceptTerms(
  prisma: PrismaClient,
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  await prisma.$transaction(async (tx) => {
    await tx.profile.update({
      where: { userId },
      data: { termsAcceptedAt: new Date(), termsVersion: LEGAL_VERSION },
    });
    await recordAudit(tx, {
      actorId: userId,
      action: "terms.accept",
      entityType: "User",
      entityId: userId,
      after: { version: LEGAL_VERSION },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  });
}
