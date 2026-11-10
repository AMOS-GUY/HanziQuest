import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StrokeOrderPlayer } from "@/components/characters/stroke-order-player";
import { requireUser } from "@/lib/auth/session";
import { getCharacterForLearner } from "@/features/learning/lesson-data";

export const metadata: Metadata = { title: "Stroke order" };

export default async function CharacterPage({ params }: { params: Promise<{ hanzi: string }> }) {
  await requireUser();
  const hanzi = decodeURIComponent((await params).hanzi);
  if ([...hanzi].length !== 1) notFound();
  const character = await getCharacterForLearner(hanzi);
  if (!character) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-black">
          <span lang="zh" className="hanzi">
            {character.hanzi}
          </span>{" "}
          {character.pinyin}
        </h1>
        <p className="text-muted-foreground">
          {character.meaning}
          {character.strokeCount ? ` · ${character.strokeCount} strokes` : ""}
          {character.pinyinAlternatives.length > 0
            ? ` · also ${character.pinyinAlternatives.join(", ")}`
            : ""}
        </p>
      </div>

      {character.strokeData ? (
        <StrokeOrderPlayer hanzi={character.hanzi} data={character.strokeData} />
      ) : (
        <Card className="text-muted-foreground text-center">
          Stroke order data isn&apos;t available for this character yet.
        </Card>
      )}

      {character.strokeData ? (
        <Button asChild size="lg" className="self-center">
          <Link href={`/practice/character/${encodeURIComponent(character.hanzi)}`}>
            <PenLine aria-hidden /> Practise writing
          </Link>
        </Button>
      ) : null}

      {character.vocabulary.length > 0 ? (
        <section aria-labelledby="in-words">
          <h2 id="in-words" className="mb-2 text-xl font-extrabold">
            Used in
          </h2>
          <ul className="flex flex-wrap gap-2">
            {character.vocabulary.map(({ vocabulary: v }) => (
              <li key={v.id}>
                <Link
                  href={`/vocabulary/${v.id}`}
                  className="border-border bg-surface hover:bg-surface-muted flex items-baseline gap-2 rounded-2xl border-2 px-3 py-2"
                >
                  <span lang="zh" className="hanzi text-xl">
                    {v.simplified}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {v.pinyin} · {v.meaning}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-muted-foreground text-center text-xs">
        Stroke data: Make Me a Hanzi via hanzi-writer-data (Arphic Public License).
      </p>
    </div>
  );
}
