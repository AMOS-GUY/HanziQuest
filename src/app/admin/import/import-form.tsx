"use client";

import { startTransition, useActionState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  importContentAction,
  validateImportAction,
  type FormState,
} from "@/features/administration/curriculum-actions";
import { cn } from "@/lib/utilities/cn";

function Buttons({ pending }: { pending: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" name="$intent" value="validate" variant="secondary" disabled={pending}>
        Validate
      </Button>
      <Button type="submit" name="$intent" value="import" disabled={pending}>
        {pending ? "Working…" : "Import as drafts"}
      </Button>
    </div>
  );
}

async function dispatch(state: FormState, formData: FormData): Promise<FormState> {
  return formData.get("$intent") === "import"
    ? importContentAction(state, formData)
    : validateImportAction(state, formData);
}

/** Paste or choose a curriculum JSON file, validate it, then import new lessons as drafts. */
export function ImportForm() {
  const [state, action, pending] = useActionState(dispatch, {});
  const text = useRef<HTMLTextAreaElement>(null);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        const data = new FormData(event.currentTarget, submitter);
        startTransition(() => action(data));
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="import-file">Content file (.json)</Label>
        <input
          id="import-file"
          type="file"
          accept="application/json,.json"
          className="text-sm"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file && text.current) text.current.value = await file.text();
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="import-content">Or paste the JSON</Label>
        <textarea
          id="import-content"
          ref={text}
          name="content"
          rows={12}
          spellCheck={false}
          className="border-border bg-surface focus-visible:border-primary w-full rounded-xl border-2 px-3 py-2 font-mono text-xs focus-visible:outline-none"
        />
      </div>
      <Buttons pending={pending} />
      {state.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={cn("text-sm font-bold", state.ok ? "text-primary" : "text-danger")}
        >
          {state.message}
        </p>
      ) : null}
      {state.details?.length ? (
        <ul className="bg-surface-muted max-h-80 overflow-auto rounded-xl p-3 text-sm">
          {state.details.map((d, i) => (
            <li key={i} className={d.startsWith("Error") ? "text-danger" : undefined}>
              {d}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
