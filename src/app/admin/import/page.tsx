import { Card, CardDescription } from "@/components/ui/card";
import { requirePagePermission } from "@/lib/auth/session";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import content" };

export default async function ImportPage() {
  await requirePagePermission("content:import");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-black">Import content</h1>
        <p className="text-muted-foreground text-sm">
          Uses the same validator and importer as <code>npm run content:import</code>. Imports are
          idempotent: records are matched on slugs, characters and word+pinyin, nothing is deleted,
          and new lessons arrive as drafts. Preview them, then publish from the lesson editor.
        </p>
      </div>
      <Card>
        <CardDescription className="mb-4">
          Format: see <code>docs/CURRICULUM.md</code> and <code>content/hsk1-starter.json</code>.
          Maximum 2 MB.
        </CardDescription>
        <ImportForm />
      </Card>
    </div>
  );
}
