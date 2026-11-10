import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminBack, RevisionList } from "@/components/admin/revision-list";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { updateCharacterAction } from "@/features/administration/curriculum-actions";
import { characterFields } from "@/features/administration/field-specs";

export const metadata = { title: "Character" };

export default async function CharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("curriculum:read");
  const { id } = await params;
  const c = await prisma.character.findUnique({
    where: { id },
    include: {
      vocabulary: {
        include: { vocabulary: { select: { id: true, simplified: true, pinyin: true } } },
      },
      lessons: { include: { lesson: { select: { id: true, title: true } } } },
    },
  });
  if (!c) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <AdminBack href="/admin/characters" label="Characters" />
        <div className="flex flex-wrap items-center gap-3">
          <h1 lang="zh" className="hanzi text-5xl">
            {c.hanzi}
          </h1>
          <Badge variant={c.hasStrokeData ? "default" : "danger"}>
            {c.hasStrokeData ? `${c.strokeCount} strokes` : "No stroke data: can't be written"}
          </Badge>
          <Badge variant={c.verification === "VERIFIED" ? "default" : "warning"}>
            {c.verification}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          In words:{" "}
          {c.vocabulary.length === 0
            ? "none"
            : c.vocabulary.map((v) => (
                <Link
                  key={v.vocabulary.id}
                  href={`/admin/vocabulary/${v.vocabulary.id}`}
                  className="mr-2 underline"
                >
                  <span lang="zh" className="hanzi">
                    {v.vocabulary.simplified}
                  </span>
                </Link>
              ))}{" "}
          · In lessons: {c.lessons.map((l) => l.lesson.title).join(", ") || "none"}
        </p>
      </div>
      {user.permissions.has("curriculum:write") ? (
        <Card>
          <CardTitle className="mb-4">Details</CardTitle>
          <AdminForm
            action={updateCharacterAction.bind(null, c.id)}
            fields={characterFields({ ...c, pinyinAlternatives: c.pinyinAlternatives.join(", ") })}
          />
        </Card>
      ) : null}
      <RevisionList entityType="Character" entityId={c.id} />
    </div>
  );
}
