/** In-app beta feedback and bug reports. */
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { DomainError, type Actor } from "@/features/administration/services";
import { releaseId } from "@/lib/release";

export const FEEDBACK_KINDS = ["BUG", "IDEA", "CONTENT", "HANDWRITING", "OTHER"] as const;
export const FEEDBACK_LABEL: Record<(typeof FEEDBACK_KINDS)[number], string> = {
  BUG: "Bug: something is broken",
  HANDWRITING: "Handwriting: grading seems wrong",
  CONTENT: "Content: a word, meaning or pinyin looks wrong",
  IDEA: "Idea or suggestion",
  OTHER: "Something else",
};

export const feedbackSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  message: z
    .string()
    .trim()
    .min(10, "Tell us a little more (at least 10 characters)")
    .max(2000, "Keep it under 2000 characters"),
  pagePath: z
    .string()
    .trim()
    .max(200)
    .regex(/^\/[^\s]*$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  allowContact: z
    .enum(["yes", "no"])
    .default("no")
    .transform((v) => v === "yes"),
});

/** Browser family only; the full user agent is not stored (data minimisation). */
export function browserFamily(ua: string | null | undefined) {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Other";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "Other";
  return `${browser} on ${os}`;
}

export async function submitFeedback(
  prisma: PrismaClient,
  userId: string,
  raw: unknown,
  meta: { userAgent?: string | null } = {},
) {
  const input = feedbackSchema.parse(raw);
  return prisma.feedback.create({
    data: {
      userId,
      kind: input.kind,
      message: input.message,
      pagePath: input.pagePath?.split("?")[0] ?? null,
      allowContact: input.allowContact,
      appRelease: releaseId() === "dev" ? null : releaseId(),
      userAgent: browserFamily(meta.userAgent),
    },
  });
}

export const feedbackStatusSchema = z.object({
  status: z.enum(["NEW", "TRIAGED", "RESOLVED", "CLOSED"]),
  staffNote: z.string().trim().max(1000).optional(),
});

export async function updateFeedbackStatus(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  raw: unknown,
) {
  const input = feedbackStatusSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const before = await tx.feedback.findUnique({ where: { id } });
    if (!before) throw new DomainError("not_found", "Feedback not found.");
    await tx.feedback.update({
      where: { id },
      data: { status: input.status, staffNote: input.staffNote || before.staffNote },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "feedback.status",
      entityType: "Feedback",
      entityId: id,
      before: { status: before.status },
      after: { status: input.status },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
  });
}
