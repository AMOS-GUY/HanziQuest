"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

/** Friendly error screen for route error boundaries. Reports the crash without personal data. */
export function ErrorView({
  error,
  reset,
  homeHref = "/home",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  homeHref?: string;
}) {
  useEffect(() => {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message.slice(0, 1000),
        name: error.name,
        digest: error.digest,
        path: window.location.pathname,
      }),
    }).catch(() => undefined);
  }, [error]);

  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <Logo size={56} />
      <h1 className="text-2xl font-black">{offline ? "You're offline" : "Something went wrong"}</h1>
      <p className="text-muted-foreground">
        {offline
          ? "This page needs a connection. Downloaded lessons still work offline."
          : "Sorry, this page didn't load properly. Your progress is safe. Try again in a moment."}
      </p>
      {error.digest ? (
        <p className="text-muted-foreground text-xs">Reference: {error.digest}</p>
      ) : null}
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw aria-hidden /> Try again
        </Button>
        <Button asChild variant="secondary">
          <Link href={offline ? "/offline" : homeHref}>
            {offline ? "Offline lessons" : "Go home"}
          </Link>
        </Button>
      </div>
    </div>
  );
}
