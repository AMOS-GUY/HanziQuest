"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/features/administration/curriculum-actions";

/** A single-button server action form (e.g. "Remove"), with an optional confirmation. */
export function ActionButton({
  action,
  label,
  confirm,
}: {
  action: (state: FormState) => Promise<FormState>;
  label: string;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="inline-flex items-center gap-2"
    >
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? "…" : label}
      </Button>
      {state.message && !state.ok ? (
        <span role="alert" className="text-danger text-xs font-semibold">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
