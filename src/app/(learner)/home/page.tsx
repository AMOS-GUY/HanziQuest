import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getLearningPath } from "@/features/curriculum/queries";

export const metadata: Metadata = { title: "Home" };

function greeting(timezone: string) {
  let hour = new Date().getUTCHours();
  try {
    hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        hour: "numeric",
        hourCycle: "h23",
        timeZone: timezone,
      }).format(new Date()),
    );
  } catch {
    // Invalid stored timezone: fall back to UTC.
  }
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function HomePage() {
  const user = await requireUser();
  const path = await getLearningPath();
  const firstLesson = path[0]?.levels[0]?.units[0]?.lessons[0];
  const totalLessons = path
    .flatMap((c) => c.levels)
    .flatMap((l) => l.units)
    .reduce((n, u) => n + u.lessons.length, 0);
  const name = user.profile?.displayName ?? user.name ?? "learner";

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-3xl font-black">
          {greeting(user.profile?.timezone ?? "UTC")}, {name}
        </h1>
        <p className="text-muted-foreground">Ready to write some characters?</p>
      </section>

      <Card className="border-primary/30 bg-accent flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Start learning</CardTitle>
          <CardDescription className="text-accent-foreground/80">
            {firstLesson
              ? `${totalLessons} HSK 1 lessons are ready. Begin with “${firstLesson.title}”.`
              : "No lessons are published yet. Check back soon."}
          </CardDescription>
        </div>
        {firstLesson ? (
          <Button asChild>
            <Link href="/learn">
              Open learning path <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : null}
      </Card>

      <Card className="flex items-start gap-3">
        <Target className="text-primary mt-0.5 size-6 shrink-0" aria-hidden />
        <div>
          <CardTitle className="text-base">
            Daily goal: {user.profile?.dailyGoalXp ?? 30} XP
          </CardTitle>
          <CardDescription>
            XP, streaks and review reminders start counting once writing practice is live.
          </CardDescription>
        </div>
      </Card>
    </div>
  );
}
