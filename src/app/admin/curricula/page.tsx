import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { AdminForm, LICENSE_OPTIONS } from "@/components/admin/admin-form";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { createCurriculumAction } from "@/features/administration/curriculum-actions";

export const metadata = { title: "Curricula" };

export default async function CurriculaPage() {
  const user = await requirePagePermission("curriculum:read");
  const canWrite = user.permissions.has("curriculum:write");
  const curricula = await prisma.curriculum.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      levels: { orderBy: { level: "asc" }, include: { _count: { select: { units: true } } } },
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-black">Curricula</h1>
        <p className="text-muted-foreground text-sm">
          Curricula hold HSK levels, units and lessons. Content is only shown as official when its
          verification is “Verified”.
        </p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {curricula.map((c) => (
          <li key={c.id}>
            <Card className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/admin/curricula/${c.id}`}
                  className="text-lg font-extrabold hover:underline"
                >
                  {c.name}
                </Link>
                <Badge variant="muted">
                  {c.framework} · {c.version}
                </Badge>
                <Badge variant={c.verification === "VERIFIED" ? "default" : "warning"}>
                  {c.verification}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                {c.levels.length === 0
                  ? "No levels yet"
                  : c.levels.map((l) => `Level ${l.level}: ${l._count.units} units`).join(" · ")}
              </p>
            </Card>
          </li>
        ))}
      </ul>
      {canWrite ? (
        <Card>
          <CardTitle className="mb-4">New curriculum</CardTitle>
          <AdminForm
            action={createCurriculumAction}
            submitLabel="Create curriculum"
            fields={[
              { name: "name", label: "Name", required: true },
              { name: "slug", label: "Slug", required: true, help: "Lowercase, e.g. hsk3-core" },
              {
                name: "framework",
                label: "Framework",
                type: "select",
                options: [
                  { value: "HSK_3_0", label: "HSK 3.0" },
                  { value: "HSK_2_0", label: "HSK 2.0" },
                  { value: "CUSTOM", label: "Custom" },
                ],
              },
              { name: "version", label: "Version", required: true, help: "e.g. 2026.1" },
              {
                name: "source",
                label: "Source",
                required: true,
                wide: true,
                help: "Where the content comes from",
              },
              { name: "licenseStatus", label: "License", type: "select", options: LICENSE_OPTIONS },
              { name: "description", label: "Description", type: "textarea", rows: 2 },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}
