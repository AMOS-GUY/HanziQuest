import type { Metadata } from "next";
import { PracticeHub } from "@/components/practice/practice-hub";
import { requireUser } from "@/lib/auth/session";
import { getLearnerPath } from "@/features/curriculum/queries";
import { prisma } from "@/lib/database/prisma";
import { getProgressSummary } from "@/features/progress/queries";

export const metadata: Metadata = { title: "Practice" };

/** Practice hub: the learner's next lesson and reviews due, as on the home page. */
export default async function PracticeHubPage() {
  const user = await requireUser();
  const [{ next }, summary] = await Promise.all([
    getLearnerPath(user.id),
    getProgressSummary(prisma, user.id),
  ]);
  return <PracticeHub nextLesson={next} dueNow={summary.dueNow} />;
}
