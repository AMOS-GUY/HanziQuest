import Image from "next/image";
import { cn } from "@/lib/utilities/cn";

/**
 * Official HanziQuest logo. Renders the approved SVG unchanged (see docs/BRANDING.md);
 * the rounded corners match the app-icon presentation on the official logo sheet.
 * Minimum display size: 24px.
 */
export function Logo({
  size = 40,
  variant = "emerald",
  className,
  priority,
}: {
  size?: number;
  variant?: "emerald" | "minimal-light" | "minimal-dark" | "night";
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={`/branding/hanziquest-${variant}.svg`}
      alt="HanziQuest"
      width={size}
      height={size}
      priority={priority}
      unoptimized
      className={cn("shrink-0 rounded-[22%]", className)}
    />
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-foreground text-xl font-black tracking-tight", className)}>
      Hanzi<span className="text-primary">Quest</span>
    </span>
  );
}
