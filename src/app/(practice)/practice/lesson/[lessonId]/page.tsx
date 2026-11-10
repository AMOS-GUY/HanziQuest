import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/database/prisma";
import { getLessonPractice } from "@/features/learning/lesson-data";
import { getLessonState } from "@/features/progression/lesson-states";
import { PracticeRunner } from "@/components/lessons/practice-runner";

export const metadata: Metadata = { title: "Practice" };

export default async function LessonPracticePage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const user = await requireUser();
  const { lessonId } = await params;
  const state = await getLessonState(prisma, user.id, lessonId);
  if (!state) notFound();
  if (state === "LOCKED") redirect(`/learn/${lessonId}`);
  const payload = await getLessonPractice(lessonId);
  if (!payload) notFound();
  return <PracticeRunner payload={payload} lessonId={lessonId} exitHref={`/learn/${lessonId}`} />;
}
