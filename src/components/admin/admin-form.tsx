"use client";

import { startTransition, useActionState, useEffect, useId, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/features/administration/curriculum-actions";
import { cn } from "@/lib/utilities/cn";

export interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "select" | "hidden" | "password" | "email";
  autoComplete?: string;
  defaultValue?: string | number | null;
  options?: { value: string; label: string }[];
  help?: string;
  required?: boolean;
  /** Chinese text input: applies the CJK font. */
  hanzi?: boolean;
  rows?: number;
  readOnly?: boolean;
  wide?: boolean;
}

function Submit({ label, pending }: { label: string; pending: boolean }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {pending ? "Saving…" : label}
    </Button>
  );
}

const control =
  "border-border bg-surface text-foreground focus-visible:border-primary aria-[invalid=true]:border-danger w-full rounded-xl border-2 px-4 text-base focus-visible:outline-none";

/** Server-action form with labelled fields, per-field errors and a status message. */
export function AdminForm({
  action,
  fields,
  submitLabel = "Save",
  resetOnSuccess = false,
  className,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  fields: FieldSpec[];
  submitLabel?: string;
  resetOnSuccess?: boolean;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();
  useEffect(() => {
    if (state.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={formRef}
      // Submitting through a transition (not `action=`) keeps what the user typed when the
      // server returns validation errors; React resets action forms after every submission.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className={cn("flex flex-col gap-4", className)}
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          if (f.type === "hidden")
            return (
              <input
                key={f.name}
                type="hidden"
                name={f.name}
                value={String(f.defaultValue ?? "")}
              />
            );
          const fieldId = `${id}-${f.name}`;
          const errors = state.fieldErrors?.[f.name];
          const describedBy = [
            f.help ? `${fieldId}-help` : null,
            errors ? `${fieldId}-error` : null,
          ]
            .filter(Boolean)
            .join(" ");
          const common = {
            id: fieldId,
            name: f.name,
            defaultValue: f.defaultValue ?? "",
            required: f.required,
            readOnly: f.readOnly,
            "aria-invalid": errors ? true : undefined,
            "aria-describedby": describedBy || undefined,
            lang: f.hanzi ? "zh" : undefined,
          };
          return (
            <div
              key={f.name}
              className={cn(
                "flex flex-col gap-1.5",
                (f.wide || f.type === "textarea") && "sm:col-span-2",
              )}
            >
              <Label htmlFor={fieldId}>
                {f.label}
                {f.required ? (
                  <span aria-hidden className="text-danger">
                    {" "}
                    *
                  </span>
                ) : null}
              </Label>
              {f.type === "textarea" ? (
                <textarea
                  {...common}
                  rows={f.rows ?? 4}
                  className={cn(control, "py-2", f.hanzi && "hanzi")}
                />
              ) : f.type === "select" ? (
                <select {...common} className={cn(control, "h-11")}>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  {...common}
                  type={
                    f.type === "number" || f.type === "password" || f.type === "email"
                      ? f.type
                      : "text"
                  }
                  autoComplete={f.autoComplete}
                  className={cn(f.hanzi && "hanzi", f.readOnly && "bg-surface-muted")}
                />
              )}
              {f.help ? (
                <p id={`${fieldId}-help`} className="text-muted-foreground text-xs">
                  {f.help}
                </p>
              ) : null}
              {errors ? (
                <p id={`${fieldId}-error`} className="text-danger text-xs font-semibold">
                  {errors.join(" ")}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Submit label={submitLabel} pending={pending} />
        {state.message ? (
          <p
            role={state.ok ? "status" : "alert"}
            className={cn("text-sm font-bold", state.ok ? "text-primary" : "text-danger")}
          >
            {state.message}
          </p>
        ) : null}
      </div>
      {state.details?.length ? (
        <ul className="bg-surface-muted max-h-72 overflow-auto rounded-xl p-3 text-sm">
          {state.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

export const LICENSE_OPTIONS = [
  "UNKNOWN",
  "OPEN_LICENSE",
  "LICENSED",
  "ORIGINAL",
  "PUBLIC_FACT",
].map((v) => ({ value: v, label: v.replace("_", " ").toLowerCase() }));
/** Verification is set only through the review queue (M14-b), so no form offers it. */
