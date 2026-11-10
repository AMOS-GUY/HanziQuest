import { expect, test } from "@playwright/test";
import { completeOnboarding, grantRole, register, throwawayPassword, uniqueEmail } from "./helpers";

test.describe.configure({ timeout: 120_000 });

test("public beta pages are reachable and clearly marked as drafts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "How the beta works" })).toBeVisible();
  for (const [link, heading] of [
    ["Privacy", "Privacy notice"],
    ["Terms", "Beta terms of use"],
    ["Beta guide", "Beta testing guide"],
  ] as const) {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Legal and help" })
      .getByRole("link", { name: link })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  await page.goto("/privacy");
  await expect(page.getByRole("note")).toContainText("not yet reviewed by a lawyer");
  await page.goto("/terms");
  await expect(page.getByRole("note")).toContainText("not yet reviewed by a lawyer");
});

test("a learner sends feedback and staff triage it", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop and other browsers only");
  const learner = { email: uniqueEmail("fb"), password: throwawayPassword() };
  await register(page, "Feedback Learner", learner.email, learner.password);
  await completeOnboarding(page);
  // New accounts accepted the terms at sign-up, so no prompt.
  await expect(page.getByRole("region", { name: "Beta terms" })).toHaveCount(0);

  const marker = `e2e feedback ${Date.now()}`;
  await page.goto("/feedback?kind=CONTENT&from=/learn");
  await expect(page.getByLabel("What is it about?")).toHaveValue("CONTENT");
  await page.getByLabel("Your message").fill("short");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByText("at least 10 characters")).toBeVisible();
  await page.getByLabel("Your message").fill(`${marker}: the gloss for 你 looks wrong`);
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByText("Thank you! Your feedback was sent")).toBeVisible();

  // Learners can't see the inbox.
  expect((await page.goto("/admin/feedback"))?.status()).toBe(404);

  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  const staffEmail = uniqueEmail("support");
  await register(staff, "Support", staffEmail, throwawayPassword());
  await completeOnboarding(staff);
  await grantRole(staffEmail, "SUPPORT");
  await staff.goto("/admin/feedback");
  const item = staff.locator("li").filter({ hasText: marker });
  await expect(item).toBeVisible();
  await expect(item).toContainText("/learn");
  // Contact details are hidden unless the learner opted in.
  await expect(item).not.toContainText(learner.email);
  await item.getByText("Update status").click();
  await item.getByLabel("Status").selectOption("TRIAGED");
  await item.getByRole("button", { name: "Update" }).click();
  // Triaged items leave the "new" list and appear under "triaged".
  await expect(item).toHaveCount(0);
  await staff.goto("/admin/feedback?status=TRIAGED");
  await expect(staff.locator("li").filter({ hasText: marker })).toBeVisible();
  await staffContext.close();
});
