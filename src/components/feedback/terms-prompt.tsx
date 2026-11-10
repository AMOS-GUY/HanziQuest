"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { acceptTermsAction } from "@/features/account/actions";

/** Asks an existing account to accept the current beta terms and privacy notice. */
export function TermsPrompt() {
  const [state, action, pending] = useActionState(acceptTermsAction, {});
  if (state.ok) return null;
  return (
    <div
      role="region"
      aria-label="Beta terms"
      className="bg-accent text-accent-foreground mb-6 flex flex-col gap-3 rounded-[var(--radius-card)] p-4 text-sm sm:flex-row sm:items-center"
    >
      <p className="flex-1">
        HanziQuest is now in public beta. Please read the{" "}
        <Link href="/terms" className="font-bold underline">
          beta terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="font-bold underline">
          privacy notice
        </Link>
        .
      </p>
      <form action={action}>
        <Button size="sm" type="submit" disabled={pending}>
          I agree
        </Button>
      </form>
      {state.message && !state.ok ? (
        <p role="alert" className="text-danger font-bold">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
