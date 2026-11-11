/**
 * Next.js instrumentation: configuration check at start-up and reporting of unhandled
 * server errors (pages, server actions, route handlers).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
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
