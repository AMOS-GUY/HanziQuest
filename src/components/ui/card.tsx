import * as React from "react";
import { cn } from "@/lib/utilities/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border-border bg-surface rounded-[var(--radius-card)] border-2 p-5",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-extrabold", className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-muted-foreground text-sm", className)} {...props} />;
}

/**
 * Optional structure for cards with a header block and a body (title + description, then
 * actions). `Card` already pads its content, so these only add spacing between sections.
 */
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("pt-4", className)} {...props} />;
}
