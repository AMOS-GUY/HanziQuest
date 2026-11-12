"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/database/prisma";
import { assertPermission, AuthorizationError } from "@/lib/auth/session";
import type { Permission } from "@/lib/permissions/permissions";
import { adminMutationLimiter } from "@/lib/security/rate-limit";
import { getRequestInfo } from "@/lib/security/request-info";
import { DomainError, type Actor } from "@/features/administration/services";
import type { FormState } from "@/features/administration/curriculum-actions";
import { recordSample } from "./samples";
import { eraseParticipant, recordConsent } from "./participants";

export interface RecordSampleResult {
  ok: boolean;
  message: string;
  band?: string;
  accepted?: boolean;
  detected?: boolean;
  feedback?: string[];
}

async function actorFor(permission: Permission): Promise<Actor | null> {
  const user = await assertPermission(permission);
  if (!(await adminMutationLimiter.consume(user.id)).allowed) return null;
  const { ip, userAgent } = await getRequestInfo();
  return { id: user.id, roles: user.roles, ip, userAgent };
}

export async function recordHandwritingSampleAction(input: unknown): Promise<RecordSampleResult> {
  try {
    const actor = await actorFor("handwriting:validate");
    if (!actor) return { ok: false, message: "Too many samples per minute. Slow down a little." };
    const r = await recordSample(prisma, actor, input);
    revalidatePath("/admin/handwriting");
    return {
      ok: true,
      message: "Sample saved.",
      band: r.evaluation.band,
      accepted: r.accepted,
      detected: r.detected,
      feedback: r.evaluation.feedback.map((f) => f.message),
    };
  } catch (error) {
    if (error instanceof AuthorizationError)
      return { ok: false, message: "You do not have permission to do that." };
    if (error instanceof z.ZodError)
      return { ok: false, message: error.issues.map((i) => i.message).join(" ") };
    if (error instanceof DomainError) return { ok: false, message: error.message };
    throw error;
  }
}

async function formAction(
  permission: Permission,
  work: (actor: Actor) => Promise<string>,
): Promise<FormState> {
  try {
    const actor = await actorFor(permission);
    if (!actor) return { ok: false, message: "Too many changes. Wait a minute and try again." };
    const message = await work(actor);
    revalidatePath("/admin/handwriting");
    return { ok: true, message };
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
    console.error("[handwriting lab] action failed", error);
    return { ok: false, message: "Something went wrong. Nothing was changed." };
  }
}

function fields(formData: FormData) {
  const out: Record<string, string | boolean> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) out[key] = value;
  }
  return out;
}

export async function recordConsentAction(_: FormState, formData: FormData) {
  return formAction("handwriting:validate", async (actor) => {
    const raw = fields(formData);
    const { participant, consent } = await recordConsent(prisma, actor, {
      ...raw,
      witnessed: raw.witnessed === "yes",
    });
    return `Consent ${consent.version} recorded for ${participant.code}.`;
  });
}

export async function eraseParticipantAction(_: FormState, formData: FormData) {
  return formAction("handwriting:erase", async (actor) => {
    const r = await eraseParticipant(prisma, actor, fields(formData));
    const feedback = r.feedbackToReview
      ? ` ${r.feedbackToReview} feedback entr${r.feedbackToReview === 1 ? "y mentions" : "ies mention"} this code: review ${r.feedbackToReview === 1 ? "it" : "them"} in Admin → Feedback (not erased automatically).`
      : "";
    return `${r.code}: ${r.samplesDeleted} sample(s) deleted, ${r.auditEntriesRedacted} audit entr${r.auditEntriesRedacted === 1 ? "y" : "ies"} redacted, consent revoked. The code is now blocked.${feedback} Delete any exported files by hand.`;
  });
}
