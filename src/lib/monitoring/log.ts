/**
 * Structured, privacy-conscious logging (M9). One JSON object per line on stdout, which any
 * log platform can collect. Personal data is kept out by construction and by redaction:
 *  - callers log identifiers of things (route, status, ids of content), never request bodies;
 *  - values that look like emails, bearer tokens or long secrets are masked;
 *  - fields named like credentials are dropped.
 * Quiet under tests unless LOG_IN_TESTS=1.
 */

import { releaseId } from "@/lib/release";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

const SECRET_KEY = /pass(word)?|secret|token|cookie|authori[sz]ation|api[-_]?key|dsn/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LONG_TOKEN = /\b[A-Za-z0-9_\-+/=]{32,}\b/g;
const URL_CREDENTIALS = /(\w+:\/\/)[^\s/:@]+:[^\s/@]+@/g;

export function redact(value: string) {
  return value
    .replace(URL_CREDENTIALS, "$1[redacted]@")
    .replace(EMAIL, "[email]")
    .replace(LONG_TOKEN, "[redacted]");
}

export function logEvent(level: Level, event: string, fields: Fields = {}) {
  if (process.env.NODE_ENV === "test" && !process.env.LOG_IN_TESTS) return;
  const clean: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || SECRET_KEY.test(key)) continue;
    clean[key] = typeof value === "string" ? redact(value).slice(0, 500) : value;
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    release: releaseId(),
    ...clean,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
