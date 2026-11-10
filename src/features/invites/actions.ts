"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/database/prisma";
import { assertPermission, AuthorizationError } from "@/lib/auth/session";
import { adminMutationLimiter } from "@/lib/security/rate-limit";
import { getRequestInfo } from "@/lib/security/request-info";
import { DomainError } from "@/features/administration/services";
import { createInvite, revokeInvite } from "./invites";

export interface InviteFormState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Shown once: the plain code. It is not stored. */
  code?: string;
}

function fail(error: unknown): InviteFormState {
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

export async function createInviteAction(
  _: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  try {
    const actor = await assertPermission("invites:manage");
    if (!(await adminMutationLimiter.consume(actor.id)).allowed)
      return { ok: false, message: "Too many changes. Slow down." };
    const meta = await getRequestInfo();
    const { code } = await createInvite(
      prisma,
      { id: actor.id, roles: actor.roles, ...meta },
      Object.fromEntries(formData),
    );
    revalidatePath("/admin/invites");
    return { ok: true, code, message: "Invite created. Copy the code now: it is not shown again." };
  } catch (error) {
    return fail(error);
  }
}

export async function revokeInviteAction(id: string): Promise<InviteFormState> {
  try {
    const actor = await assertPermission("invites:manage");
    if (!(await adminMutationLimiter.consume(actor.id)).allowed)
      return { ok: false, message: "Too many changes. Slow down." };
    const meta = await getRequestInfo();
    await revokeInvite(prisma, { id: actor.id, roles: actor.roles, ...meta }, id);
    revalidatePath("/admin/invites");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
