import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  completeOnboarding,
  register,
  setAccountStatus,
  throwawayPassword,
  uniqueEmail,
} from "./helpers";

test.describe.configure({ timeout: 120_000 });

/** A harmless authenticated write: an empty sync batch. 200 when signed in, 401 otherwise. */
async function syncStatus(request: APIRequestContext) {
  const response = await request.post("/api/sync", {
    data: { deviceId: randomUUID(), events: [] },
  });
  return response.status();
}

test("changing the password ends every other session, including API access", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Session handling is device-independent");
  const email = uniqueEmail("pw");
  const password = throwawayPassword();
  const first = await browser.newContext();
  const page = await first.newPage();
  await register(page, "Password Changer", email, password);
  await completeOnboarding(page);
  expect(await syncStatus(page.request)).toBe(200);

  // A second device holding the same session (e.g. a stolen or forgotten browser).
  const second = await browser.newContext({ storageState: await first.storageState() });
  const other = await second.newPage();
  await other.goto("/home");
  await expect(other).toHaveURL(/\/home$/);
  expect(await syncStatus(other.request)).toBe(200);

  const newPassword = throwawayPassword();
  await page.goto("/profile");
  await page.getByLabel("Current password").fill(password);
  await page.getByRole("textbox", { name: "New password", exact: true }).fill(newPassword);
  await page.getByLabel("Repeat new password").fill(newPassword);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/login\?changed=1/, { timeout: 20_000 });

  // The other device is signed out on its next request: pages and the API both refuse it.
  expect(await syncStatus(other.request)).toBe(401);
  await other.goto("/home");
  await expect(other).toHaveURL(/\/login/);

  // The old password no longer works; the new one does.
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Incorrect email or password" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Password", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });
  expect(await syncStatus(page.request)).toBe(200);
  await first.close();
  await second.close();
});

test("a suspended account loses access at once and regains it when reactivated", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Session handling is device-independent");
  const email = uniqueEmail("suspend");
  await register(page, "Suspended Learner", email, throwawayPassword());
  await completeOnboarding(page);

  await setAccountStatus(email, "SUSPENDED");
  try {
    expect(await syncStatus(page.request)).toBe(401);
    await page.goto("/home");
    await expect(page).toHaveURL(/\/login/);
    const download = await page.request.post("/api/sessions", { data: { lessonId: "x" } });
    expect(download.status()).toBe(401);
  } finally {
    await setAccountStatus(email, "ACTIVE");
  }
  // The session itself was never deleted, so reactivation restores it.
  expect(await syncStatus(page.request)).toBe(200);
});

test("API routes refuse anonymous and cross-site requests", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  expect(await syncStatus(anonymous)).toBe(401);
  for (const path of ["/api/attempts", "/api/sessions", "/api/sync"]) {
    const response = await anonymous.post(path, {
      data: {},
      headers: { origin: "https://evil.example" },
    });
    expect(response.status(), path).toBe(403);
  }
  const malformed = await anonymous.post("/api/client-errors", {
    data: "{not json",
    headers: { "content-type": "application/json" },
  });
  expect(malformed.status()).toBe(400);
  await anonymous.dispose();
});
