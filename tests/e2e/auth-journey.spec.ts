import { expect, test } from "@playwright/test";
import { completeOnboarding, uniqueEmail } from "./helpers";

test.describe.configure({ timeout: 90_000 });

test("learner can register, see the learning path, log out and log back in", async ({
  page,
}, testInfo) => {
  const email = uniqueEmail(testInfo.project.name);
  // Throwaway credential for a local/CI test database only.
  const password = `e2e-${Math.random().toString(36).slice(2)}-pw`;

  await page.goto("/");
  await expect(page.getByRole("img", { name: "HanziQuest" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Join the free beta" }).click();

  await expect(page).toHaveURL(/\/register$/);
  await page.getByLabel("Your name").fill("E2E Learner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use at least 10 characters")).toBeVisible();

  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  // The beta terms and privacy notice must be accepted.
  await expect(page.getByText("Please accept the beta terms and privacy notice")).toBeVisible();
  await page.getByRole("checkbox", { name: /beta terms/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();

  // New accounts go through onboarding before reaching the app.
  await completeOnboarding(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E Learner");

  await page.goto("/learn");
  await expect(page.getByRole("heading", { name: "HSK 1 Starter" })).toBeVisible();
  await expect(page.getByText("Saying hello")).toBeVisible();
  await expect(page.getByText("Provisional content")).toBeVisible();
  // M14-b: the edition is named, and nothing claims to be official HSK material.
  await expect(page.getByText("HSK 2.0 edition.")).toBeVisible();
  await expect(page.getByText(/not official HSK material/)).toBeVisible();

  // Learners must not reach the admin area.
  const adminResponse = await page.goto("/admin");
  expect(adminResponse?.status()).toBe(404);

  await page.goto("/profile");
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/$/);

  // Protected pages redirect to login when signed out.
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Incorrect email or password" }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/home$/);

  // Session persists across reloads.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E Learner");
});

test("security headers are present", async ({ request }) => {
  const response = await request.get("/");
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("web app manifest is served", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.name).toBe("HanziQuest");
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
});
