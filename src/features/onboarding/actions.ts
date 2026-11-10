"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/database/prisma";
import { requireUser } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { learningWriteLimiter } from "@/lib/security/rate-limit";
import { onboardingSchema } from "./schema";
import { submitPlacement, type PlacementSummary } from "@/features/assessment/placement";
import { DomainError } from "@/features/administration/services";

export async function completeOnboardingAction(input: unknown): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!(await learningWriteLimiter.consume(user.id)).allowed)
    return { error: "Too many attempts. Try again in a minute." };
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return { error: "Please answer every question." };
  const data = parsed.data;

  await prisma.$transaction(async (tx) => {
    await tx.profile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        displayName: user.name ?? "Learner",
        experienceLevel: data.experienceLevel,
        declaredHskLevel: data.declaredHskLevel || null,
        declaredLessonNote: data.declaredLessonNote || null,
        learningObjectives: data.learningObjectives,
        dailyGoalXp: data.dailyGoalXp,
        timezone: data.timezone,
        onboardingCompletedAt: new Date(),
      },
      update: {
        experienceLevel: data.experienceLevel,
        declaredHskLevel: data.declaredHskLevel || null,
        declaredLessonNote: data.declaredLessonNote || null,
        learningObjectives: data.learningObjectives,
        dailyGoalXp: data.dailyGoalXp,
        timezone: data.timezone,
        onboardingCompletedAt: new Date(),
      },
    });
    await tx.learningGoal.updateMany({
      where: { userId: user.id, type: "daily_xp", active: true },
      data: { active: false },
    });
    await tx.learningGoal.create({
      data: { userId: user.id, type: "daily_xp", target: data.dailyGoalXp },
    });
    await recordAudit(tx, {
      actorId: user.id,
      action: "user.onboarding.complete",
      entityType: "User",
      entityId: user.id,
    });
  });

  redirect(data.takePlacement ? "/placement" : "/home");
}

const placementSchema = z.object({
  assessmentId: z.string().min(1).max(64),
  answers: z.array(z.number().int().min(0).max(10).nullable()).max(100),
});

export async function submitPlacementAction(
  input: unknown,
): Promise<{ summary?: PlacementSummary; error?: string }> {
  const user = await requireUser();
  if (!(await learningWriteLimiter.consume(user.id)).allowed)
    return { error: "Too many attempts. Try again in a minute." };
  const parsed = placementSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid answers." };
  try {
    return {
      summary: await submitPlacement(
        prisma,
        user.id,
        parsed.data.assessmentId,
        parsed.data.answers,
      ),
    };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}
