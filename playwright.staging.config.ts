import { defineConfig, devices } from "@playwright/test";

/**
 * Staging acceptance suite (M11, docs/M11_STAGING_ACCEPTANCE.md). It runs against an already
 * deployed, invite-only server over HTTP only: no database access, no local server.
 *
 *   STAGING_BASE_URL=https://hanziquest-staging.onrender.com \
 *   STAGING_INVITE_CODE=HQ-XXXXX-XXXXX \
 *   STAGING_ADMIN_EMAIL=… STAGING_ADMIN_PASSWORD=… \
 *   npm run test:staging
 *
 * It creates synthetic learner accounts (`staging-check-…@example.test`) through the invite
 * code. Never point it at production.
 */
const baseURL = process.env.STAGING_BASE_URL;
if (!baseURL) throw new Error("Set STAGING_BASE_URL (the staging origin)");
if (process.env.STAGING_EXPECT_ENV === "production")
  throw new Error("The staging acceptance suite must never run against production.");
// tests/staging/global-setup.ts also refuses any server whose /api/health/live reports
// "production".

export default defineConfig({
  testDir: "./tests/staging",
  globalSetup: "./tests/staging/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // A free Render service can take about a minute to wake up.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-staging" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
});
