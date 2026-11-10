import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock, PenLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getLessonForLearner } from "@/features/learning/lesson-data";

export const metadata: Metadata = { title: "Lesson" };

const STATE_LABEL = {
  AVAILABLE: null,
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  TESTED_OUT: "Tested out",
  LOCKED: "Locked",
} as const;

export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const user = await requireUser();
  const { lessonId } = await params;
  const lesson = await getLessonForLearner(user.id, lessonId);
  if (!lesson) notFound();
  const locked = lesson.state === "LOCKED";
  const newCharacters = lesson.characters.filter((c) => c.isNew);

  return (
    <div className="flex flex-col gap-6">
      <Link href="/learn" className="text-primary flex items-center gap-1 text-sm font-bold">
        <ArrowLeft className="size-4" aria-hidden /> Learning path
      </Link>
      <div>
        <p className="text-primary text-xs font-extrabold tracking-wider uppercase">
          {lesson.unit.level.name} · Unit {lesson.unit.position} · {lesson.unit.title}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-black">{lesson.title}</h1>
          {STATE_LABEL[lesson.state] ? (
            <Badge variant={lesson.state === "LOCKED" ? "muted" : "default"}>
              {STATE_LABEL[lesson.state]}
            </Badge>
          ) : null}
        </div>
      </div>

      {locked ? (
        <Card className="flex items-start gap-3">
          <Lock className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
          <p>Finish the previous lesson to unlock this one.</p>
        </Card>
      ) : (
        <Button asChild size="lg" className="self-start">
          <Link href={`/practice/lesson/${lesson.id}`}>
            <PenLine aria-hidden />{" "}
            {lesson.state === "COMPLETED" ? "Practise again" : "Start practice"} ·{" "}
            {lesson._count.exercises} exercises
          </Link>
        </Button>
      )}

      <section aria-labelledby="words">
        <h2 id="words" className="mb-3 text-xl font-extrabold">
          Words
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {lesson.vocabulary.map(({ vocabulary: v }) => (
            <li key={v.id}>
              <Link
                href={`/vocabulary/${v.id}`}
                className="border-border bg-surface hover:bg-surface-muted flex items-center gap-4 rounded-[var(--radius-card)] border-2 p-4"
              >
                <span lang="zh" className="hanzi text-3xl">
                  {v.simplified}
                </span>
                <span className="min-w-0">
                  <span className="block font-bold">{v.pinyin}</span>
                  <span className="text-muted-foreground block truncate text-sm">{v.meaning}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {newCharacters.length > 0 ? (
        <section aria-labelledby="chars">
          <h2 id="chars" className="mb-1 text-xl font-extrabold">
            New characters
          </h2>
          <p className="text-muted-foreground mb-3 text-sm">
            Tap a character to watch its stroke order.
          </p>
          <ul className="flex flex-wrap gap-2">
            {newCharacters.map(({ character: c }) => (
              <li key={c.hanzi}>
                <Link
                  href={`/characters/${encodeURIComponent(c.hanzi)}`}
                  className="border-border bg-surface hover:bg-surface-muted flex w-20 flex-col items-center rounded-2xl border-2 py-2"
                  aria-label={`${c.hanzi}, ${c.pinyin}, ${c.meaning}`}
                >
                  <span lang="zh" className="hanzi text-3xl">
                    {c.hanzi}
                  </span>
                  <span className="text-muted-foreground text-xs font-bold">{c.pinyin}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lesson.unit.level.curriculum.verification !== "VERIFIED" ? (
        <Card className="text-muted-foreground text-sm">
          <CardTitle className="mb-1 text-sm">About this content</CardTitle>
          Pinyin and meanings are provisional and still being reviewed by a teacher.
        </Card>
      ) : null}
    </div>
  );
}
