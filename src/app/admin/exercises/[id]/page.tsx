import { notFound } from "next/navigation";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminBack, RevisionList } from "@/components/admin/revision-list";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { updateExerciseAction } from "@/features/administration/curriculum-actions";
import { promptFieldFor } from "@/features/administration/curriculum-admin";

export const metadata = { title: "Exercise" };

export default async function ExercisePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lesson?: string }>;
}) {
  const user = await requirePagePermission("curriculum:read");
  const { id } = await params;
  const { lesson } = await searchParams;
  const exercise = await prisma.exercise.findUnique({
    where: { id },
    include: { lessons: { include: { lesson: { select: { id: true, title: true } } } } },
  });
  if (!exercise) notFound();
  const field = promptFieldFor(exercise.type);
  const prompt = exercise.prompt as Record<string, string>;
  const backLesson = exercise.lessons.find((l) => l.lessonId === lesson) ?? exercise.lessons[0];

  return (
    <div className="flex flex-col gap-6">
      <div>
        {backLesson ? (
          <AdminBack
            href={`/admin/lessons/${backLesson.lesson.id}`}
            label={backLesson.lesson.title}
          />
        ) : null}
        <h1 className="text-3xl font-black">Exercise</h1>
        <p className="text-muted-foreground text-sm">
          {exercise.type} · key {exercise.key} · used in{" "}
          {exercise.lessons.map((l) => l.lesson.title).join(", ") || "no lessons"}
        </p>
      </div>
      <Card>
        <CardTitle>
          Answer:{" "}
          <span lang="zh" className="hanzi">
            {exercise.expectedAnswer}
          </span>
        </CardTitle>
        <CardDescription className="mb-4">
          The answer and the characters checked are fixed. To change them, edit the lesson&apos;s
          words or add a hand-written exercise. Setting an exercise to Draft hides it from learners.
        </CardDescription>
        {user.permissions.has("curriculum:write") ? (
          <AdminForm
            action={updateExerciseAction.bind(null, exercise.id)}
            fields={[
              {
                name: "promptText",
                label: field === "pinyin" ? "Prompt (pinyin)" : "Prompt (meaning)",
                defaultValue: prompt[field] ?? "",
                required: true,
              },
              { name: "hint", label: "Hint", defaultValue: exercise.hint },
              {
                name: "difficulty",
                label: "Difficulty (1–5)",
                type: "number",
                defaultValue: exercise.difficulty,
              },
              {
                name: "status",
                label: "Status",
                type: "select",
                defaultValue: exercise.status,
                options: [
                  { value: "PUBLISHED", label: "Published" },
                  { value: "DRAFT", label: "Draft (hidden)" },
                  { value: "ARCHIVED", label: "Archived (hidden)" },
                ],
              },
            ]}
          />
        ) : null}
      </Card>
      <RevisionList entityType="Exercise" entityId={exercise.id} />
    </div>
  );
}
