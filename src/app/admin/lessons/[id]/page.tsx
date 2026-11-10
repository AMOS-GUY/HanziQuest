import Link from "next/link";
import { notFound } from "next/navigation";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { AdminForm } from "@/components/admin/admin-form";
import { ActionButton } from "@/components/admin/action-button";
import { AdminBack, RevisionList } from "@/components/admin/revision-list";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import {
  createCustomExerciseAction,
  removeCustomExerciseAction,
  setLessonWordsAction,
  updateLessonAction,
} from "@/features/administration/curriculum-actions";
import { CUSTOM_EXERCISE_PREFIX } from "@/features/curriculum/import-content";
import { LessonStatusToggle } from "../lesson-status-toggle";

export const metadata = { title: "Lesson" };

const TYPE_LABEL: Record<string, string> = {
  GUIDED_STROKE: "Guided strokes",
  MEANING_TO_HANZI: "Meaning → write",
  PINYIN_TO_HANZI: "Pinyin → write",
  FREEHAND_WRITING: "Write from memory",
  CHARACTER_RECONSTRUCTION: "Reconstruction",
  LISTENING_TO_WRITING: "Listening",
};

function promptSummary(prompt: unknown) {
  const p = prompt as Record<string, string>;
  return p.meaning ?? p.pinyin ?? p.hanzi ?? "";
}

export default async function AdminLessonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("curriculum:read");
  const canWrite = user.permissions.has("curriculum:write");
  const canPublish = user.permissions.has("curriculum:publish");
  const { id } = await params;
  const lesson = await prisma.lesson.findUnique({
    where: { id },
    include: {
      unit: { select: { id: true, title: true, level: { select: { name: true } } } },
      vocabulary: { orderBy: { position: "asc" }, include: { vocabulary: true } },
      characters: { orderBy: { position: "asc" }, include: { character: true } },
      exercises: { orderBy: { position: "asc" }, include: { exercise: true } },
    },
  });
  if (!lesson) notFound();
  const wordLines = lesson.vocabulary
    .map((v) => `${v.vocabulary.simplified} | ${v.vocabulary.pinyin}`)
    .join("\n");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <AdminBack href={`/admin/units/${lesson.unit.id}`} label={lesson.unit.title} />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-black">{lesson.title}</h1>
          <Badge variant="muted">content v{lesson.contentVersion}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {lesson.unit.level.name} · {lesson.unit.title} · lesson {lesson.position} · slug{" "}
          {lesson.slug}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {canPublish ? (
            <LessonStatusToggle lessonId={lesson.id} status={lesson.status} />
          ) : (
            <Badge variant={lesson.status === "PUBLISHED" ? "default" : "muted"}>
              {lesson.status}
            </Badge>
          )}
          <Button asChild size="sm" variant="secondary">
            <Link href={`/admin/lessons/${lesson.id}/preview`}>
              <Eye aria-hidden /> Preview as learner
            </Link>
          </Button>
        </div>
      </div>

      {canWrite ? (
        <Card>
          <CardTitle className="mb-4">Details</CardTitle>
          <AdminForm
            action={updateLessonAction.bind(null, lesson.id)}
            fields={[
              { name: "title", label: "Title", defaultValue: lesson.title, required: true },
              {
                name: "position",
                label: "Position in unit",
                type: "number",
                defaultValue: lesson.position,
                required: true,
              },
              {
                name: "description",
                label: "Description",
                type: "textarea",
                rows: 2,
                defaultValue: lesson.description,
              },
            ]}
          />
        </Card>
      ) : null}

      <Card>
        <CardTitle>Words</CardTitle>
        <CardDescription className="mb-4">
          One word per line as <code>你好 | nǐ hǎo</code>, in teaching order. Words must exist in{" "}
          <Link href="/admin/vocabulary" className="text-primary font-bold underline">
            Vocabulary
          </Link>
          . Saving regenerates the lesson&apos;s characters and exercises; hand-written exercises
          are kept.
        </CardDescription>
        {canWrite ? (
          <AdminForm
            action={setLessonWordsAction.bind(null, lesson.id)}
            submitLabel="Save words"
            fields={[
              {
                name: "words",
                label: "Words",
                type: "textarea",
                rows: 6,
                defaultValue: wordLines,
                hanzi: true,
              },
            ]}
          />
        ) : (
          <pre lang="zh" className="hanzi text-sm">
            {wordLines}
          </pre>
        )}
        <p className="mt-3 text-sm">
          Characters:{" "}
          <span lang="zh" className="hanzi text-lg">
            {lesson.characters.map((c) => c.character.hanzi).join(" ") || "—"}
          </span>{" "}
          <span className="text-muted-foreground">
            ({lesson.characters.filter((c) => c.isNew).length} new)
          </span>
        </p>
      </Card>

      <Card>
        <CardTitle className="mb-3">Exercises ({lesson.exercises.length})</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-muted-foreground border-border border-b-2">
              <tr>
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Prompt</th>
                <th className="py-2 pr-3">Answer</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {lesson.exercises.map(({ exercise: e, position }) => {
                const custom = e.key.startsWith(CUSTOM_EXERCISE_PREFIX);
                return (
                  <tr key={e.id} className="border-border border-b last:border-0">
                    <td className="py-2 pr-3">{position}</td>
                    <td className="py-2 pr-3">
                      {TYPE_LABEL[e.type]}
                      {custom ? (
                        <Badge className="ml-1" variant="muted">
                          custom
                        </Badge>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">{promptSummary(e.prompt)}</td>
                    <td lang="zh" className="hanzi py-2 pr-3 text-lg">
                      {e.expectedAnswer}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={e.status === "PUBLISHED" ? "default" : "muted"}>
                        {e.status}
                      </Badge>
                    </td>
                    <td className="flex items-center gap-1 py-2">
                      <Link
                        href={`/admin/exercises/${e.id}?lesson=${lesson.id}`}
                        className="text-primary font-bold"
                      >
                        {canWrite ? "Edit" : "View"}
                      </Link>
                      {canWrite && custom ? (
                        <ActionButton
                          action={removeCustomExerciseAction.bind(null, lesson.id, e.id)}
                          label="Remove"
                          confirm="Remove this exercise from the lesson?"
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canWrite ? (
          <details className="mt-4">
            <summary className="text-primary cursor-pointer text-sm font-bold">
              Add a hand-written exercise
            </summary>
            <AdminForm
              className="mt-3"
              action={createCustomExerciseAction}
              submitLabel="Add exercise"
              resetOnSuccess
              fields={[
                { name: "lessonId", label: "", type: "hidden", defaultValue: lesson.id },
                {
                  name: "type",
                  label: "Type",
                  type: "select",
                  options: [
                    { value: "MEANING_TO_HANZI", label: "Meaning → write" },
                    { value: "PINYIN_TO_HANZI", label: "Pinyin → write" },
                    { value: "FREEHAND_WRITING", label: "Write one character from memory" },
                  ],
                },
                {
                  name: "answer",
                  label: "Answer (characters to write)",
                  required: true,
                  hanzi: true,
                },
                {
                  name: "promptText",
                  label: "Prompt",
                  required: true,
                  help: "The meaning, or pinyin with tone marks",
                },
                { name: "hint", label: "Hint (optional)" },
                { name: "difficulty", label: "Difficulty (1–5)", type: "number", defaultValue: 2 },
              ]}
            />
          </details>
        ) : null}
      </Card>

      <RevisionList entityType={["Lesson", "LessonWords"]} entityId={lesson.id} />
    </div>
  );
}
