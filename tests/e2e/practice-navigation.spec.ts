import { expect, test } from "@playwright/test";
import { completeOnboarding, register, throwawayPassword, uniqueEmail } from "./helpers";

test.describe.configure({ timeout: 90_000 });

test("the Practice tab opens the practice hub, which leads to the learner's next lesson", async ({
  page,
}, testInfo) => {
  await register(page, "Navigator", uniqueEmail(testInfo.project.name), throwawayPassword());
  await completeOnboarding(page);

  // The tab is in the main navigation (sidebar on desktop, bottom bar on phones).
  const main = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
  await main.getByRole("link", { name: "Practice" }).click();
  await expect(page).toHaveURL(/\/practice$/);
  await expect(page.getByRole("heading", { level: 1, name: "Ready to Practice?" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Practice" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Real data: a new learner's next lesson, and nothing due yet.
  await expect(page.getByText("Next up: “Saying hello”.")).toBeVisible();
  await expect(page.getByText(/Nothing is due right now/)).toBeVisible();
  await page.getByRole("link", { name: "Start lesson" }).click();
  await expect(page.getByRole("heading", { name: "Saying hello" })).toBeVisible();

  // No horizontal scrolling with six tabs, at any project width.
  await page.goto("/practice");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
});

test("the practice hub needs a signed-in learner", async ({ page }) => {
  await page.goto("/practice");
  await expect(page).toHaveURL(/\/login/);
});
