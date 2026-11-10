import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { LessonStatusToggle } from "./lesson-status-toggle";

export const metadata = { title: "Lessons" };

export default async function AdminLessonsPage() {
  const user = await requirePagePermission("curriculum:read");
  const canPublish = user.permissions.has("curriculum:publish");
  const curricula = await prisma.curriculum.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      levels: {
        orderBy: { level: "asc" },
        include: {
          units: {
            orderBy: { position: "asc" },
            include: {
              lessons: {
                orderBy: { position: "asc" },
                include: {
                  _count: { select: { vocabulary: true, characters: true, exercises: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (curricula.length === 0) {
    return (
      <div>
        <h1 className="mb-2 text-3xl font-black">Lessons</h1>
        <p className="text-muted-foreground">
          No curriculum has been imported. Run `npm run content:import`.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-3xl font-black">Lessons</h1>
      {curricula.map((c) => (
        <section key={c.id} className="mb-8">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-extrabold">{c.name}</h2>
            <Badge variant="muted">
              {c.framework} · {c.version}
            </Badge>
            <Badge variant={c.verification === "VERIFIED" ? "default" : "warning"}>
              {c.verification}
            </Badge>
          </div>
          <div className="border-border bg-surface overflow-x-auto rounded-[var(--radius-card)] border-2">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-border text-muted-foreground border-b-2">
                <tr>
                  <th className="px-4 py-2">Unit / lesson</th>
                  <th className="px-4 py-2">Words</th>
                  <th className="px-4 py-2">Characters</th>
                  <th className="px-4 py-2">Exercises</th>
                  <th className="px-4 py-2">Version</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {c.levels.flatMap((level) =>
                  level.units.flatMap((unit) =>
                    unit.lessons.map((lesson) => (
                      <tr key={lesson.id} className="border-border border-b last:border-0">
                        <td className="px-4 py-2">
                          <span className="text-muted-foreground">{unit.title} › </span>
                          <Link
                            href={`/admin/lessons/${lesson.id}`}
                            className="font-bold hover:underline"
                          >
                            {lesson.title}
                          </Link>
                        </td>
                        <td className="px-4 py-2">{lesson._count.vocabulary}</td>
                        <td className="px-4 py-2">{lesson._count.characters}</td>
                        <td className="px-4 py-2">{lesson._count.exercises}</td>
                        <td className="px-4 py-2">v{lesson.contentVersion}</td>
                        <td className="px-4 py-2">
                          {canPublish ? (
                            <LessonStatusToggle lessonId={lesson.id} status={lesson.status} />
                          ) : (
                            <Badge variant={lesson.status === "PUBLISHED" ? "default" : "muted"}>
                              {lesson.status}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    )),
                  ),
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
