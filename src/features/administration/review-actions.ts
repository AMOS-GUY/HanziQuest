"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/database/prisma";
import { assertPermission, AuthorizationError } from "@/lib/auth/session";
import { adminMutationLimiter } from "@/lib/security/rate-limit";
import { getRequestInfo } from "@/lib/security/request-info";
import { recordReview } from "@/features/curriculum/review";
import { DomainError } from "./services";
import type { FormState } from "./curriculum-actions";

const RETURN_STATUS = new Set([
  "open",
  "all",
  "needs-review",
  "changes-requested",
  "stale",
  "approved",
  "unreviewed-status",
]);
const RETURN_KIND = new Set(["CURRICULUM", "CHARACTER", "VOCABULARY"]);

/**
 * Where to go after a decision: the same queue view, with the decision to confirm. Built only from
 * validated values (never a URL from the form), so it can't redirect anywhere else.
 */
function returnUrl(raw: Record<string, unknown>, reviewId: string) {
  const q = new URLSearchParams();
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : "");
  if (/^[a-z0-9]{1,64}$/.test(str("c"))) q.set("c", str("c"));
  if (RETURN_STATUS.has(str("status"))) q.set("status", str("status"));
  if (RETURN_KIND.has(str("kind"))) q.set("kind", str("kind"));
  if (/^\d{1,4}$/.test(str("page"))) q.set("page", str("page"));
  q.set("done", reviewId);
  return `/admin/review?${q.toString()}`;
}

/** Records a review decision (M14-b). Authorization is checked here and again in the service. */
export async function recordReviewAction(_: FormState, formData: FormData): Promise<FormState> {
  let destination: string;
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
    // The page confirms the decision and moves focus to the confirmation: the item's own card
    // may leave the list (an approved item isn't "open"), taking any message with it.
    destination = returnUrl(raw, review.id);
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
  redirect(destination);
}
