import Link from "next/link";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";

export const metadata = { title: { absolute: "Overview · HanziQuest Admin" } };

const DAY = 86_400_000;

async function activity() {
  const since = new Date(Date.now() - 7 * DAY);
  const [active, attempts, independent, passed, completions, newAccounts, rejectedSync, samples] =
    await Promise.all([
      prisma.exerciseAttempt.groupBy({ by: ["userId"], where: { occurredAt: { gte: since } } }),
      prisma.exerciseAttempt.count({ where: { occurredAt: { gte: since } } }),
      prisma.exerciseAttempt.count({
        where: { occurredAt: { gte: since }, mode: "INDEPENDENT", result: { not: "SKIPPED" } },
      }),
      prisma.exerciseAttempt.count({
        where: {
          occurredAt: { gte: since },
          mode: "INDEPENDENT",
          result: { in: ["EXCELLENT", "GOOD"] },
        },
      }),
      prisma.lessonProgress.count({
        where: { status: "COMPLETED", completedAt: { gte: since } },
      }),
      prisma.user.count({ where: { createdAt: { gte: since } } }),
      prisma.syncEvent.count({ where: { status: "REJECTED", receivedAt: { gte: since } } }),
      prisma.handwritingSample.count(),
    ]);
  return [
    { label: "Active learners", value: active.length.toLocaleString("en") },
    { label: "New accounts", value: newAccounts.toLocaleString("en") },
    { label: "Exercise attempts", value: attempts.toLocaleString("en") },
    {
      label: "Independent writing passed",
      value: independent ? `${Math.round((passed / independent) * 100)}%` : "—",
    },
    { label: "Lessons completed", value: completions.toLocaleString("en") },
    { label: "Offline events rejected", value: rejectedSync.toLocaleString("en") },
    { label: "Handwriting samples (all time)", value: samples.toLocaleString("en") },
  ];
}

export default async function AdminOverviewPage() {
  const user = await requirePagePermission("admin:access");
  const [users, publishedLessons, draftLessons, characters, vocabulary, exercises] =
    await Promise.all([
      prisma.user.count({ where: { status: { not: "DELETED" } } }),
      prisma.lesson.count({ where: { status: "PUBLISHED" } }),
      prisma.lesson.count({ where: { status: { not: "PUBLISHED" } } }),
      prisma.character.count(),
      prisma.vocabulary.count(),
      prisma.exercise.count(),
    ]);
  const content = [
    { label: "Accounts", value: users },
    { label: "Published lessons", value: publishedLessons },
    { label: "Draft lessons", value: draftLessons },
    { label: "Characters", value: characters },
    { label: "Words", value: vocabulary },
    { label: "Exercises", value: exercises },
  ];
  const showAnalytics = user.permissions.has("analytics:read");
  const recent = showAnalytics ? await activity() : [];

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-black">Overview</h1>
      {showAnalytics ? (
        <section aria-labelledby="activity">
          <h2 id="activity" className="mb-1 text-xl font-extrabold">
            Last 7 days
          </h2>
          <p className="text-muted-foreground mb-3 text-sm">
            Aggregate counts only. No individual learner data is shown here.
          </p>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {recent.map((s) => (
              <Card key={s.label} className="p-4">
                <dt className="text-muted-foreground text-sm font-bold">{s.label}</dt>
                <dd className="text-3xl font-black">{s.value}</dd>
              </Card>
            ))}
          </dl>
        </section>
      ) : null}
      <section aria-labelledby="content">
        <h2 id="content" className="mb-3 text-xl font-extrabold">
          Content and accounts
        </h2>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {content.map((s) => (
            <Card key={s.label} className="p-4">
              <dt className="text-muted-foreground text-sm font-bold">{s.label}</dt>
              <dd className="text-3xl font-black">{s.value.toLocaleString("en")}</dd>
            </Card>
          ))}
        </dl>
      </section>
      {user.permissions.has("curriculum:write") ? (
        <Card>
          <CardTitle>Content workflow</CardTitle>
          <CardDescription>
            <Link href="/admin/import" className="text-primary font-bold underline">
              Import
            </Link>{" "}
            or create lessons in{" "}
            <Link href="/admin/curricula" className="text-primary font-bold underline">
              Curricula
            </Link>
            , preview them as a learner, then publish. New lessons always start as drafts.
          </CardDescription>
        </Card>
      ) : null}
    </div>
  );
}
