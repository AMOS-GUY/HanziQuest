"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/database/prisma";
import { assertPermission, AuthorizationError } from "@/lib/auth/session";
import { adminMutationLimiter } from "@/lib/security/rate-limit";
import { getRequestInfo } from "@/lib/security/request-info";
import { DomainError } from "@/features/administration/services";
import { recordSample } from "./samples";

export interface RecordSampleResult {
  ok: boolean;
  message: string;
  band?: string;
  accepted?: boolean;
  detected?: boolean;
  feedback?: string[];
}

export async function recordHandwritingSampleAction(input: unknown): Promise<RecordSampleResult> {
  try {
    const user = await assertPermission("handwriting:validate");
    if (!(await adminMutationLimiter.consume(user.id)).allowed)
      return { ok: false, message: "Too many samples per minute. Slow down a little." };
    const { ip, userAgent } = await getRequestInfo();
    const r = await recordSample(prisma, { id: user.id, roles: user.roles, ip, userAgent }, input);
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
