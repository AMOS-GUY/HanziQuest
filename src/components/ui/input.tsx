import * as React from "react";
import { cn } from "@/lib/utilities/cn";

export function Input({
  className,
  type = "text",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "border-border bg-surface text-foreground placeholder:text-muted-foreground focus-visible:border-primary aria-[invalid=true]:border-danger h-11 w-full rounded-xl border-2 px-4 text-base focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}
