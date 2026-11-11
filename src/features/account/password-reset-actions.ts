"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/database/prisma";
import { assertPermission, AuthorizationError } from "@/lib/auth/session";
import { adminMutationLimiter, passwordResetLimiter } from "@/lib/security/rate-limit";
import { getRequestInfo } from "@/lib/security/request-info";
import { DomainError } from "@/features/administration/services";
import { issuePasswordReset, resetPassword } from "./password-reset";

export interface ResetLinkState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Shown once: the plain link. Only its hash is stored. */
  link?: string;
}

function fail(error: unknown): ResetLinkState {
  if (error instanceof AuthorizationError)
    return { ok: false, message: "You do not have permission to do that." };
  if (error instanceof z.ZodError)
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: z.flattenError(error).fieldErrors as Record<string, string[]>,
    };
  if (error instanceof DomainError) return { ok: false, message: error.message };
  throw error;
}

/** Staff: creates a single-use reset link for a learner (D-045). */
export async function issuePasswordResetAction(
  userId: string,
  _: ResetLinkState,
  formData: FormData,
): Promise<ResetLinkState> {
  try {
    const actor = await assertPermission("users:moderate");
    if (!(await adminMutationLimiter.consume(actor.id)).allowed)
      return { ok: false, message: "Too many changes. Slow down." };
    const meta = await getRequestInfo();
    const { token } = await issuePasswordReset(
      prisma,
      { id: actor.id, roles: actor.roles, ...meta },
      userId,
      { reason: formData.get("reason") },
    );
    revalidatePath(`/admin/users/${userId}`);
    const origin = process.env.AUTH_URL?.replace(/\/$/, "") ?? "";
    return {
      ok: true,
      link: `${origin}/reset-password?token=${token}`,
      message: "Reset link created. Copy it now: it is not shown again.",
    };
  } catch (error) {
    return fail(error);
  }
}

/** Public: sets a new password with a reset link. */
export async function resetPasswordAction(
  token: string,
  _: ResetLinkState,
  formData: FormData,
): Promise<ResetLinkState> {
  try {
    const meta = await getRequestInfo();
    if (!(await passwordResetLimiter.consume(meta.ip)).allowed)
      return { ok: false, message: "Too many attempts. Try again in an hour." };
    await resetPassword(
      prisma,
      token,
      {
        newPassword: formData.get("newPassword"),
        confirmPassword: formData.get("confirmPassword"),
      },
      meta,
    );
    return { ok: true, message: "Password changed." };
  } catch (error) {
    return fail(error);
  }
}
