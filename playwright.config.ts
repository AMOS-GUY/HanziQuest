import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
/** Second server with invite-only registration. */
export const INVITE_PORT = PORT + 1;

/**
 * End-to-end tests run against a production build (`next build && next start`) unless
 * E2E_BASE_URL points at an already running server. The database in DATABASE_URL must be
 * migrated and seeded (roles + starter curriculum).
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  // One local `next start` serves every worker; more workers than this mostly measure CPU
  // contention (bcrypt cost 12 on every sign-up) rather than the app.
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    // Cross-browser QA (E2E_ALL_BROWSERS=1; needs `npx playwright install firefox webkit`).
    ...(process.env.E2E_ALL_BROWSERS
      ? [
          { name: "firefox", use: { ...devices["Desktop Firefox"] } },
          { name: "webkit-iphone", use: { ...devices["iPhone 14"] } },
          { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
        ]
      : []),
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: `npx next start -p ${PORT}`,
          port: PORT,
          // Auth.js builds redirect URLs from AUTH_URL; it must point at this server, not the dev
          // server. E2E creates many accounts from one IP, so the registration limit is raised
          // for these servers only. Registration is open here.
          env: {
            AUTH_URL: `http://localhost:${PORT}`,
            REGISTER_LIMIT_PER_HOUR: "1000",
            REGISTRATION_MODE: "open",
          },
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          // The same build and database with invite-only registration, as in production
          // (tests/e2e/invites.spec.ts).
          command: `npx next start -p ${INVITE_PORT}`,
          port: INVITE_PORT,
          env: {
            AUTH_URL: `http://localhost:${INVITE_PORT}`,
            REGISTER_LIMIT_PER_HOUR: "1000",
            REGISTRATION_MODE: "invite",
          },
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});
