import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getLearningPath } from "@/features/curriculum/queries";

export const metadata: Metadata = { title: "Learning path" };

export default async function LearnPage() {
  await requireUser();
  const curricula = await getLearningPath();

  if (curricula.length === 0) {
    return (
      <div className="py-16 text-center">
        <BookOpen className="text-muted-foreground mx-auto mb-3 size-10" aria-hidden />
        <h1 className="text-2xl font-black">No lessons yet</h1>
        <p className="text-muted-foreground">Lessons will appear here once they are published.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {curricula.map((curriculum) => (
        <section key={curriculum.id} aria-labelledby={`c-${curriculum.id}`}>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h1 id={`c-${curriculum.id}`} className="text-3xl font-black">
              {curriculum.name}
            </h1>
            {curriculum.verification !== "VERIFIED" ? (
              <Badge
                variant="warning"
                title="This content has not yet been reviewed by a qualified teacher."
              >
                Provisional content
              </Badge>
            ) : null}
          </div>

          {curriculum.levels.map((level) => (
            <div key={level.id} className="flex flex-col gap-6">
              {level.units.map((unit, unitIndex) => (
                <div key={unit.id}>
                  <p className="text-primary text-xs font-extrabold tracking-wider uppercase">
                    {level.name} · Unit {unitIndex + 1}
                  </p>
                  <h2 className="text-xl font-extrabold">{unit.title}</h2>
                  {unit.description ? (
                    <p className="text-muted-foreground mb-3 text-sm">{unit.description}</p>
                  ) : null}
                  <ol className="grid gap-3 sm:grid-cols-2">
                    {unit.lessons.map((lesson, lessonIndex) => (
                      <li key={lesson.id}>
                        <Card className="flex h-full flex-col gap-2 p-4">
                          <div className="flex items-baseline justify-between gap-2">
                            <h3 className="font-extrabold">
                              {lessonIndex + 1}. {lesson.title}
                            </h3>
                            <span className="text-muted-foreground text-xs whitespace-nowrap">
                              {lesson._count.vocabulary} words
                            </span>
                          </div>
                          <p lang="zh" className="hanzi text-foreground text-2xl tracking-widest">
                            {lesson.characters.map((c) => c.character.hanzi).join("")}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {lesson.characters.length} new characters · {lesson._count.exercises}{" "}
                            exercises
                          </p>
                        </Card>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
      <p className="text-muted-foreground text-xs">
        Lesson practice opens in the next milestone. Stroke data: Make Me a Hanzi via
        hanzi-writer-data (Arphic Public License).
      </p>
    </div>
  );
}
