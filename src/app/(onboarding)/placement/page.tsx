import type { Metadata } from "next";
import { prisma } from "@/lib/database/prisma";
import { requireUser } from "@/lib/auth/session";
import Link from "next/link";
import { placementRetakeAt, startPlacement } from "@/features/assessment/placement";
import { PlacementQuiz } from "./placement-quiz";

export const metadata: Metadata = { title: "Placement check" };

export default async function PlacementPage() {
  const user = await requireUser();
  const retakeAt = await placementRetakeAt(prisma, user.id);
  if (retakeAt) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-3 py-16 text-center">
        <h1 className="text-2xl font-black">You&apos;ve already taken the placement check</h1>
        <p className="text-muted-foreground">
          You can take it again after{" "}
          {retakeAt.toLocaleString("en", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: user.profile?.timezone ?? "UTC",
          })}
          . Lessons you didn&apos;t test out of are waiting on the Learn page.
        </p>
        <Link href="/learn" className="text-primary font-bold underline underline-offset-4">
          Go to Learn
        </Link>
      </div>
    );
  }
  const { assessmentId, questions } = await startPlacement(prisma, user.id);
  return <PlacementQuiz assessmentId={assessmentId} questions={questions} />;
}
