"use client";

import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utilities/cn";

const NEXT = new Set(["ArrowDown", "ArrowRight"]);
const PREVIOUS = new Set(["ArrowUp", "ArrowLeft"]);

/** The radios of the radiogroup an element belongs to, in document order. */
function groupRadios(element: HTMLElement): HTMLElement[] {
  const group = element.closest('[role="radiogroup"]');
  return group ? [...group.querySelectorAll<HTMLElement>('[role="radio"]')] : [element];
}

/**
 * Large selectable card used for single- and multi-choice questions.
 *
 * As a radio (inside a `role="radiogroup"`), it follows the ARIA radio-group pattern (M19
 * F-03): the group is one tab stop (the selected option, or the first when none is), and the
 * arrow keys, Home and End move to another option and select it. Checkboxes stay separate tab
 * stops and toggle with Space or Enter, as before.
 */
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
  const ref = useRef<HTMLButtonElement>(null);

  // Roving tab stop. The parent re-renders every option when the selection changes, so each
  // option re-checks its own place after every render.
  useEffect(() => {
    const el = ref.current;
    if (!el || role !== "radio") return;
    const radios = groupRadios(el);
    const checked = radios.find((r) => r.getAttribute("aria-checked") === "true");
    el.tabIndex = (checked ? checked === el : radios[0] === el) ? 0 : -1;
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (role !== "radio") return;
    const radios = groupRadios(event.currentTarget);
    const at = radios.indexOf(event.currentTarget);
    let to: number | null = null;
    if (NEXT.has(event.key)) to = (at + 1) % radios.length;
    else if (PREVIOUS.has(event.key)) to = (at - 1 + radios.length) % radios.length;
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = radios.length - 1;
    if (to === null) return;
    event.preventDefault();
    const target = radios[to]!;
    target.focus();
    target.click();
  };

  return (
    <button
      ref={ref}
      type="button"
      role={role}
      aria-checked={selected}
      aria-label={label}
      onClick={onSelect}
      onKeyDown={onKeyDown}
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
