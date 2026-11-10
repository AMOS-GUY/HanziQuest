import type { Metadata } from "next";
import { prisma } from "@/lib/database/prisma";
import { requireUser } from "@/lib/auth/session";
import { startPlacement } from "@/features/assessment/placement";
import { PlacementQuiz } from "./placement-quiz";

export const metadata: Metadata = { title: "Placement check" };

export default async function PlacementPage() {
  const user = await requireUser();
  const { assessmentId, questions } = await startPlacement(prisma, user.id);
  return <PlacementQuiz assessmentId={assessmentId} questions={questions} />;
}
