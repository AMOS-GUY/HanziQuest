import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CircleCheck, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/database/prisma";
import { getDueReviews, REVIEW_BATCH_SIZE } from "@/features/learning/sessions";
import { getProgressSummary, getReviewForecast } from "@/features/progress/queries";

export const metadata: Metadata = { title: "Review" };

function formatDue(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(date);
}

export default async function ReviewPage() {
  const user = await requireUser();
  const timezone = user.profile?.timezone ?? "UTC";
  const now = new Date();
  const [summary, due, forecast] = await Promise.all([
    getProgressSummary(prisma, user.id, now),
    getDueReviews(prisma, user.id, now, 50),
    getReviewForecast(prisma, user.id, timezone, now),
  ]);
  const maxCount = Math.max(1, ...forecast.map((f) => f.count));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-black">Review</h1>
        <p className="text-muted-foreground">
          Write characters from memory just as you are about to forget them. Reviews are spaced
          further apart each time you remember.
        </p>
      </div>

      {due.length > 0 ? (
        <Card className="border-primary/30 bg-accent flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <RefreshCcw className="text-primary mt-1 size-6 shrink-0" aria-hidden />
            <div>
              <CardTitle>
                {due.length} character{due.length === 1 ? "" : "s"} to review
              </CardTitle>
              <CardDescription className="text-accent-foreground/80">
                {due.length > REVIEW_BATCH_SIZE
                  ? `Reviews come in rounds of ${REVIEW_BATCH_SIZE}.`
                  : "One short round."}
              </CardDescription>
            </div>
          </div>
          <p lang="zh" className="hanzi text-accent-foreground text-3xl tracking-widest">
            {due
              .slice(0, REVIEW_BATCH_SIZE)
              .map((d) => d.hanzi)
              .join(" ")}
          </p>
          <Button asChild size="lg" className="self-start">
            <Link href="/practice/review">Start review</Link>
          </Button>
        </Card>
      ) : (
        <Card className="flex items-start gap-3">
          <CircleCheck className="text-primary mt-0.5 size-6 shrink-0" aria-hidden />
          <div>
            <CardTitle className="text-base">You&apos;re all caught up</CardTitle>
            <CardDescription>
              {summary.dueNext
                ? `Next review: ${formatDue(summary.dueNext, timezone)}.`
                : "Characters appear here after you practise them in a lesson."}
            </CardDescription>
          </div>
        </Card>
      )}

      <section aria-labelledby="forecast">
        <h2 id="forecast" className="mb-3 flex items-center gap-2 text-xl font-extrabold">
          <CalendarClock className="size-5" aria-hidden /> Coming up
        </h2>
        <Card>
          <ol className="grid grid-cols-7 gap-2 text-center">
            {forecast.map((f, i) => (
              <li key={f.day} className="flex flex-col items-center gap-1">
                <div className="flex h-20 w-full items-end" aria-hidden>
                  <div
                    className={f.count > 0 ? "bg-primary/70 w-full rounded-t-md" : "w-full"}
                    style={{ height: `${Math.round((f.count / maxCount) * 100)}%` }}
                  />
                </div>
                <span className="text-sm font-black">{f.count}</span>
                <span className="text-muted-foreground text-[11px] font-bold">
                  {i === 0
                    ? "Today"
                    : new Intl.DateTimeFormat("en-GB", {
                        weekday: "short",
                        timeZone: "UTC",
                      }).format(new Date(`${f.day}T12:00:00Z`))}
                </span>
                <span className="sr-only">reviews due on {f.day}</span>
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </div>
  );
}
