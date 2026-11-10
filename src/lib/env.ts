/**
 * Production configuration check, run once at server start (instrumentation.ts). It fails fast
 * with a readable list instead of letting the app start half-configured.
 */
export interface EnvIssue {
  name: string;
  problem: string;
  fatal: boolean;
}

export function checkEnvironment(
  env: Record<string, string | undefined> = process.env,
): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const production = env.NODE_ENV === "production";
  const need = (name: string, problem: string, fatal = production) => {
    if (!env[name]) issues.push({ name, problem, fatal });
  };
  need("DATABASE_URL", "is not set", true);
  need("AUTH_SECRET", "is not set (generate with `npx auth secret`)");
  if (env.AUTH_SECRET && env.AUTH_SECRET.length < 32)
    issues.push({
      name: "AUTH_SECRET",
      problem: "should be at least 32 characters",
      fatal: production,
    });
  if (production) {
    need("AUTH_URL", "must be the public origin, e.g. https://app.example.com");
    if (env.AUTH_URL) {
      try {
        const url = new URL(env.AUTH_URL);
        if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))
          issues.push({ name: "AUTH_URL", problem: "must use https in production", fatal: true });
      } catch {
        issues.push({ name: "AUTH_URL", problem: "is not a valid URL", fatal: true });
      }
    }
    if (env.REGISTER_LIMIT_PER_HOUR && Number(env.REGISTER_LIMIT_PER_HOUR) > 50)
      issues.push({
        name: "REGISTER_LIMIT_PER_HOUR",
        problem: "is raised above 50; only test servers should do this",
        fatal: false,
      });
    if (!env.SENTRY_DSN)
      issues.push({
        name: "SENTRY_DSN",
        problem: "is not set; errors go to logs only",
        fatal: false,
      });
    if (env.REGISTRATION_MODE?.trim().toLowerCase() === "open")
      issues.push({
        name: "REGISTRATION_MODE",
        problem:
          "is 'open': anyone can sign up. Keep the beta invite-only until the legal and operational prerequisites are approved",
        fatal: false,
      });
    if (env.RATE_LIMIT_STORE === "memory")
      issues.push({
        name: "RATE_LIMIT_STORE",
        problem: "is 'memory'; limits are per instance",
        fatal: false,
      });
  }
  return issues;
}
