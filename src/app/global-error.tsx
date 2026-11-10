"use client";

import { ErrorView } from "@/components/feedback/error-view";
import "./globals.css";

/** Last-resort boundary when the root layout itself fails. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <ErrorView error={error} reset={reset} homeHref="/" />
      </body>
    </html>
  );
}
