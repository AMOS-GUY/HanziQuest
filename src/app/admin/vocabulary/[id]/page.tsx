import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminBack, RevisionList } from "@/components/admin/revision-list";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { updateVocabularyAction } from "@/features/administration/curriculum-actions";
import { vocabularyFields } from "@/features/administration/field-specs";

export const metadata = { title: "Word" };

export default async function WordPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("curriculum:read");
  const { id } = await params;
  const v = await prisma.vocabulary.findUnique({
    where: { id },
    include: {
      lessons: { include: { lesson: { select: { id: true, title: true } } } },
      characters: {
        orderBy: { position: "asc" },
        include: { character: { select: { id: true, hanzi: true } } },
      },
    },
  });
  if (!v) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <AdminBack href="/admin/vocabulary" label="Vocabulary" />
        <div className="flex flex-wrap items-center gap-3">
          <h1 lang="zh" className="hanzi text-4xl">
            {v.simplified}
          </h1>
          <span className="text-xl font-bold">{v.pinyin}</span>
          <Badge variant={v.verification === "VERIFIED" ? "default" : "warning"}>
            {v.verification}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Characters:{" "}
          {v.characters.map((c) => (
            <Link
              key={c.character.id}
              href={`/admin/characters/${c.character.id}`}
              className="mr-1 underline"
            >
              <span lang="zh" className="hanzi">
                {c.character.hanzi}
              </span>
            </Link>
          ))}{" "}
          · Lessons:{" "}
          {v.lessons.length === 0
            ? "none"
            : v.lessons.map((l) => (
                <Link
                  key={l.lesson.id}
                  href={`/admin/lessons/${l.lesson.id}`}
                  className="mr-2 underline"
                >
                  {l.lesson.title}
                </Link>
              ))}
        </p>
        <p className="text-muted-foreground text-xs">
          The written form and pinyin identify the word and can&apos;t be changed. Create a new word
          instead.
        </p>
      </div>
      {user.permissions.has("curriculum:write") ? (
        <Card>
          <CardTitle className="mb-4">Details</CardTitle>
          <AdminForm
            action={updateVocabularyAction.bind(null, v.id)}
            fields={vocabularyFields(v)}
          />
        </Card>
      ) : null}
      <RevisionList entityType="Vocabulary" entityId={v.id} />
    </div>
  );
}
