"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/database/prisma";
import { assertPermission, AuthorizationError } from "@/lib/auth/session";
import { adminMutationLimiter } from "@/lib/security/rate-limit";
import { getRequestInfo } from "@/lib/security/request-info";
import { DomainError } from "@/features/administration/services";
import type { FormState } from "@/features/administration/curriculum-actions";
import { claimDispute, decideDispute, releaseDispute, type DisputeActor } from "./disputes";

/** Reviewer actions on disputes (M13, D-081). Permission checked here and in the service. */
async function run(work: (actor: DisputeActor) => Promise<void>, ok: string): Promise<FormState> {
  try {
    const user = await assertPermission("handwriting:review-disputes");
    if (!(await adminMutationLimiter.consume(user.id)).allowed)
      return { ok: false, message: "Too many changes. Wait a minute and try again." };
    const { ip, userAgent } = await getRequestInfo();
    await work({ id: user.id, roles: user.roles, ip, userAgent });
    revalidatePath("/admin/disputes");
    return { ok: true, message: ok };
  } catch (error) {
    if (error instanceof AuthorizationError)
      return { ok: false, message: "You do not have permission to do that." };
    if (error instanceof z.ZodError) return { ok: false, message: "Choose a valid outcome." };
    if (error instanceof DomainError) return { ok: false, message: error.message };
    // No dispute content or identifiers in the log line.
    console.error("[disputes] action failed", error instanceof Error ? error.name : "unknown");
    return { ok: false, message: "Something went wrong. Nothing was changed." };
  }
}

const id = z.string().min(1).max(64);

export async function claimDisputeAction(disputeId: string): Promise<FormState> {
  return run((actor) => claimDispute(prisma, actor, id.parse(disputeId)), "Claimed.");
}

export async function releaseDisputeAction(disputeId: string): Promise<FormState> {
  return run((actor) => releaseDispute(prisma, actor, id.parse(disputeId)), "Released.");
}

export async function decideDisputeAction(disputeId: string, outcome: string): Promise<FormState> {
  return run(
    (actor) => decideDispute(prisma, actor, id.parse(disputeId), { outcome }),
    "Decision recorded.",
  );
}
