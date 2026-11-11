"use client";

import { useActionState, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/form-field";
import {
  createInviteAction,
  revokeInviteAction,
  type InviteFormState,
} from "@/features/invites/actions";

export function CreateInvite({ origin }: { origin: string }) {
  const [state, formAction, pending] = useActionState<InviteFormState, FormData>(
    createInviteAction,
    {},
  );
  const [copied, setCopied] = useState(false);
  const link = state.code ? `${origin}/register?invite=${encodeURIComponent(state.code)}` : "";

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
        <FormField
          id="label"
          label="For"
          hint="Who or what it is for, e.g. Pilot group A"
          error={state.fieldErrors?.label?.[0]}
        >
          <Input name="label" required maxLength={80} />
        </FormField>
        <FormField id="maxUses" label="Uses" error={state.fieldErrors?.maxUses?.[0]}>
          <Input name="maxUses" type="number" min={1} max={500} defaultValue={1} />
        </FormField>
        <FormField
          id="expiresInDays"
          label="Valid for (days)"
          error={state.fieldErrors?.expiresInDays?.[0]}
        >
          <Input name="expiresInDays" type="number" min={1} max={180} defaultValue={30} />
        </FormField>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create invite"}
        </Button>
      </form>
      {state.message && !state.ok ? <Alert variant="error">{state.message}</Alert> : null}
      {state.code ? (
        <div role="status" className="bg-accent text-accent-foreground rounded-xl p-4">
          <p className="font-bold">{state.message}</p>
          <p className="mt-2 font-mono text-xl font-black tracking-wider">{state.code}</p>
          <p className="mt-2 text-sm break-all">{link}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Link copied" : "Copy sign-up link"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function RevokeInvite({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Revoke this invite? Accounts already created keep working.")) return;
          startTransition(async () => {
            const result = await revokeInviteAction(id);
            setError(result.ok ? undefined : result.message);
          });
        }}
      >
        Revoke
      </Button>
      {error ? (
        <span role="alert" className="text-danger text-xs font-semibold">
          {error}
        </span>
      ) : null}
    </span>
  );
}
