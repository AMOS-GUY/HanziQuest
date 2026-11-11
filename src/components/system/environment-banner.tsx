"use client";

import { useEffect, useState } from "react";

/**
 * A visible marker on non-production deployments (M11, D-053). The environment is read at run
 * time from /api/health/live, because Docker images are built once, without deploy-time
 * settings. Production and local development show nothing. Offline, the request fails quietly.
 */
export function EnvironmentBanner() {
  const [environment, setEnvironment] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health/live", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { environment?: string } | null) => {
        if (!cancelled && body?.environment === "staging") setEnvironment("staging");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (environment !== "staging") return null;
  return (
    <div
      role="note"
      aria-label="Staging environment"
      className="bg-foreground text-background px-4 py-1.5 text-center text-sm font-bold"
    >
      Staging: synthetic test data only. Not the real HanziQuest.
    </div>
  );
}
