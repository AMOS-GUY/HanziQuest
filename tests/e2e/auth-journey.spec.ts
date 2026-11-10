import { expect, test } from "@playwright/test";
import { completeOnboarding, uniqueEmail } from "./helpers";

test("learner can register, see the learning path, log out and log back in", async ({
  page,
}, testInfo) => {
  const email = uniqueEmail(testInfo.project.name);
  // Throwaway credential for a local/CI test database only.
  const password = `e2e-${Math.random().toString(36).slice(2)}-pw`;

  await page.goto("/");
  await expect(page.getByRole("img", { name: "HanziQuest" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Get started" }).click();

  await expect(page).toHaveURL(/\/register$/);
  await page.getByLabel("Your name").fill("E2E Learner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use at least 10 characters")).toBeVisible();

  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  // New accounts go through onboarding before reaching the app.
  await completeOnboarding(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E Learner");

  await page.goto("/learn");
  await expect(page.getByRole("heading", { name: "HSK 1 Starter" })).toBeVisible();
  await expect(page.getByText("Saying hello")).toBeVisible();
  await expect(page.getByText("Provisional content")).toBeVisible();

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
  ).toBeVisible();

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
