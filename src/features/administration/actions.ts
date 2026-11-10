"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/database/prisma";
import { assertPermission, AuthorizationError } from "@/lib/auth/session";
import { adminMutationLimiter } from "@/lib/security/rate-limit";
import { getRequestInfo } from "@/lib/security/request-info";
import { DomainError, setLessonStatus, setUserRole } from "./services";

export interface AdminActionResult {
  ok: boolean;
  message?: string;
}

function toResult(error: unknown): AdminActionResult {
  if (error instanceof AuthorizationError)
    return { ok: false, message: "You do not have permission to do that." };
  if (error instanceof DomainError) return { ok: false, message: error.message };
  throw error;
}

const lessonStatusSchema = z.object({
  lessonId: z.string().min(1).max(64),
  status: z.enum(["PUBLISHED", "DRAFT"]),
});

export async function setLessonStatusAction(input: unknown): Promise<AdminActionResult> {
  try {
    const user = await assertPermission("curriculum:publish");
    if (!adminMutationLimiter.consume(user.id).allowed)
      return { ok: false, message: "Too many changes. Slow down." };
    const { lessonId, status } = lessonStatusSchema.parse(input);
    const { ip, userAgent } = await getRequestInfo();
    await setLessonStatus(
      prisma,
      { id: user.id, roles: user.roles, ip, userAgent },
      lessonId,
      status,
    );
    revalidatePath("/admin/lessons");
    revalidatePath("/learn");
    return { ok: true };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, message: "Invalid request." };
    return toResult(error);
  }
}

const userRoleSchema = z.object({
  userId: z.string().min(1).max(64),
  role: z.enum(["SUPER_ADMIN", "CURRICULUM_EDITOR", "MODERATOR", "ANALYST", "SUPPORT", "LEARNER"]),
  grant: z.boolean(),
});

export async function setUserRoleAction(input: unknown): Promise<AdminActionResult> {
  try {
    const user = await assertPermission("users:manage-roles");
    if (!adminMutationLimiter.consume(user.id).allowed)
      return { ok: false, message: "Too many changes. Slow down." };
    const { userId, role, grant } = userRoleSchema.parse(input);
    const { ip, userAgent } = await getRequestInfo();
    await setUserRole(
      prisma,
      { id: user.id, roles: user.roles, ip, userAgent },
      userId,
      role,
      grant,
    );
    revalidatePath(`/admin/users/${userId}`);
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, message: "Invalid request." };
    return toResult(error);
  }
}
