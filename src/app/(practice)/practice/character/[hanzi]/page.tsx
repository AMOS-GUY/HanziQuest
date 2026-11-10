import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getCharacterPractice } from "@/features/learning/lesson-data";
import { PracticeRunner } from "@/components/lessons/practice-runner";

export const metadata: Metadata = { title: "Character practice" };

export default async function CharacterPracticePage({
  params,
}: {
  params: Promise<{ hanzi: string }>;
}) {
  await requireUser();
  const hanzi = decodeURIComponent((await params).hanzi);
  if ([...hanzi].length !== 1) notFound();
  const payload = await getCharacterPractice(hanzi);
  if (!payload) notFound();
  return <PracticeRunner payload={payload} exitHref={`/characters/${encodeURIComponent(hanzi)}`} />;
}
