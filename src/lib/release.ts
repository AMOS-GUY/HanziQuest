/**
 * The running release, for health checks, logs, error reports and feedback (M10).
 * APP_RELEASE if set; otherwise the commit Render built from (RENDER_GIT_COMMIT); else "dev".
 * deploy.yml waits until /api/health reports the commit it deployed.
 */
export function releaseId(env: Record<string, string | undefined> = process.env): string {
  return env.APP_RELEASE?.trim() || env.RENDER_GIT_COMMIT?.trim().slice(0, 12) || "dev";
}
