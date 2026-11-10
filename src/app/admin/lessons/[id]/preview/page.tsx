import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PracticeRunner } from "@/components/lessons/practice-runner";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/database/prisma";
import { getLessonPractice } from "@/features/learning/lesson-data";

export const metadata = { title: "Lesson preview" };

/** Shows a lesson exactly as learners will see it, including drafts. Nothing is saved. */
export default async function LessonPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("curriculum:read");
  const { id } = await params;
  const [lesson, payload] = await Promise.all([
    prisma.lesson.findUnique({
      where: { id },
      include: {
        unit: {
          include: { level: { include: { curriculum: { select: { verification: true } } } } },
        },
        vocabulary: { orderBy: { position: "asc" }, include: { vocabulary: true } },
      },
    }),
    getLessonPractice(id, { preview: true }),
  ]);
  if (!lesson || !payload) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-accent text-accent-foreground flex flex-wrap items-center gap-3 rounded-xl px-4 py-2 text-sm font-bold">
        Preview{lesson.status !== "PUBLISHED" ? " of a draft lesson" : ""}. Answers are graded but
        not saved, and no XP is given.
        <Link href={`/admin/lessons/${lesson.id}`} className="underline">
          Back to editor
        </Link>
      </div>
      <Card>
        <p className="text-primary text-xs font-extrabold tracking-wider uppercase">
          {lesson.unit.level.name} · Unit {lesson.unit.position} · {lesson.unit.title}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-black">{lesson.title}</h1>
          {lesson.unit.level.curriculum.verification !== "VERIFIED" ? (
            <Badge variant="warning">Provisional content</Badge>
          ) : null}
        </div>
        {lesson.description ? <p className="text-muted-foreground">{lesson.description}</p> : null}
        <ul className="mt-3 flex flex-wrap gap-3">
          {lesson.vocabulary.map(({ vocabulary: v }) => (
            <li key={v.id} className="border-border rounded-xl border-2 px-3 py-2">
              <span lang="zh" className="hanzi text-2xl">
                {v.simplified}
              </span>{" "}
              <span className="font-bold">{v.pinyin}</span>{" "}
              <span className="text-muted-foreground text-sm">{v.meaning}</span>
            </li>
          ))}
        </ul>
      </Card>
      <PracticeRunner
        payload={payload}
        mode={{ kind: "preview" }}
        userId={user.id}
        exitHref={`/admin/lessons/${lesson.id}`}
      />
    </div>
  );
}
