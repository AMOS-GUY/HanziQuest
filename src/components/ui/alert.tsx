import * as React from "react";
import { cn } from "@/lib/utilities/cn";

export function Alert({
  className,
  variant = "info",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "info" | "error" }) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "rounded-xl px-4 py-3 text-sm font-semibold",
        variant === "error" ? "bg-danger-surface text-danger" : "bg-accent text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}
