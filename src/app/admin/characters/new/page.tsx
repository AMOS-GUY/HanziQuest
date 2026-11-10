import { Card } from "@/components/ui/card";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminBack } from "@/components/admin/revision-list";
import { requirePagePermission } from "@/lib/auth/session";
import { createCharacterAction } from "@/features/administration/curriculum-actions";
import { characterFields } from "@/features/administration/field-specs";

export const metadata = { title: "New character" };

export default async function NewCharacterPage() {
  await requirePagePermission("curriculum:write");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <AdminBack href="/admin/characters" label="Characters" />
        <h1 className="text-3xl font-black">New character</h1>
      </div>
      <Card>
        <AdminForm
          action={createCharacterAction}
          submitLabel="Create character"
          fields={characterFields({}, true)}
        />
      </Card>
    </div>
  );
}
