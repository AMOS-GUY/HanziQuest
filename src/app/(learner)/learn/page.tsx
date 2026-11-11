import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, CheckCircle2, CircleDot, Lock, SkipForward } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { requireUser } from "@/lib/auth/session";
import { getLearnerPath } from "@/features/curriculum/queries";
import type { LessonState } from "@/features/progression/lesson-states";
import { cn } from "@/lib/utilities/cn";

export const metadata: Metadata = { title: "Learning path" };

const STATE_META: Record<LessonState, { label: string; icon: typeof Lock | null }> = {
  LOCKED: { label: "Locked", icon: Lock },
  AVAILABLE: { label: "Start", icon: null },
  IN_PROGRESS: { label: "In progress", icon: CircleDot },
  COMPLETED: { label: "Completed", icon: CheckCircle2 },
  TESTED_OUT: { label: "Tested out", icon: SkipForward },
};

export default async function LearnPage() {
  const user = await requireUser();
  const { path: curricula, states, next, completed, total } = await getLearnerPath(user.id);

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
      <h1 className="sr-only">Learn</h1>
      {curricula.map((curriculum) => (
        <section key={curriculum.id} aria-labelledby={`c-${curriculum.id}`}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 id={`c-${curriculum.id}`} className="text-3xl font-black">
              {curriculum.name}
            </h2>
            {curriculum.verification !== "VERIFIED" ? (
              <Badge
                variant="warning"
                title="This content has not yet been reviewed by a qualified teacher."
              >
                Provisional content
              </Badge>
            ) : null}
          </div>
          <div className="mb-6 flex items-center gap-3">
            <ProgressBar value={completed} max={total} label="Lessons completed" />
            <span className="text-muted-foreground text-sm font-bold whitespace-nowrap">
              {completed}/{total} lessons
            </span>
          </div>

          {curriculum.levels.map((level) => (
            <div key={level.id} className="flex flex-col gap-6">
              {level.units.map((unit, unitIndex) => (
                <div key={unit.id}>
                  <p className="text-primary text-xs font-extrabold tracking-wider uppercase">
                    {level.name} · Unit {unitIndex + 1}
                  </p>
                  <h3 className="text-xl font-extrabold">{unit.title}</h3>
                  {unit.description ? (
                    <p className="text-muted-foreground mb-3 text-sm">{unit.description}</p>
                  ) : null}
                  <ol className="grid gap-3 sm:grid-cols-2">
                    {unit.lessons.map((lesson, lessonIndex) => {
                      const state = states.get(lesson.id) ?? "LOCKED";
                      const meta = STATE_META[state];
                      const Icon = meta.icon;
                      const isNext = next?.id === lesson.id;
                      return (
                        <li key={lesson.id}>
                          <Link
                            href={`/learn/${lesson.id}`}
                            className={cn(
                              "border-border bg-surface hover:bg-surface-muted flex h-full flex-col gap-2 rounded-[var(--radius-card)] border-2 p-4 transition-colors",
                              isNext && "border-primary shadow-[0_3px_0_0_var(--primary)]",
                              // Locked: dashed and muted, but text keeps full contrast.
                              state === "LOCKED" && "bg-surface-muted border-dashed",
                            )}
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <h4 className="font-extrabold">
                                {lessonIndex + 1}. {lesson.title}
                              </h4>
                              <span
                                className={cn(
                                  "text-muted-foreground flex items-center gap-1 text-xs font-bold whitespace-nowrap",
                                  (state === "COMPLETED" || state === "TESTED_OUT") &&
                                    "text-primary",
                                )}
                              >
                                {Icon ? <Icon className="size-4" aria-hidden /> : null}
                                {isNext && state === "AVAILABLE" ? "Up next" : meta.label}
                              </span>
                            </div>
                            <p lang="zh" className="hanzi text-foreground text-2xl tracking-widest">
                              {lesson.characters.map((c) => c.character.hanzi).join("")}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {lesson._count.vocabulary} words · {lesson.characters.length} new
                              characters · {lesson._count.exercises} exercises
                            </p>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
      <p className="text-muted-foreground text-xs">
        Stroke data: Make Me a Hanzi via hanzi-writer-data (Arphic Public License).
      </p>
    </div>
  );
}
