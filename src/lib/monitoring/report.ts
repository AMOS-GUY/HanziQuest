/**
 * Error reporting. Every error is written to stdout as one JSON line, which any log platform
 * can collect. When SENTRY_DSN is set, it is also sent to Sentry (or a Sentry-compatible
 * service such as GlitchTip) through the envelope HTTP API, without an SDK dependency.
 *
 * No personal data is attached: only the error, a source label, a request path and the release.
 */

export interface ErrorContext {
  source: "api" | "server" | "client" | "action" | "worker";
  path?: string;
  digest?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface ParsedDsn {
  envelopeUrl: string;
  publicKey: string;
}

export function parseDsn(dsn: string | undefined): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "").split("/").pop();
    if (!url.username || !projectId) return null;
    const prefix = url.pathname.replace(/\/[^/]*$/, "");
    return {
      envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
      publicKey: url.username,
    };
  } catch {
    return null;
  }
}

const SECRETISH = /(password|secret|token|authorization|cookie)=[^&\s]+/gi;

function normalise(error: unknown) {
  if (error instanceof Error)
    return {
      type: error.name,
      value: error.message.replace(SECRETISH, "$1=[redacted]").slice(0, 1000),
      stack: error.stack?.replace(SECRETISH, "$1=[redacted]").slice(0, 8000),
    };
  return { type: "NonError", value: String(error).slice(0, 1000), stack: undefined };
}

export function buildEnvelope(
  error: unknown,
  context: ErrorContext,
  meta: { dsn: string; release?: string; environment?: string; now?: Date; eventId?: string },
) {
  const now = meta.now ?? new Date();
  const eventId = meta.eventId ?? crypto.randomUUID().replaceAll("-", "");
  const e = normalise(error);
  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: "javascript",
    level: "error",
    release: meta.release,
    environment: meta.environment,
    tags: { source: context.source },
    extra: { ...context, stack: e.stack },
    exception: { values: [{ type: e.type, value: e.value }] },
    request: context.path ? { url: context.path } : undefined,
  };
  return [
    JSON.stringify({ event_id: eventId, sent_at: now.toISOString(), dsn: meta.dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

export async function reportError(error: unknown, context: ErrorContext) {
  const e = normalise(error);
  console.error(
    JSON.stringify({
      level: "error",
      time: new Date().toISOString(),
      ...context,
      error: e.type,
      message: e.value,
      stack: e.stack,
    }),
  );
  const dsn = process.env.SENTRY_DSN;
  const parsed = parseDsn(dsn);
  if (!parsed || !dsn) return;
  try {
    await fetch(parsed.envelopeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=hanziquest/1.0, sentry_key=${parsed.publicKey}`,
      },
      body: buildEnvelope(error, context, {
        dsn,
        release: process.env.APP_RELEASE,
        environment: process.env.APP_ENV ?? process.env.NODE_ENV,
      }),
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    // Reporting must never break the request; the stdout line above is the fallback.
  }
}
