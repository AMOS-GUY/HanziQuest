import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Flame, PartyPopper, RefreshCcw, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { requireUser } from "@/lib/auth/session";
import { getLearnerPath } from "@/features/curriculum/queries";
import { prisma } from "@/lib/database/prisma";
import { getProgressSummary } from "@/features/progress/queries";

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
  const [{ next, completed, total }, summary] = await Promise.all([
    getLearnerPath(user.id),
    getProgressSummary(prisma, user.id),
  ]);
  const name = user.profile?.displayName ?? user.name ?? "learner";

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-3xl font-black">
          {greeting(user.profile?.timezone ?? "UTC")}, {name}
        </h1>
        <p className="text-muted-foreground">Ready to write some characters?</p>
      </section>

      {total === 0 ? (
        <Card>
          <CardTitle>No lessons yet</CardTitle>
          <CardDescription>No lessons are published yet. Check back soon.</CardDescription>
        </Card>
      ) : next ? (
        <Card className="border-primary/30 bg-accent flex flex-col gap-4">
          <div>
            <CardTitle>{completed === 0 ? "Start learning" : "Continue learning"}</CardTitle>
            <CardDescription className="text-accent-foreground/80">
              Next up: “{next.title}”
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <ProgressBar value={completed} max={total} label="HSK 1 lessons completed" />
            <span className="text-accent-foreground text-sm font-bold whitespace-nowrap">
              {completed}/{total}
            </span>
          </div>
          <Button asChild className="self-start">
            <Link href={`/learn/${next.id}`}>
              {completed === 0 ? "Start" : "Continue"} <ArrowRight aria-hidden />
            </Link>
          </Button>
        </Card>
      ) : (
        <Card className="border-primary/30 bg-accent flex items-start gap-3">
          <PartyPopper className="text-primary mt-0.5 size-6 shrink-0" aria-hidden />
          <div>
            <CardTitle>All {total} lessons done</CardTitle>
            <CardDescription className="text-accent-foreground/80">
              You&apos;ve finished every published lesson. Practise any lesson again from the
              learning path.
            </CardDescription>
          </div>
        </Card>
      )}

      <section aria-label="Today" className="grid gap-3 sm:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Target className="text-primary size-5" aria-hidden />
            <CardTitle className="text-base">Daily goal</CardTitle>
            <span className="ml-auto text-sm font-bold">
              {summary.today.xp}/{summary.today.goal} XP
            </span>
          </div>
          <ProgressBar value={summary.today.xp} max={summary.today.goal} label="Daily goal" />
          <div className="flex items-center gap-1.5 text-sm font-bold">
            <Flame className="size-4 text-[#d9480f]" aria-hidden />
            {summary.streak.current > 0
              ? `${summary.streak.current}-day streak`
              : "Practise today to start a streak"}
          </div>
        </Card>
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <RefreshCcw className="text-primary size-5" aria-hidden />
            <CardTitle className="text-base">Review</CardTitle>
          </div>
          <CardDescription>
            {summary.dueNow > 0
              ? `${summary.dueNow} character${summary.dueNow === 1 ? "" : "s"} ready to review.`
              : "Nothing due right now."}
          </CardDescription>
          {summary.dueNow > 0 ? (
            <Button asChild size="sm" variant="secondary" className="self-start">
              <Link href="/review">Review now</Link>
            </Button>
          ) : null}
        </Card>
      </section>
    </div>
  );
}
