import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";

export const metadata = { title: "Overview" };

export default async function AdminOverviewPage() {
  await requirePagePermission("admin:access");
  const [users, publishedLessons, draftLessons, characters, vocabulary, exercises, attempts] =
    await Promise.all([
      prisma.user.count({ where: { status: { not: "DELETED" } } }),
      prisma.lesson.count({ where: { status: "PUBLISHED" } }),
      prisma.lesson.count({ where: { status: { not: "PUBLISHED" } } }),
      prisma.character.count(),
      prisma.vocabulary.count(),
      prisma.exercise.count(),
      prisma.exerciseAttempt.count(),
    ]);

  const stats = [
    { label: "Accounts", value: users },
    { label: "Published lessons", value: publishedLessons },
    { label: "Draft lessons", value: draftLessons },
    { label: "Characters", value: characters },
    { label: "Vocabulary items", value: vocabulary },
    { label: "Exercises", value: exercises },
    { label: "Exercise attempts", value: attempts },
  ];

  return (
    <div>
      <h1 className="mb-6 text-3xl font-black">Overview</h1>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <dt className="text-muted-foreground text-sm font-bold">{s.label}</dt>
            <dd className="text-3xl font-black">{s.value.toLocaleString("en")}</dd>
          </Card>
        ))}
      </dl>
    </div>
  );
}
