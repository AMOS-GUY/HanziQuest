"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/form-field";
import {
  resetPasswordAction,
  type ResetLinkState,
} from "@/features/account/password-reset-actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<ResetLinkState, FormData>(
    resetPasswordAction.bind(null, token),
    {},
  );
  // Keep the token out of the address bar, browser history and history sync once the page has
  // it (D-047). The form keeps it in memory; reloading asks the learner to open the link again.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  if (state.ok) {
    return (
      <div role="status" className="bg-accent text-accent-foreground rounded-xl p-4">
        <p className="font-bold">Password changed.</p>
        <Link href="/login" className="text-primary mt-2 inline-block font-bold hover:underline">
          Log in with your new password
        </Link>
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.message ? <Alert variant="error">{state.message}</Alert> : null}
      <FormField
        id="newPassword"
        label="New password"
        hint="At least 10 characters"
        error={state.fieldErrors?.newPassword?.[0]}
      >
        <Input name="newPassword" type="password" required autoComplete="new-password" />
      </FormField>
      <FormField
        id="confirmPassword"
        label="Repeat new password"
        error={state.fieldErrors?.confirmPassword?.[0]}
      >
        <Input name="confirmPassword" type="password" required autoComplete="new-password" />
      </FormField>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
