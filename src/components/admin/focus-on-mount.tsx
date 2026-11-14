"use client";

import { useEffect, useRef } from "react";

/**
 * A status message that takes keyboard focus when it appears, for confirmations shown after a
 * navigation (the control that triggered it may no longer exist). Announced as a status.
 */
export function FocusOnMount({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} role="status" tabIndex={-1} className={className}>
      {children}
    </div>
  );
}
