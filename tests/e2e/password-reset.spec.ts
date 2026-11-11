/**
 * Integration audit (D-045): a moderator creates a single-use reset link for a learner who
 * forgot their password; the learner sets a new one and their other sessions end.
 */
import { expect, test } from "@playwright/test";
import { completeOnboarding, grantRole, register, throwawayPassword, uniqueEmail } from "./helpers";

test.describe.configure({ timeout: 150_000 });

test("staff reset link: works once and signs the learner out elsewhere", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Runs once");

  // The learner, signed in on one device.
  const learnerContext = await browser.newContext();
  const learnerPage = await learnerContext.newPage();
  const learnerEmail = uniqueEmail("forgot");
  await register(learnerPage, "Forgetful", learnerEmail, throwawayPassword());
  await completeOnboarding(learnerPage);

  // A moderator creates the link from the user's admin page.
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  const staffEmail = uniqueEmail("resetter");
  await register(staff, "Resetter", staffEmail, throwawayPassword());
  await completeOnboarding(staff);
  await grantRole(staffEmail, "MODERATOR");
  await staff.goto(`/admin/users?q=${encodeURIComponent(learnerEmail)}`);
  await staff
    .getByRole("link", { name: /Forgetful/ })
    .first()
    .click();
  await expect(staff.getByRole("heading", { level: 2, name: "Password reset" })).toBeVisible();
  await staff.getByLabel("Reason").last().fill("e2e: learner asked");
  await staff.getByRole("button", { name: "Create reset link" }).click();
  const status = staff.getByRole("status").filter({ hasText: "Copy it now" });
  await expect(status).toBeVisible();
  const link = (await status.locator(".font-mono").textContent())!.trim();
  expect(link).toMatch(/\/reset-password\?token=[A-Za-z0-9_-]{43}$/);
  const path = new URL(link).pathname + new URL(link).search;

  // The learner opens it signed out, on another device.
  const visitor = await browser.newContext();
  const page = await visitor.newPage();
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  // The token leaves the address bar (and so the history entry) once the page has it (D-047).
  await expect(page).toHaveURL(/\/reset-password$/);
  const newPassword = throwawayPassword();
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Repeat new password").fill(newPassword);
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByRole("status")).toContainText("Password changed");

  // The new password works.
  await page.getByRole("link", { name: /Log in with your new password/ }).click();
  await page.getByLabel("Email").fill(learnerEmail);
  await page.getByLabel("Password", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });

  // The session on the first device has ended.
  await learnerPage.goto("/home");
  await expect(learnerPage).toHaveURL(/\/login/);

  // The link can't be used again.
  const again = await browser.newContext();
  const reuse = await again.newPage();
  await reuse.goto(path);
  await expect(reuse.getByRole("alert").filter({ hasText: "not valid any more" })).toBeVisible();

  // Reloading the page after the token has left the address bar asks for the link again.
  await reuse.goto("/reset-password");
  await expect(reuse.getByRole("alert").filter({ hasText: "Open the reset link" })).toBeVisible();

  await Promise.all([learnerContext, staffContext, visitor, again].map((c) => c.close()));
});
