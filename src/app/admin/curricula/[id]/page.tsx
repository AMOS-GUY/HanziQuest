import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { AdminForm, LICENSE_OPTIONS } from "@/components/admin/admin-form";
import { AdminBack, RevisionList } from "@/components/admin/revision-list";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import {
  createLevelAction,
  createUnitAction,
  updateCurriculumAction,
  updateLevelAction,
} from "@/features/administration/curriculum-actions";

import { CurriculumStatus } from "./curriculum-status";

export const metadata = { title: "Curriculum" };

export default async function CurriculumPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("curriculum:read");
  const canWrite = user.permissions.has("curriculum:write");
  const { id } = await params;
  const c = await prisma.curriculum.findUnique({
    where: { id },
    include: {
      levels: {
        orderBy: { level: "asc" },
        include: {
          units: {
            orderBy: { position: "asc" },
            include: { _count: { select: { lessons: true } } },
          },
        },
      },
    },
  });
  if (!c) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <AdminBack href="/admin/curricula" label="Curricula" />
        <h1 className="text-3xl font-black">{c.name}</h1>
        <p className="text-muted-foreground text-sm">
          {c.framework} · version {c.version} · slug {c.slug}
        </p>
        <div className="mt-3">
          <CurriculumStatus
            curriculumId={c.id}
            status={c.status}
            canPublish={user.permissions.has("curriculum:publish")}
          />
        </div>
      </div>

      {canWrite ? (
        <Card>
          <CardTitle className="mb-4">Details</CardTitle>
          <AdminForm
            action={updateCurriculumAction.bind(null, c.id)}
            fields={[
              { name: "name", label: "Name", defaultValue: c.name, required: true },
              { name: "source", label: "Source", defaultValue: c.source, required: true },
              {
                name: "licenseStatus",
                label: "License",
                type: "select",
                options: LICENSE_OPTIONS,
                defaultValue: c.licenseStatus,
              },
              {
                name: "description",
                label: "Description",
                type: "textarea",
                rows: 2,
                defaultValue: c.description,
              },
            ]}
          />
        </Card>
      ) : null}

      {c.levels.map((level) => (
        <Card key={level.id} className="flex flex-col gap-4">
          <CardTitle>
            Level {level.level}: {level.name}
          </CardTitle>
          {canWrite ? (
            <AdminForm
              action={updateLevelAction.bind(null, level.id)}
              submitLabel="Save level"
              fields={[
                { name: "name", label: "Level name", defaultValue: level.name, required: true },
                { name: "description", label: "Description", defaultValue: level.description },
              ]}
            />
          ) : null}
          <div>
            <h3 className="mb-2 font-extrabold">Units</h3>
            {level.units.length === 0 ? (
              <p className="text-muted-foreground text-sm">No units yet.</p>
            ) : (
              <ol className="flex flex-col gap-1">
                {level.units.map((u) => (
                  <li key={u.id}>
                    <Link href={`/admin/units/${u.id}`} className="font-bold hover:underline">
                      {u.position}. {u.title}
                    </Link>{" "}
                    <span className="text-muted-foreground text-sm">
                      ({u._count.lessons} lessons)
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {canWrite ? (
            <details>
              <summary className="text-primary cursor-pointer text-sm font-bold">
                Add a unit
              </summary>
              <AdminForm
                className="mt-3"
                action={createUnitAction}
                submitLabel="Create unit"
                fields={[
                  { name: "levelId", label: "", type: "hidden", defaultValue: level.id },
                  { name: "title", label: "Title", required: true },
                  { name: "slug", label: "Slug", required: true },
                  { name: "description", label: "Description", wide: true },
                ]}
              />
            </details>
          ) : null}
        </Card>
      ))}

      {canWrite ? (
        <Card>
          <CardTitle className="mb-4">Add a level</CardTitle>
          <AdminForm
            action={createLevelAction}
            submitLabel="Add level"
            resetOnSuccess
            fields={[
              { name: "curriculumId", label: "", type: "hidden", defaultValue: c.id },
              { name: "level", label: "Level number", type: "number", required: true },
              { name: "name", label: "Name", required: true, help: "e.g. HSK 2" },
              { name: "description", label: "Description", wide: true },
            ]}
          />
        </Card>
      ) : null}

      <RevisionList entityType={["Curriculum"]} entityId={c.id} />
    </div>
  );
}
