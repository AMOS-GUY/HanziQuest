import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Lock, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WordAudio } from "@/components/vocabulary/word-audio";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/database/prisma";
import { getVocabularyExplorer } from "@/features/learning/vocabulary-explorer";
import { MAX_QUERY_LENGTH, parseExplorerFilter } from "@/features/learning/vocabulary-search";

export const metadata: Metadata = { title: "Your words" };

const SELECT =
  "border-border bg-surface text-foreground focus-visible:border-primary h-11 w-full rounded-xl border-2 px-3 focus-visible:outline-none";

/**
 * Vocabulary Explorer (M16.1): the words in lessons the learner has reached, searchable and
 * filterable by lesson. Server-rendered from the learner's own lesson states; locked lessons'
 * words are never sent. A plain GET form, so it works without JavaScript and keeps URLs
 * shareable for the same learner.
 */
export default async function VocabularyExplorerPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; lesson?: string }>;
}) {
  const user = await requireUser();
  const filter = parseExplorerFilter(await searchParams);
  const explorer = await getVocabularyExplorer(prisma, user.id, filter);
  const filtered = Boolean(filter.q || filter.lessonId);
  const groups = explorer.lessons
    .map((lesson) => ({ lesson, words: explorer.words.filter((w) => w.lessonId === lesson.id) }))
    .filter((g) => g.words.length > 0);
  const anyProvisional = explorer.words.some((w) => w.provisional);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-black">Your words</h1>
        <p className="text-muted-foreground">
          Every word from the lessons you&apos;ve reached. Tap one for its characters and stroke
          order.
        </p>
      </div>

      {explorer.totalReached > 0 ? (
        <form
          role="search"
          aria-label="Your words"
          method="get"
          className="grid gap-3 sm:grid-cols-[1fr_minmax(0,14rem)_auto] sm:items-end"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vocab-q">Search</Label>
            <Input
              id="vocab-q"
              name="q"
              type="search"
              defaultValue={filter.q ?? ""}
              maxLength={MAX_QUERY_LENGTH}
              placeholder="你好, ni hao or hello"
              autoComplete="off"
              enterKeyHint="search"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vocab-lesson">Lesson</Label>
            <select
              id="vocab-lesson"
              name="lesson"
              defaultValue={filter.lessonId ?? ""}
              className={SELECT}
            >
              <option value="">All your lessons</option>
              {explorer.lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" className="sm:self-end">
            <Search aria-hidden /> Search
          </Button>
        </form>
      ) : null}

      <p role="status" className="text-muted-foreground text-sm font-bold">
        {explorer.totalReached === 0
          ? null
          : filtered
            ? `${explorer.words.length} of ${explorer.totalReached} words`
            : `${explorer.totalReached} word${explorer.totalReached === 1 ? "" : "s"}`}
      </p>

      {explorer.totalReached === 0 ? (
        <Card className="flex items-start gap-3">
          <BookOpen className="text-primary mt-0.5 size-6 shrink-0" aria-hidden />
          <div>
            <CardTitle className="text-base">No words yet</CardTitle>
            <CardDescription>
              Words appear here as you reach lessons on your learning path.
            </CardDescription>
            <Button asChild size="sm" className="mt-3">
              <Link href="/learn">Open the learning path</Link>
            </Button>
          </div>
        </Card>
      ) : explorer.words.length === 0 ? (
        <Card className="flex flex-col gap-2">
          <CardTitle className="text-base">No matching words</CardTitle>
          <CardDescription>
            {filter.q
              ? `Nothing in your lessons matches “${filter.q}”.`
              : "That lesson has no words you can see yet."}{" "}
            Try pinyin without tones, or an English meaning.
          </CardDescription>
          <Button asChild size="sm" variant="secondary" className="self-start">
            <Link href="/vocabulary">Show all your words</Link>
          </Button>
        </Card>
      ) : (
        groups.map(({ lesson, words }) => (
          <section key={lesson.id} aria-labelledby={`lesson-${lesson.id}`}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3">
              <h2 id={`lesson-${lesson.id}`} className="text-xl font-extrabold">
                {lesson.title}
              </h2>
              <Link
                href={`/learn/${lesson.id}`}
                className="text-primary text-sm font-bold underline-offset-2 hover:underline"
              >
                {lesson.unitTitle} · open lesson
              </Link>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {words.map((w) => (
                <li key={w.id}>
                  <Link
                    href={`/vocabulary/${w.id}`}
                    className="border-border bg-surface hover:bg-surface-muted focus-visible:border-primary flex min-h-16 items-center gap-4 rounded-[var(--radius-card)] border-2 p-4 focus-visible:outline-none"
                  >
                    <span lang="zh" className="hanzi shrink-0 text-3xl">
                      {w.simplified}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">{w.pinyin}</span>
                      <span className="text-muted-foreground block text-sm break-words">
                        {w.meaning}
                      </span>
                    </span>
                    {w.hsk20Level ? (
                      <Badge variant="muted" className="shrink-0">
                        HSK {w.hsk20Level}
                      </Badge>
                    ) : null}
                  </Link>
                  <WordAudio src={w.audioUrl} word={w.simplified} className="mt-1" />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {explorer.moreToUnlock ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Lock className="size-4 shrink-0" aria-hidden />
          More words unlock as you continue the learning path.
        </p>
      ) : null}
      {anyProvisional ? (
        <p className="text-muted-foreground text-xs">
          Provisional content: meanings and pinyin haven&apos;t been reviewed by a teacher yet.
        </p>
      ) : null}
    </div>
  );
}
