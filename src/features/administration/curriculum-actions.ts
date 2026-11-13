"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/database/prisma";
import { assertPermission, AuthorizationError } from "@/lib/auth/session";
import { adminMutationLimiter } from "@/lib/security/rate-limit";
import { getRequestInfo } from "@/lib/security/request-info";
import type { Permission } from "@/lib/permissions/permissions";
import { recordAudit } from "@/lib/audit";
import { loadStrokeData } from "@/features/curriculum/stroke-data";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { sourceRegister } from "@/features/curriculum/sources";
import { confusableDiagnostics } from "@/features/curriculum/confusable-diagnostics";
import { formatImportPreview, previewCurriculumImport } from "@/features/curriculum/import-preview";
import { importCurriculumContent } from "@/features/curriculum/import-content";
import { DomainError, type Actor } from "./services";
import * as admin from "./curriculum-admin";

export interface FormState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Import preview / result details. */
  details?: string[];
}

const MAX_IMPORT_BYTES = 2_000_000;

function fields(formData: FormData) {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) out[key] = value;
  }
  return out;
}

/**
 * Runs an admin mutation: permission check (server-side), rate limit, then the service.
 * Returns form state for the client; `redirectTo` navigates after success.
 */
async function run(
  permission: Permission,
  work: (actor: Actor) => Promise<{ message?: string; redirectTo?: string; revalidate?: string[] }>,
): Promise<FormState> {
  let redirectTo: string | undefined;
  try {
    const user = await assertPermission(permission);
    if (!(await adminMutationLimiter.consume(user.id)).allowed)
      return { ok: false, message: "Too many changes. Wait a minute and try again." };
    const { ip, userAgent } = await getRequestInfo();
    const result = await work({ id: user.id, roles: user.roles, ip, userAgent });
    for (const path of result.revalidate ?? []) revalidatePath(path);
    revalidatePath("/learn");
    redirectTo = result.redirectTo;
    if (!redirectTo) return { ok: true, message: result.message ?? "Saved." };
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
    console.error("[admin] action failed", error);
    return { ok: false, message: "Something went wrong. Nothing was changed." };
  }
  redirect(redirectTo);
}

// Curricula and levels

export async function createCurriculumAction(_: FormState, formData: FormData) {
  return run("curriculum:write", async (actor) => {
    const c = await admin.createCurriculum(prisma, actor, fields(formData));
    return { redirectTo: `/admin/curricula/${c.id}` };
  });
}

export async function updateCurriculumAction(id: string, _: FormState, formData: FormData) {
  return run("curriculum:write", async (actor) => {
    await admin.updateCurriculum(prisma, actor, id, fields(formData));
    return { revalidate: [`/admin/curricula/${id}`] };
  });
}

export async function createLevelAction(_: FormState, formData: FormData) {
  return run("curriculum:write", async (actor) => {
    const input = fields(formData);
    await admin.createLevel(prisma, actor, input);
    return { message: "Level added.", revalidate: [`/admin/curricula/${input.curriculumId}`] };
  });
}

export async function updateLevelAction(id: string, _: FormState, formData: FormData) {
  return run("curriculum:write", async (actor) => {
    const level = await admin.updateLevel(prisma, actor, id, fields(formData));
    return { revalidate: [`/admin/curricula/${level.curriculumId}`] };
  });
}

// Units and lessons

export async function createUnitAction(_: FormState, formData: FormData) {
  return run("curriculum:write", async (actor) => {
    const unit = await admin.createUnit(prisma, actor, fields(formData));
    return { redirectTo: `/admin/units/${unit.id}` };
  });
}

export async function updateUnitAction(id: string, _: FormState, formData: FormData) {
  return run("curriculum:write", async (actor) => {
    await admin.updateUnit(prisma, actor, id, fields(formData));
    return { revalidate: [`/admin/units/${id}`, "/admin/lessons"] };
  });
}

export async function createLessonAction(_: FormState, formData: FormData) {
  return run("curriculum:write", async (actor) => {
    const lesson = await admin.createLesson(prisma, actor, fields(formData));
    return { redirectTo: `/admin/lessons/${lesson.id}` };
  });
}

export async function updateLessonAction(id: string, _: FormState, formData: FormData) {
  return run("curriculum:write", async (actor) => {
    await admin.updateLesson(prisma, actor, id, fields(formData));
    return { revalidate: [`/admin/lessons/${id}`, "/admin/lessons"] };
  });
}

export async function setLessonWordsAction(id: string, _: FormState, formData: FormData) {
  return run("curriculum:write", async (actor) => {
    const built = await admin.setLessonWords(prisma, actor, id, fields(formData));
    return {
      message: `Saved. ${built.characters.length} characters, ${built.generatedExercises} generated exercises.`,
      revalidate: [`/admin/lessons/${id}`, "/admin/lessons"],
    };
  });
}

// Characters and vocabulary

export async function createCharacterAction(_: FormState, formData: FormData) {
  return run("curriculum:write", async (actor) => {
    const c = await admin.createCharacter(prisma, actor, fields(formData));
    return { redirectTo: `/admin/characters/${c.id}` };
  });
}

export async function updateCharacterAction(id: string, _: FormState, formData: FormData) {
  return run("curriculum:write", async (actor) => {
    await admin.updateCharacter(prisma, actor, id, fields(formData));
    return { revalidate: [`/admin/characters/${id}`, "/admin/characters"] };
  });
}

