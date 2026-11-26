import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { completeOnboarding, register, throwawayPassword, uniqueEmail } from "./helpers";

test.describe.configure({ timeout: 120_000 });

test("the vocabulary explorer lists reached words, searches them and hides locked ones (M16.1)", async ({
  page,
}, info) => {
  await register(page, "Word Explorer", uniqueEmail(info.project.name), throwawayPassword());
  await completeOnboarding(page);

  await page.goto("/vocabulary");
  await expect(page.getByRole("heading", { level: 1, name: "Your words" })).toBeVisible();
  // A new learner has reached the first lesson only.
  const words = page.locator("main ul a[href^='/vocabulary/']");
  await expect(words.first()).toBeVisible();
  const total = await words.count();
  expect(total).toBeGreaterThan(0);
  await expect(page.getByRole("status")).toHaveText(`${total} word${total === 1 ? "" : "s"}`);
  await expect(page.getByText("More words unlock as you continue")).toBeVisible();
  // The lesson filter only offers reached lessons ("All" plus the first lesson).
  await expect(page.locator("#vocab-lesson option")).toHaveCount(2);

  // Search by toneless pinyin through the real form.
  await page.getByLabel("Search").fill("ni hao");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/[?&]q=ni\+hao/);
  await expect(words).toHaveCount(1);
  await expect(words.first()).toContainText("你好");
  await expect(page.getByRole("status")).toHaveText(`1 of ${total} words`);

  // A word from a later, locked lesson can't be found by search.
  await page.goto("/vocabulary?q=xiexie");
  await expect(page.getByText("No matching words")).toBeVisible();
  await expect(words).toHaveCount(0);

  // A word card opens the existing word page.
  await page.goto("/vocabulary");
  await words.first().click();
  await expect(page).toHaveURL(/\/vocabulary\/[^/?]+$/);

  // No sideways scrolling, no axe violations.
  await page.goto("/vocabulary");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.reload();
    await expect(words.first()).toBeVisible();
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(axe.violations.map((v) => `${colorScheme}: ${v.id}`)).toEqual([]);
  }
});

test("the vocabulary explorer needs a signed-in learner (M16.1)", async ({ page }, info) => {
  test.skip(!!info.project.use.isMobile, "Runs once");
  await page.goto("/vocabulary?q=ni");
  await expect(page).toHaveURL(/\/login/);
});
