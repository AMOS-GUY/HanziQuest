/**
 * Refuses to run against anything that isn't the expected staging server, and wakes a free
 * instance that has spun down (it takes about a minute) before the first test.
 */
export default async function globalSetup() {
  const base = process.env.STAGING_BASE_URL!;
  const expected = process.env.STAGING_EXPECT_ENV ?? "staging";
  let environment: string | undefined;
  for (let i = 0; i < 18 && !environment; i += 1) {
    try {
      const r = await fetch(`${base}/api/health/live`, { signal: AbortSignal.timeout(15_000) });
      if (r.ok) environment = ((await r.json()) as { environment?: string }).environment;
    } catch {
      // still waking up
    }
    if (!environment) await new Promise((r) => setTimeout(r, 5_000));
  }
  if (!environment) throw new Error(`${base} didn't answer /api/health/live within 3 minutes`);
  if (environment === "production")
    throw new Error("This server reports environment=production. Refusing to run.");
  if (environment !== expected)
    throw new Error(`This server reports environment=${environment}, expected ${expected}.`);
  for (const name of ["STAGING_INVITE_CODE", "STAGING_ADMIN_EMAIL", "STAGING_ADMIN_PASSWORD"])
    if (!process.env[name]) throw new Error(`Set ${name} (docs/M11_STAGING_ACCEPTANCE.md)`);
}
