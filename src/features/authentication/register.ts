import type { PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { recordAudit } from "@/lib/audit";
import { registerSchema } from "@/lib/validation/auth";
import { LEGAL_VERSION } from "@/features/legal/version";
import { redeemInvite } from "@/features/invites/invites";

export type RegisterResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; error: "invalid"; fieldErrors: Record<string, string[]> }
  | { ok: false; error: "email_taken" }
  | { ok: false; error: "invite_invalid" };

class InviteRejected extends Error {}

/**
 * Creates a learner account: user, profile and LEARNER role, atomically.
 * Business rule lives here (not in the route/action) so it can be tested directly.
 */
export async function registerUser(
  prisma: PrismaClient,
  input: unknown,
  context: { ip?: string | null; userAgent?: string | null; requireInvite?: boolean } = {},
): Promise<RegisterResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, error: "invalid", fieldErrors };
  }
  const { email, password, displayName, acceptTerms, inviteCode } = parsed.data;
  if (context.requireInvite && !inviteCode) return { ok: false, error: "invite_invalid" };

  const passwordHash = await hashPassword(password);
  try {
    const user = await prisma.$transaction(async (tx) => {
      const learnerRole = await tx.role.findUnique({ where: { key: "LEARNER" } });
      if (!learnerRole) throw new Error("LEARNER role missing — run the database seed");
      // Consumed in the same transaction: a failed sign-up doesn't use up the invite.
      const inviteId = context.requireInvite ? await redeemInvite(tx, inviteCode!) : null;
      if (context.requireInvite && !inviteId) throw new InviteRejected();
      const created = await tx.user.create({
        data: {
          email,
          inviteId,
          name: displayName,
          passwordHash,
          profile: {
            create: {
              displayName,
              ...(acceptTerms ? { termsAcceptedAt: new Date(), termsVersion: LEGAL_VERSION } : {}),
            },
          },
          roles: { create: { roleId: learnerRole.id } },
          streak: { create: {} },
        },
      });
      await recordAudit(tx, {
        actorId: created.id,
        action: "user.register",
        entityType: "User",
        entityId: created.id,
        after: inviteId ? { inviteId } : undefined,
        ipAddress: context.ip,
        userAgent: context.userAgent,
      });
      return created;
    });
    return { ok: true, userId: user.id, email: user.email };
  } catch (error) {
    if (error instanceof InviteRejected) return { ok: false, error: "invite_invalid" };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "email_taken" };
    }
    throw error;
  }
}
