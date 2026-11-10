"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/database/prisma";
import { assertPermission, AuthorizationError, getCurrentUser } from "@/lib/auth/session";
import { adminMutationLimiter, feedbackLimiter } from "@/lib/security/rate-limit";
import { getRequestInfo } from "@/lib/security/request-info";
import { DomainError } from "@/features/administration/services";
import type { FormState } from "@/features/administration/curriculum-actions";
import { submitFeedback, updateFeedbackStatus } from "./feedback";

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

export async function submitFeedbackAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthorizationError(401);
    if (!(await feedbackLimiter.consume(user.id)).allowed)
      return {
        ok: false,
        message: "You've sent a lot of feedback this hour. Thank you! Try again later.",
      };
    const { userAgent } = await getRequestInfo();
    await submitFeedback(prisma, user.id, fields(formData), { userAgent });
    revalidatePath("/admin/feedback");
    return { ok: true, message: "Thank you! Your feedback was sent to the HanziQuest team." };
  } catch (error) {
    return failure(error);
  }
}

export async function setFeedbackStatusAction(
  id: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await assertPermission("feedback:manage");
    if (!(await adminMutationLimiter.consume(actor.id)).allowed)
      return { ok: false, message: "Too many changes. Slow down." };
    const meta = await getRequestInfo();
    await updateFeedbackStatus(
      prisma,
      { id: actor.id, roles: actor.roles, ...meta },
      id,
      fields(formData),
    );
    revalidatePath("/admin/feedback");
    return { ok: true, message: "Updated." };
  } catch (error) {
    if (error instanceof AuthorizationError)
      return { ok: false, message: "You do not have permission to do that." };
    return failure(error);
  }
}
