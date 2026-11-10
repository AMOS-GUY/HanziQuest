import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminBack, RevisionList } from "@/components/admin/revision-list";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { createLessonAction, updateUnitAction } from "@/features/administration/curriculum-actions";

export const metadata = { title: "Unit" };

export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("curriculum:read");
  const canWrite = user.permissions.has("curriculum:write");
  const { id } = await params;
  const unit = await prisma.unit.findUnique({
    where: { id },
    include: {
      level: { include: { curriculum: { select: { id: true, name: true } } } },
      lessons: {
        orderBy: { position: "asc" },
        include: { _count: { select: { vocabulary: true, exercises: true } } },
      },
    },
  });
  if (!unit) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <AdminBack
          href={`/admin/curricula/${unit.level.curriculum.id}`}
          label={unit.level.curriculum.name}
        />
        <h1 className="text-3xl font-black">
          Unit {unit.position}: {unit.title}
        </h1>
        <p className="text-muted-foreground text-sm">
          {unit.level.name} · slug {unit.slug}
        </p>
      </div>
      {canWrite ? (
        <Card>
          <CardTitle className="mb-4">Details</CardTitle>
          <AdminForm
            action={updateUnitAction.bind(null, unit.id)}
            fields={[
              { name: "title", label: "Title", defaultValue: unit.title, required: true },
              {
                name: "position",
                label: "Position",
                type: "number",
                defaultValue: unit.position,
                required: true,
              },
              {
                name: "description",
                label: "Description",
                type: "textarea",
                rows: 2,
                defaultValue: unit.description,
              },
            ]}
          />
        </Card>
      ) : null}
      <Card>
        <CardTitle className="mb-3">Lessons</CardTitle>
        {unit.lessons.length === 0 ? (
          <p className="text-muted-foreground text-sm">No lessons yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {unit.lessons.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/admin/lessons/${l.id}`} className="font-bold hover:underline">
                  {l.position}. {l.title}
                </Link>
                <Badge variant={l.status === "PUBLISHED" ? "default" : "muted"}>{l.status}</Badge>
                <span className="text-muted-foreground text-sm">
                  {l._count.vocabulary} words · {l._count.exercises} exercises
                </span>
              </li>
            ))}
          </ol>
        )}
        {canWrite ? (
          <details className="mt-4">
            <summary className="text-primary cursor-pointer text-sm font-bold">
              Add a lesson
            </summary>
            <AdminForm
              className="mt-3"
              action={createLessonAction}
              submitLabel="Create lesson (draft)"
              fields={[
                { name: "unitId", label: "", type: "hidden", defaultValue: unit.id },
                { name: "title", label: "Title", required: true },
                { name: "slug", label: "Slug", required: true },
                { name: "description", label: "Description", wide: true },
              ]}
            />
          </details>
        ) : null}
      </Card>
      <RevisionList entityType="Unit" entityId={unit.id} />
    </div>
  );
}
