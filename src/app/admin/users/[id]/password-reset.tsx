"use client";

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/form-field";
import {
  issuePasswordResetAction,
  type ResetLinkState,
} from "@/features/account/password-reset-actions";

export function PasswordResetLink({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState<ResetLinkState, FormData>(
    issuePasswordResetAction.bind(null, userId),
    {},
  );
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <FormField
          id="reset-reason"
          label="Reason"
          hint="e.g. Learner asked by message on 11 Nov"
          error={state.fieldErrors?.reason?.[0]}
        >
          <Input name="reason" required maxLength={300} />
        </FormField>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Creating…" : "Create reset link"}
        </Button>
      </form>
      {state.message && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
      {state.link ? (
        <div role="status" className="bg-accent text-accent-foreground rounded-xl p-4">
          <p className="font-bold">{state.message}</p>
          <p className="mt-2 font-mono text-sm break-all">{state.link}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(state.link!);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Link copied" : "Copy link"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
