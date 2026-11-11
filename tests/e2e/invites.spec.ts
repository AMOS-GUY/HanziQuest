/**
 * Invite-only beta (M9, D-041), against the second e2e server started with
 * REGISTRATION_MODE=invite (playwright.config.ts). Staff create the invite on the main server.
 */
import { expect, test } from "@playwright/test";
import { completeOnboarding, grantRole, register, throwawayPassword, uniqueEmail } from "./helpers";

const INVITE_SERVER = `http://localhost:${Number(process.env.E2E_PORT ?? 3100) + 1}`;

test.describe.configure({ timeout: 150_000 });

test("invite-only registration: a code is required and works only as often as allowed", async ({
  browser,
}, testInfo) => {
  test.skip(!!process.env.E2E_BASE_URL, "Needs the local invite-only server");
  test.skip(testInfo.project.name === "mobile", "Runs once");

  // Staff create a single-use invite. The code is shown once.
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  const staffEmail = uniqueEmail("inviter");
  await register(staff, "Inviter", staffEmail, throwawayPassword());
  await completeOnboarding(staff);
  // Learners can't manage invites.
  expect((await staff.goto("/admin/invites"))?.status()).toBe(404);
  await grantRole(staffEmail, "SUPER_ADMIN");
  await staff.goto("/admin/invites");
  await expect(staff.getByRole("heading", { level: 1, name: "Beta invites" })).toBeVisible();
  await staff.getByLabel("For", { exact: true }).fill("e2e pilot");
  await staff.getByRole("button", { name: "Create invite" }).click();
  const status = staff.getByRole("status").filter({ hasText: "Copy the code now" });
  await expect(status).toBeVisible();
  const code = (await status.locator(".font-mono").textContent())!.trim();
  expect(code).toMatch(/^HQ-[0-9A-Z]{5}-[0-9A-Z]{5}$/);

  // On the invite-only server: without a code, sign-up is refused by the server.
  const visitor = await browser.newContext({ baseURL: INVITE_SERVER });
  const page = await visitor.newPage();
  await page.goto("/register");
  await expect(page.getByText("The HanziQuest beta is invite-only")).toBeVisible();
  const fill = async (email: string, invite: string) => {
    await page.getByLabel("Invite code").fill(invite);
    await page.getByLabel("Your name").fill("Invited");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(throwawayPassword());
    await page.getByRole("checkbox", { name: /beta terms/ }).check();
    await page.getByRole("button", { name: "Create account" }).click();
  };
  await fill(uniqueEmail("noinvite"), "");
  await expect(page.getByText(/invite code is not valid/)).toBeVisible({ timeout: 20_000 });
  await fill(uniqueEmail("badinvite"), "HQ-AAAAA-AAAAA");
  await expect(page.getByText(/invite code is not valid/)).toBeVisible({ timeout: 20_000 });

  // The sign-up link prefills the code; lower case works.
  await page.goto(`/register?invite=${encodeURIComponent(code.toLowerCase())}`);
  await expect(page.getByLabel("Invite code")).toHaveValue(code.toLowerCase());
  await page.getByLabel("Your name").fill("Invited");
  await page.getByLabel("Email").fill(uniqueEmail("invited"));
  await page.getByLabel("Password", { exact: true }).fill(throwawayPassword());
  await page.getByRole("checkbox", { name: /beta terms/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });

  // Single use: a second sign-up with the same code is refused.
  const second = await browser.newContext({ baseURL: INVITE_SERVER });
  const again = await second.newPage();
  await again.goto(`/register?invite=${code}`);
  await again.getByLabel("Your name").fill("Second");
  await again.getByLabel("Email").fill(uniqueEmail("second"));
  await again.getByLabel("Password", { exact: true }).fill(throwawayPassword());
  await again.getByRole("checkbox", { name: /beta terms/ }).check();
  await again.getByRole("button", { name: "Create account" }).click();
  await expect(again.getByText(/invite code is not valid/)).toBeVisible({ timeout: 20_000 });

  // Staff see it as used up.
  await staff.reload();
  const row = staff.getByRole("row").filter({ hasText: "e2e pilot" }).first();
  await expect(row).toContainText("used up");
  await expect(row).toContainText("1 / 1");

  // The operations page shows the registration mode of this (open) server and the invite count.
  await staff.goto("/admin/operations");
  await expect(staff.getByRole("heading", { level: 1, name: "Operations" })).toBeVisible();
  await expect(staff.getByText("Migrations applied")).toBeVisible();
  await expect(staff.getByText(/active invites/)).toBeVisible();

  await staffContext.close();
  await visitor.close();
  await second.close();
});
