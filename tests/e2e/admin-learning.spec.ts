import { expect, test } from "@playwright/test";
import { completeOnboarding, grantRole, register, throwawayPassword, uniqueEmail } from "./helpers";

test.describe.configure({ timeout: 90_000 });

test("the learning measurement page stays off until approved, even for analysts (D-079)", async ({
  page,
}, testInfo) => {
  test.skip(!!testInfo.project.use.isMobile, "Runs once");
  const email = uniqueEmail("analyst");
  await register(page, "Analyst", email, throwawayPassword());
  await completeOnboarding(page);
  await grantRole(email, "ANALYST");
  await page.goto("/admin");
  // No navigation entry while it's off.
  await expect(page.getByRole("link", { name: /learning measurement/i })).toHaveCount(0);
  await page.goto("/admin/learning");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Learning measurement" })).toHaveCount(0);
});
