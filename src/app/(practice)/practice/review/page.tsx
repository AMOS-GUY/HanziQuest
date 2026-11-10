import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/database/prisma";
import { getDueReviews } from "@/features/learning/sessions";
import { getReviewPractice } from "@/features/learning/lesson-data";
import { PracticeRunner } from "@/components/lessons/practice-runner";

export const metadata: Metadata = { title: "Review" };
export const dynamic = "force-dynamic";

export default async function ReviewPracticePage() {
  const user = await requireUser();
  const due = await getDueReviews(prisma, user.id);
  const payload = due.length ? await getReviewPractice(due.map((d) => d.exerciseId)) : null;
  if (!payload) redirect("/review");
  return (
    <PracticeRunner
      payload={payload}
      mode={{ kind: "review" }}
      userId={user.id}
      exitHref="/review"
    />
  );
}
