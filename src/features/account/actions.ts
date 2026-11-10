"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/database/prisma";
import { signOut } from "@/lib/auth/auth";
import { assertPermission, AuthorizationError, getCurrentUser } from "@/lib/auth/session";
import {
  accountDeletionLimiter,
  adminMutationLimiter,
  learningWriteLimiter,
  passwordChangeLimiter,
} from "@/lib/security/rate-limit";
import { getRequestInfo } from "@/lib/security/request-info";
import { DomainError } from "@/features/administration/services";
import type { FormState } from "@/features/administration/curriculum-actions";
import {
  acceptTerms,
  changePassword,
  deleteAccount,
  setUserStatus,
  updateProfile,
} from "./account";

function fields(formData: FormData) {
  return Object.fromEntries(
    [...formData.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("$")),
  ) as Record<string, string>;
}

function failure(error: unknown): FormState {
  if (error instanceof AuthorizationError)
    return { ok: false, message: "Please sign in again to do that." };
  if (error instanceof z.ZodError)
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: z.flattenError(error).fieldErrors as Record<string, string[]>,
    };
  if (error instanceof DomainError) return { ok: false, message: error.message };
  throw error;
}

async function signedIn() {
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError(401);
  return user;
}

export async function updateProfileAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await signedIn();
    if (!(await learningWriteLimiter.consume(user.id)).allowed)
      return { ok: false, message: "Too many changes. Try again in a minute." };
    const meta = await getRequestInfo();
    await updateProfile(prisma, user.id, fields(formData), meta);
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function changePasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await signedIn();
    if (!(await passwordChangeLimiter.consume(user.id)).allowed)
      return { ok: false, message: "Too many attempts. Try again in an hour." };
    const meta = await getRequestInfo();
    await changePassword(prisma, user.id, fields(formData), meta);
  } catch (error) {
    return failure(error);
  }
  // Every session, including this one, is now invalid: sign in again with the new password.
  await signOut({ redirectTo: "/login?changed=1" });
  return { ok: true };
}

export async function deleteAccountAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await signedIn();
    const meta = await getRequestInfo();
    if (!(await accountDeletionLimiter.consume(meta.ip)).allowed)
      return { ok: false, message: "Too many attempts. Try again later." };
    await deleteAccount(prisma, user.id, fields(formData), meta);
  } catch (error) {
    return failure(error);
  }
  await signOut({ redirectTo: "/?deleted=1" });
  return { ok: true };
}

const statusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  reason: z.string().trim().min(3, "Give a short reason").max(300),
});

export async function setUserStatusAction(
  userId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await assertPermission("users:moderate");
    if (!(await adminMutationLimiter.consume(actor.id)).allowed)
      return { ok: false, message: "Too many changes. Slow down." };
    const { status, reason } = statusSchema.parse(fields(formData));
    const meta = await getRequestInfo();
    const r = await setUserStatus(
      prisma,
      { id: actor.id, roles: actor.roles, ...meta },
      userId,
      status,
      reason,
    );
    revalidatePath(`/admin/users/${userId}`);
    return {
      ok: true,
      message: r.changed
        ? status === "SUSPENDED"
          ? "Account suspended."
          : "Account reactivated."
        : "No change.",
    };
  } catch (error) {
    if (error instanceof AuthorizationError)
      return { ok: false, message: "You do not have permission to do that." };
    return failure(error);
  }
}

/** Records that the signed-in learner accepted the current beta terms and privacy notice. */
export async function acceptTermsAction(): Promise<FormState> {
  try {
    const user = await signedIn();
    if (!(await learningWriteLimiter.consume(user.id)).allowed)
      return { ok: false, message: "Too many attempts. Try again in a minute." };
    const meta = await getRequestInfo();
    await acceptTerms(prisma, user.id, meta);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
