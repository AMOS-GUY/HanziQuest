import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utilities/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-foreground",
        muted: "bg-surface-muted text-muted-foreground",
        warning: "bg-[#fff1d6] text-[#7a4b00] dark:bg-[#3d2e10] dark:text-[#ffd58a]",
        danger: "bg-danger-surface text-danger",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
