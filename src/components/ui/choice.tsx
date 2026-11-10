"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utilities/cn";

/** Large selectable card used for single- and multi-choice questions. */
export function Choice({
  selected,
  onSelect,
  children,
  role = "radio",
  className,
  label,
}: {
  /** Accessible name; required when children are not plain text. */
  label: string;
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  role?: "radio" | "checkbox";
  className?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      aria-label={label}
      onClick={onSelect}
      className={cn(
        "border-border bg-surface hover:bg-surface-muted flex w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3 text-left font-bold transition-colors",
        selected && "border-primary bg-accent text-accent-foreground hover:bg-accent",
        className,
      )}
    >
      <span className="flex-1">{children}</span>
      <span
        aria-hidden
        className={cn(
          "border-border flex size-6 shrink-0 items-center justify-center rounded-full border-2",
          selected && "border-primary bg-primary text-primary-foreground",
        )}
      >
        {selected ? <Check className="size-4" /> : null}
      </span>
    </button>
  );
}
