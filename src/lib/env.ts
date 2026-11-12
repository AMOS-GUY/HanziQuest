/**
 * Production configuration check, run once at server start (instrumentation.ts). It fails fast
 * with a readable list instead of letting the app start half-configured.
 */
/** Values that are public placeholders and must never be the production secret (M10-05). */
export const PLACEHOLDER_SECRETS = ["build-time-placeholder-secret-not-used-at-runtime"];

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
  // M11: development servers only use a local database (dev data is throwaway; staging isn't).
  if (env.NODE_ENV === "development" && env.DATABASE_URL && env.ALLOW_REMOTE_DATABASE !== "true") {
    let host = "";
    try {
      host = new URL(env.DATABASE_URL).hostname;
    } catch {
      host = "";
    }
    if (host && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host))
      issues.push({
        name: "DATABASE_URL",
        problem:
          "points at a hosted database in development. Use the local database (npm run db:local); staging is reached only with the staging:* scripts",
        fatal: true,
      });
  }
  if (env.DATABASE_URL && !/^postgres(ql)?:\/\//.test(env.DATABASE_URL))
    issues.push({
      name: "DATABASE_URL",
      problem: "must be a postgresql:// connection string",
      fatal: production,
    });
  if (env.DATABASE_POOL_MAX !== undefined && env.DATABASE_POOL_MAX !== "") {
    const max = Number(env.DATABASE_POOL_MAX);
    if (!Number.isInteger(max) || max < 1 || max > 100)
      issues.push({
        name: "DATABASE_POOL_MAX",
        problem: "must be a whole number from 1 to 100",
        fatal: production,
      });
  }
  if (env.TRUSTED_PROXY_HOPS !== undefined && env.TRUSTED_PROXY_HOPS !== "") {
    const hops = Number(env.TRUSTED_PROXY_HOPS);
    if (!Number.isInteger(hops) || hops < 0 || hops > 5)
      issues.push({
        name: "TRUSTED_PROXY_HOPS",
        problem: "must be a whole number from 0 to 5 (rate limits key on the client IP)",
        fatal: production,
      });
  }
  if (production) {
    // Values pasted from .env.staging.example / .env.example unchanged (M11, S-11).
    for (const name of ["DATABASE_URL", "MIGRATE_DATABASE_URL", "AUTH_SECRET", "AUTH_URL"])
      if (env[name]?.includes("REPLACE_ME"))
        issues.push({ name, problem: "still holds the template placeholder", fatal: true });
    // Every deployment names itself (M11, D-053). Fatal on Render, where it is always deployed;
    // local production builds (e2e, smoke) may leave it unset.
    const appEnv = env.APP_ENV?.trim().toLowerCase();
    if (appEnv && appEnv !== "staging" && appEnv !== "production")
      issues.push({ name: "APP_ENV", problem: "must be 'staging' or 'production'", fatal: true });
    else if (!appEnv && env.RENDER === "true")
      issues.push({
        name: "APP_ENV",
        problem: "must be set to 'staging' or 'production' on a deployed service",
        fatal: true,
      });
    if (appEnv === "staging" && env.REGISTRATION_MODE?.trim().toLowerCase() === "open")
      issues.push({
        name: "REGISTRATION_MODE",
        problem: "can't be 'open' on staging: staging is invite-only (synthetic accounts only)",
        fatal: true,
      });
    if (env.AUTH_SECRET && PLACEHOLDER_SECRETS.includes(env.AUTH_SECRET))
      issues.push({
        name: "AUTH_SECRET",
        problem: "is a public placeholder; generate a real secret",
        fatal: true,
      });
    if (env.AUTH_TRUST_HOST !== "true")
      issues.push({
        name: "AUTH_TRUST_HOST",
        problem: "must be 'true' behind the platform proxy, or sign-in fails (UntrustedHost)",
        fatal: true,
      });
    if (!env.APP_RELEASE && !env.RENDER_GIT_COMMIT)
      issues.push({
        name: "APP_RELEASE",
        problem:
          "is not set (and no RENDER_GIT_COMMIT); health checks and error reports can't name the running release",
        fatal: false,
      });
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
    if (env.PASSWORD_RESET_LINKS?.trim().toLowerCase() === "on")
      issues.push({
        name: "PASSWORD_RESET_LINKS",
        problem:
          "is 'on': staff can create password reset links. Only after the owner approves the procedure in SECURITY.md",
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
