/**
 * Staging acceptance suite (M11, docs/M11_STAGING_ACCEPTANCE.md). HTTP only, against a
 * deployed invite-only server, with synthetic accounts:
 * - learners are created through STAGING_INVITE_CODE (a multi-use, short-lived invite the
 *   staging admin creates for the run);
 * - the admin is STAGING_ADMIN_EMAIL / STAGING_ADMIN_PASSWORD (the seeded staging Super Admin).
 * The run is serial: later steps reuse the learner created in the first step.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { completeOnboarding, writeCurrentExercise } from "../e2e/helpers";

test.describe.configure({ mode: "serial" });

const BASE = process.env.STAGING_BASE_URL!;
const INVITE = process.env.STAGING_INVITE_CODE!;
const ADMIN = {
  email: process.env.STAGING_ADMIN_EMAIL!,
  password: process.env.STAGING_ADMIN_PASSWORD!,
};
const EXPECT_ENV = process.env.STAGING_EXPECT_ENV ?? "staging";
const HTTPS = BASE.startsWith("https://");
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const synthetic = (who: string) => `staging-check-${run}-${who}@example.test`;
const secret = () =>
  `stg-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

const learner = { email: synthetic("learner"), password: secret() };
let learnerContext: BrowserContext;
let page: Page;

async function registerWithInvite(
  p: Page,
  name: string,
  email: string,
  password: string,
  invite = INVITE,
) {
  await p.goto("/register");
  await expect(p.getByText("The HanziQuest beta is invite-only")).toBeVisible();
  await p.getByLabel("Invite code").fill(invite);
  await p.getByLabel("Your name").fill(name);
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password", { exact: true }).fill(password);
  await p.getByRole("checkbox", { name: /beta terms/ }).check();
  await p.getByRole("button", { name: "Create account" }).click();
}

async function logIn(p: Page, email: string, password: string) {
  await p.goto("/login");
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password", { exact: true }).fill(password);
  await p.getByRole("button", { name: "Log in" }).click();
}

async function totalXp(p: Page) {
  await p.goto("/progress");
  const value = p.getByText("Total XP").locator("xpath=preceding-sibling::p[1]");
  await expect(value).toBeVisible();
  return Number((await value.textContent())!.replace(/\D/g, "") || "0");
}

async function newContext(browser: Browser) {
  return browser.newContext({ baseURL: BASE });
}

test.afterAll(async () => {
  await learnerContext?.close();
});

// ── Infrastructure ────────────────────────────────────────────────────────────

test("infrastructure: liveness, readiness, environment and release", async ({ request }) => {
  const live = await request.get("/api/health/live");
  expect(live.status()).toBe(200);
  expect(live.headers()["cache-control"]).toBe("no-store");
  const liveBody = await live.json();
  expect(liveBody).toMatchObject({ status: "ok", environment: EXPECT_ENV });

  const ready = await request.get("/api/health");
  expect(ready.status()).toBe(200);
  const body = await ready.json();
  expect(body).toMatchObject({
    status: "ok",
    database: "ok",
    migrations: "ok",
    environment: EXPECT_ENV,
  });
  if (EXPECT_ENV === "staging") expect(body.databaseEnvironment).toBe("ok");
  expect(typeof body.release).toBe("string");
  expect(body.release).not.toBe("dev");
  // Health output reveals no configuration or connection details.
  expect(JSON.stringify(body)).not.toMatch(/postgres|secret|password|neon|@/i);
  test.info().annotations.push({ type: "release", description: body.release });
});

test("infrastructure: security headers and the staging banner", async ({ page: p, request }) => {
  const r = await request.get("/");
  const h = r.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  if (HTTPS) expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["x-powered-by"]).toBeUndefined();
  await p.goto("/");
  if (EXPECT_ENV === "staging")
    await expect(p.getByRole("note", { name: "Staging environment" })).toBeVisible();
});

// ── Security: anonymous and invite-only ───────────────────────────────────────

test("security: anonymous visitors can't reach protected pages or APIs", async ({
  page: p,
  request,
}) => {
  for (const path of ["/home", "/learn", "/review", "/progress", "/profile"]) {
    await p.goto(path);
    await expect(p).toHaveURL(/\/login/);
  }
  await p.goto("/admin");
  await expect(p).toHaveURL(/\/login/);
  const write = await request.post("/api/attempts", {
    data: {},
    headers: { origin: BASE, "content-type": "application/json" },
  });
  expect([401, 403]).toContain(write.status());
  const crossSite = await request.post("/api/attempts", {
    data: {},
    headers: { origin: "https://evil.example", "content-type": "application/json" },
  });
  expect(crossSite.status()).toBe(403);
});

test("security: registration is invite-only", async ({ browser }) => {
  const ctx = await newContext(browser);
  const p = await ctx.newPage();
  await registerWithInvite(p, "No invite", synthetic("noinvite"), secret(), "");
  await expect(p.getByText(/invite code is not valid/)).toBeVisible();
  await registerWithInvite(p, "Bad invite", synthetic("badinvite"), secret(), "HQ-AAAAA-AAAAA");
  await expect(p.getByText(/invite code is not valid/)).toBeVisible();
  await ctx.close();
});

test("security: wrong passwords are refused, then rate limited", async ({ browser }) => {
  const ctx = await newContext(browser);
  const p = await ctx.newPage();
  // A synthetic address that has no account, so no real account is ever locked out.
  const nobody = synthetic("nobody");
  await logIn(p, nobody, "not-the-password-1");
  await expect(p.getByText(/Invalid email or password|incorrect/i)).toBeVisible();
  let limited = false;
  for (let i = 0; i < 12 && !limited; i += 1) {
    await logIn(p, nobody, `not-the-password-${i}`);
    limited = await p
      .getByText("Too many sign-in attempts")
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
  }
  expect(limited, "the login limiter (10 per 15 min) should trigger").toBe(true);
  await ctx.close();
});

// ── Application: learner journey ──────────────────────────────────────────────

test("application: invited learner registers, onboards and sees the dashboard", async ({
  browser,
}) => {
  learnerContext = await newContext(browser);
  page = await learnerContext.newPage();
  await registerWithInvite(page, "Staging check", learner.email, learner.password);
  await completeOnboarding(page);
  await expect(page).toHaveURL(/\/home$/);
  if (HTTPS) {
    const cookies = await learnerContext.cookies();
    const session = cookies.find((c) => c.name.includes("authjs.session-token"));
    expect(session?.name.startsWith("__Secure-"), "secure session cookie name").toBe(true);
    expect(session).toMatchObject({ secure: true, httpOnly: true, sameSite: "Lax" });
  }
});

test("application: learning path, lesson, writing, review and progress", async () => {
  await page.goto("/learn");
  await expect(page.getByRole("link", { name: /^1\. Saying hello/ })).toBeVisible();
  await page.goto("/home");
  await page.getByRole("link", { name: "Start" }).click();
  await expect(page.getByRole("heading", { name: "Saying hello" })).toBeVisible();
  await page.getByRole("link", { name: /Start practice/ }).click();
  await expect(page).toHaveURL(/\/practice\/lesson\//);
  await writeCurrentExercise(page);
  const check = page.getByRole("button", { name: "Check" });
  if (await check.isVisible()) await check.click();
  await expect(page.getByText("Saved")).toBeVisible({ timeout: 20_000 });
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Excellent|Good/ })
      .first(),
  ).toBeVisible();

  await page.goto("/review");
  await expect(page.getByRole("heading", { level: 1, name: "Review" })).toBeVisible();
  expect(await totalXp(page)).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { level: 1, name: "Your progress" })).toBeVisible();
});

test("security: a learner gets 404 on admin pages and admin APIs", async ({ request }) => {
  for (const path of ["/admin", "/admin/users", "/admin/operations"]) {
    const r = await page.goto(path);
    expect(r?.status(), path).toBe(404);
  }
  const cookies = await learnerContext.cookies();
  const r = await request.get("/api/admin/handwriting/samples", {
    headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") },
  });
  expect([403, 404]).toContain(r.status());
});

// ── Offline ───────────────────────────────────────────────────────────────────

test("offline: download, practise offline, sync once, no duplicates", async () => {
  const before = await totalXp(page);
  await page.goto("/learn");
  await page.getByRole("link", { name: /^1\. Saying hello/ }).click();
  await page.getByRole("button", { name: "Download for offline" }).click();
  await expect(page.getByText("Available offline")).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await learnerContext.setOffline(true);
  await page.goto("/learn");
  await expect(page.getByRole("heading", { name: "Offline practice" })).toBeVisible();
  await page.getByRole("link", { name: "Practise" }).click();
  await writeCurrentExercise(page);
  const check = page.getByRole("button", { name: "Check" });
  if (await check.isVisible()) await check.click();
  await expect(page.getByText("Saved on this device. It will sync")).toBeVisible();

  await learnerContext.setOffline(false);
  await expect(
    page.getByRole("status").filter({ hasText: /saved on this device|Syncing/ }),
  ).toHaveCount(0, {
    timeout: 30_000,
  });
  const afterSync = await totalXp(page);
  expect(afterSync).toBeGreaterThan(before);
  // Reloading triggers another sync pass; nothing is counted twice.
  await page.reload();
  await page.waitForTimeout(3_000);
  expect(await totalXp(page)).toBe(afterSync);
});

test("offline: another account on the same device sees nothing of the first", async () => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/offline");
  await expect(page.getByText("Not signed in")).toBeVisible();

  const second = { email: synthetic("second"), password: secret() };
  await registerWithInvite(page, "Staging check 2", second.email, second.password);
  await completeOnboarding(page);
  expect(await totalXp(page)).toBe(0);
  await page.goto("/offline");
  await expect(page.getByText("No lessons downloaded")).toBeVisible();
  await page.goto("/profile");
  await page.getByRole("button", { name: "Log out" }).click();
});

// ── Security: sessions ────────────────────────────────────────────────────────

test("security: logout, session persistence and revocation on password change", async ({
  browser,
}) => {
  const a = await newContext(browser);
  const b = await newContext(browser);
  const pa = await a.newPage();
  const pb = await b.newPage();
  await logIn(pa, learner.email, learner.password);
  await expect(pa).toHaveURL(/\/home$/);
  await logIn(pb, learner.email, learner.password);
  await expect(pb).toHaveURL(/\/home$/);
  // The session persists across reloads and navigation.
  await pa.reload();
  await expect(pa).toHaveURL(/\/home$/);

  const next = secret();
  await pa.goto("/profile");
  await pa.getByLabel("Current password").fill(learner.password);
  await pa.getByRole("textbox", { name: "New password", exact: true }).fill(next);
  await pa.getByLabel("Repeat new password").fill(next);
  await pa.getByRole("button", { name: "Change password" }).click();
  // Changing the password signs this device out too, and asks for the new one.
  await expect(pa).toHaveURL(/\/login\?changed=1/);
  learner.password = next;

  // The other device's session ends.
  await pb.goto("/home");
  await expect(pb).toHaveURL(/\/login/);
  await a.close();
  await b.close();
});

// ── Administration ────────────────────────────────────────────────────────────

test("administration: staff sign-in, curriculum, content, feedback and users", async ({
  browser,
}) => {
  const ctx = await newContext(browser);
  const p = await ctx.newPage();
  await logIn(p, ADMIN.email, ADMIN.password);
  await expect(p).toHaveURL(/\/home$|\/admin/);
  const pages: [string, string][] = [
    ["/admin", "Overview"],
    ["/admin/curricula", "Curricula"],
    ["/admin/lessons", "Lessons"],
    ["/admin/characters", "Characters"],
    ["/admin/feedback", "Feedback"],
    ["/admin/users", "Users"],
    ["/admin/operations", "Operations"],
  ];
  for (const [path, heading] of pages) {
    const r = await p.goto(path);
    expect(r?.status(), path).toBe(200);
    await expect(p.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  // Staging is invite-only and reset links are off (the default).
  await p.goto("/admin/operations");
  await expect(p.getByText(/invite/i).first()).toBeVisible();
  await expect(p.getByText("PASSWORD_RESET_LINKS")).toHaveCount(0);
  await p.goto(`/admin/users?q=${encodeURIComponent(learner.email)}`);
  await p
    .getByRole("link", { name: /Staging check/ })
    .first()
    .click();
  await expect(p.getByText("Turned off on this server")).toBeVisible();
  await ctx.close();
});
