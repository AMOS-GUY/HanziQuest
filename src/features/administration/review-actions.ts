"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/database/prisma";
import { assertPermission, AuthorizationError } from "@/lib/auth/session";
import { adminMutationLimiter } from "@/lib/security/rate-limit";
import { getRequestInfo } from "@/lib/security/request-info";
import { recordReview } from "@/features/curriculum/review";
import { DomainError } from "./services";
import type { FormState } from "./curriculum-actions";

const MESSAGES = {
  APPROVE_REVIEWED: "Approved as Reviewed.",
  APPROVE_VERIFIED: "Approved as Verified.",
  REQUEST_CHANGES: "Changes requested.",
} as const;

/** Records a review decision (M14-b). Authorization is checked here and again in the service. */
export async function recordReviewAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await assertPermission("curriculum:review");
    if (!(await adminMutationLimiter.consume(user.id)).allowed)
      return { ok: false, message: "Too many changes. Wait a minute and try again." };
    const { ip, userAgent } = await getRequestInfo();
    const raw = Object.fromEntries(
      [...formData.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("$")),
    );
    const review = await recordReview(
      prisma,
      { id: user.id, roles: user.roles, ip, userAgent },
      raw,
    );
    revalidatePath("/admin/review");
    revalidatePath("/learn");
    const decision = raw.decision as keyof typeof MESSAGES;
    return {
      ok: true,
      message: `${MESSAGES[decision] ?? "Saved."} (review ${review.id.slice(-6)})`,
    };
  } catch (error) {
    if (error instanceof AuthorizationError)
      return { ok: false, message: "You do not have permission to do that." };
    if (error instanceof z.ZodError)
      return {
        ok: false,
        message: "Please fix the highlighted fields.",
        fieldErrors: z.flattenError(error).fieldErrors as Record<string, string[]>,
      };
    if (error instanceof DomainError) return { ok: false, message: error.message };
    console.error("[review] action failed", error);
    return { ok: false, message: "Something went wrong. Nothing was changed." };
  }
}
