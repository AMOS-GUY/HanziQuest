import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PenLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getVocabularyForLearner } from "@/features/learning/lesson-data";

export const metadata: Metadata = { title: "Word" };

export default async function VocabularyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const word = await getVocabularyForLearner((await params).id);
  if (!word || word.lessons.length === 0) notFound();
  const lesson = word.lessons[0]!.lesson;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/learn/${lesson.id}`}
        className="text-primary flex items-center gap-1 text-sm font-bold"
      >
        <ArrowLeft className="size-4" aria-hidden /> {lesson.title}
      </Link>

      <Card className="flex flex-col items-center gap-1 py-8 text-center">
        <p lang="zh" className="hanzi text-7xl">
          {word.simplified}
        </p>
        <p className="text-2xl font-black">{word.pinyin}</p>
        <p className="text-muted-foreground text-lg">{word.meaning}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-1">
          {word.partOfSpeech ? <Badge variant="muted">{word.partOfSpeech}</Badge> : null}
          {word.verification !== "VERIFIED" ? <Badge variant="warning">Provisional</Badge> : null}
        </div>
        {word.audioUrl ? (
          <audio controls src={word.audioUrl} className="mt-3">
            Your browser cannot play audio.
          </audio>
        ) : null}
      </Card>

      {word.exampleZh ? (
        <section aria-labelledby="example">
          <h2 id="example" className="mb-2 text-xl font-extrabold">
            Example
          </h2>
          <Card>
            <p lang="zh" className="hanzi text-xl">
              {word.exampleZh}
            </p>
            {word.examplePinyin ? <p className="text-sm font-bold">{word.examplePinyin}</p> : null}
            {word.exampleEn ? (
              <p className="text-muted-foreground text-sm">{word.exampleEn}</p>
            ) : null}
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="characters">
        <h2 id="characters" className="mb-2 text-xl font-extrabold">
          Characters
        </h2>
        <ul className="flex flex-col gap-2">
          {word.characters.map(({ character: c }, i) => (
            <li key={`${c.hanzi}-${i}`}>
              <Link
                href={`/characters/${encodeURIComponent(c.hanzi)}`}
                className="border-border bg-surface hover:bg-surface-muted flex items-center gap-4 rounded-[var(--radius-card)] border-2 p-3"
              >
                <span lang="zh" className="hanzi text-4xl">
                  {c.hanzi}
                </span>
                <span>
                  <span className="block font-bold">{c.pinyin}</span>
                  <span className="text-muted-foreground block text-sm">
                    {c.meaning}
                    {c.strokeCount ? ` · ${c.strokeCount} strokes` : ""}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <Button asChild size="lg" className="self-start">
        <Link href={`/learn/${lesson.id}`}>
          <PenLine aria-hidden /> Practise in “{lesson.title}”
        </Link>
      </Button>
    </div>
  );
}
