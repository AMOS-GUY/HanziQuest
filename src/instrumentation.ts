/**
 * Next.js instrumentation: configuration check at start-up and reporting of unhandled
 * server errors (pages, server actions, route handlers).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnvironment } = await import("@/lib/env");
  const issues = checkEnvironment();
  for (const i of issues) console[i.fatal ? "error" : "warn"](`[config] ${i.name} ${i.problem}`);
  const fatal = issues.filter((i) => i.fatal);
  if (fatal.length > 0 && process.env.SKIP_ENV_CHECK !== "true") {
    throw new Error(`Invalid configuration: ${fatal.map((i) => i.name).join(", ")}`);
  }
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/lib/monitoring/report");
  await reportError(error, {
    source: context.routeType === "action" ? "action" : "server",
    // Strip query strings: they can carry tokens or personal data.
    path: request.path.split("?")[0],
    method: request.method,
    routeType: context.routeType,
    digest: (error as { digest?: string }).digest,
  });
}
