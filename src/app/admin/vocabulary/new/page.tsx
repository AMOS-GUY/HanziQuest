import { Card } from "@/components/ui/card";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminBack } from "@/components/admin/revision-list";
import { requirePagePermission } from "@/lib/auth/session";
import { createVocabularyAction } from "@/features/administration/curriculum-actions";
import { vocabularyFields } from "@/features/administration/field-specs";

export const metadata = { title: "New word" };

export default async function NewWordPage() {
  await requirePagePermission("curriculum:write");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <AdminBack href="/admin/vocabulary" label="Vocabulary" />
        <h1 className="text-3xl font-black">New word</h1>
        <p className="text-muted-foreground text-sm">
          Every character in the word must already exist. Add the word to a lesson from the lesson
          editor.
        </p>
      </div>
      <Card>
        <AdminForm
          action={createVocabularyAction}
          submitLabel="Create word"
          fields={vocabularyFields({}, true)}
        />
      </Card>
    </div>
  );
}