export async function createVocabularyAction(_: FormState, formData: FormData) {
  return run("curriculum:write", async (actor) => {
    const v = await admin.createVocabulary(prisma, actor, fields(formData));
    return { redirectTo: `/admin/vocabulary/${v.id}` };
  });
}

export async function updateVocabularyAction(id: string, _: FormState, formData: FormData) {
  return run("curriculum:write", async (actor) => {
    await admin.updateVocabulary(prisma, actor, id, fields(formData));
    return { revalidate: [`/admin/vocabulary/${id}`, "/admin/vocabulary"] };
  });
}

// Exercises

export async function updateExerciseAction(id: string, _: FormState, formData: FormData) {
  return run("curriculum:write", async (actor) => {
    await admin.updateExercise(prisma, actor, id, fields(formData));
    return { revalidate: [`/admin/exercises/${id}`] };
  });
}

export async function createCustomExerciseAction(_: FormState, formData: FormData) {
  return run("curriculum:write", async (actor) => {
    const input = fields(formData);
    await admin.createCustomExercise(prisma, actor, input);
    return { message: "Exercise added.", revalidate: [`/admin/lessons/${input.lessonId}`] };
  });
}

export async function removeCustomExerciseAction(
  lessonId: string,
  exerciseId: string,
): Promise<FormState> {
  return run("curriculum:write", async (actor) => {
    await admin.removeCustomExercise(prisma, actor, lessonId, exerciseId);
    return { message: "Exercise removed.", revalidate: [`/admin/lessons/${lessonId}`] };
  });
}

// Import

function parseImport(formData: FormData) {
  const raw = formData.get("content");
  if (typeof raw !== "string" || raw.trim() === "")
    return { error: "Paste or choose a content JSON file." } as const;
  if (raw.length > MAX_IMPORT_BYTES) return { error: "The file is larger than 2 MB." } as const;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { error: "This is not valid JSON." } as const;
  }
  const result = validateCurriculumContent(json, loadStrokeData, sourceRegister());
  return { result } as const;
}

function describeValidation(result: ReturnType<typeof validateCurriculumContent>) {
  const details = result.issues
    .slice(0, 200)
    .map(
      (i) => `${i.severity === "error" ? "Error" : "Warning"} at ${i.path || "root"}: ${i.message}`,
    );
  if (result.ok && result.content) {
    const c = result.content;
    const lessons = c.units.reduce((t, u) => t + u.lessons.length, 0);
    details.unshift(
      `${c.curriculum.name} (${c.curriculum.framework} ${c.curriculum.version}), level ${c.level.level}: ` +
        `${c.units.length} units, ${lessons} lessons, ${Object.keys(c.characters).length} characters. ` +
        `Verification: ${c.curriculum.verification}.`,
    );
  }
  return details;
}

export async function validateImportAction(_: FormState, formData: FormData): Promise<FormState> {
  try {
    await assertPermission("content:import");
  } catch {
    return { ok: false, message: "You do not have permission to do that." };
  }
  const parsed = parseImport(formData);
  if ("error" in parsed) return { ok: false, message: parsed.error };
  const details = describeValidation(parsed.result);
  if (parsed.result.ok && parsed.result.content) {
    // What importing would change, against the current database (read-only).
    const preview = await previewCurriculumImport(prisma, parsed.result.content);
    details.push("— Import preview —", ...formatImportPreview(preview));
    // M13: advisory only; it never changes whether the import is valid.
    details.push(
      "— Confusable characters —",
      ...confusableDiagnostics(parsed.result.content, loadStrokeData).lines,
    );
  }
  return {
    ok: parsed.result.ok,
    message: parsed.result.ok ? "Validation passed." : "Validation failed.",
    details,
  };
}

export async function importContentAction(_: FormState, formData: FormData): Promise<FormState> {
  // Permission first: validation messages are only for people who may import.
  try {
    await assertPermission("content:import");
  } catch {
    return { ok: false, message: "You do not have permission to do that." };
  }
  const parsed = parseImport(formData);
  if ("error" in parsed) return { ok: false, message: parsed.error };
  if (!parsed.result.ok || !parsed.result.content)
    return {
      ok: false,
      message: "Fix the validation errors first.",
      details: describeValidation(parsed.result),
    };
  const content = parsed.result.content;
  return run("content:import", async (actor) => {
    // Imports never publish: new lessons arrive as drafts for review and preview.
    // The audit entry is written inside the import transaction (all or nothing).
    const summary = await importCurriculumContent(prisma, content, {
      publishNewLessons: false,
      lookupStrokes: loadStrokeData,
      authorId: actor.id,
      onImported: (tx, s) =>
        recordAudit(tx, {
          actorId: actor.id,
          action: "content.import",
          entityType: "Curriculum",
          entityId: s.curriculumId,
          after: { ...s, slug: content.curriculum.slug, version: content.curriculum.version },
          ipAddress: actor.ip,
          userAgent: actor.userAgent,
        }),
    });
    const kept =
      summary.protectedKept.length > 0
        ? ` Kept the reviewed reading or gloss of ${summary.protectedKept.join(", ")} (this file is less verified).`
        : "";
    return {
      message: `Imported: ${summary.lessonsCreated} new lessons (as drafts), ${summary.lessonsUpdated} updated, ${summary.charactersUpserted} characters, ${summary.vocabularyUpserted} words, ${summary.exercisesUpserted} exercises.${kept}`,
      revalidate: ["/admin/lessons", "/admin/curricula"],
    };
  });
}
