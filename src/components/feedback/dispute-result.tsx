"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DISPUTE_REASONS } from "@/features/handwriting/dispute-reasons";
import { ApiRequestError, submitDispute } from "@/features/exercises/client-api";
import type { AttemptResult } from "@/generated/prisma/enums";

/**
 * "Grading looks wrong?" on a handwriting result (M13, D-081): a structured reason and explicit
 * consent, no free text. Available once the attempt is saved on the server. Never changes
 * the result or progress, and says so.
 */
export function DisputeResult({
  clientEventId,
  result,
  saved,
}: {
  clientEventId: string;
  result: AttemptResult;
  saved: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>();
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "sending" } | { kind: "done" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const reasons = DISPUTE_REASONS.filter((r) => r.eligible(result));
  const formRef = useRef<HTMLFormElement>(null);
  // The button that opened the form is gone: move focus to the form so keyboard and
  // screen-reader users land on it.
  useEffect(() => {
    if (open) formRef.current?.focus();
  }, [open]);

  if (state.kind === "done")
    return (
      <p role="status" className="text-muted-foreground text-center text-xs font-semibold">
        Thanks. A reviewer will look at it. Your result and progress stay as they are either way.
      </p>
    );
  if (!open)
    return (
      <button
        type="button"
        className="text-muted-foreground self-center text-xs font-bold underline"
        onClick={() => setOpen(true)}
      >
        Grading looks wrong?
      </button>
    );
  if (!saved)
    return (
      <p role="status" className="text-muted-foreground text-center text-xs font-semibold">
        You can dispute this result once it has been saved online.
      </p>
    );

  return (
    <form
      ref={formRef}
      tabIndex={-1}
      aria-label="Dispute this result"
      id={`${id}-form`}
      className="border-border flex flex-col gap-3 rounded-2xl border-2 p-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!reason || !consent) return;
        setState({ kind: "sending" });
        try {
          await submitDispute({ clientEventId, reason, consent: true });
          setState({ kind: "done" });
        } catch (error) {
          setState({
            kind: "error",
            message:
              error instanceof ApiRequestError && error.status < 500
                ? error.message
                : "Couldn't send it. Try again in a moment.",
          });
        }
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="font-bold">What looks wrong?</legend>
        {reasons.map((r) => (
          <label key={r.key} className="flex items-start gap-2">
            <input
              type="radio"
              name={`${id}-reason`}
              value={r.key}
              checked={reason === r.key}
              onChange={() => setReason(r.key)}
              className="mt-1"
            />
            <span>{r.label}</span>
          </label>
        ))}
      </fieldset>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1"
        />
        <span>
          A reviewer may look at this writing to check the result. It won&apos;t change your result
          or progress.
        </span>
      </label>
      {state.kind === "error" ? (
        <p role="alert" className="text-danger font-semibold">
          {state.message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!reason || !consent || state.kind === "sending"}>
          Send to a reviewer
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
