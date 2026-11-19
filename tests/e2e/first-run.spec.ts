import { expect, test, type Page } from "@playwright/test";
import { completeOnboarding, register, throwawayPassword, uniqueEmail } from "./helpers";

test.describe.configure({ timeout: 120_000 });

/** Onboarding up to the placement choice (as `completeOnboarding`, without the last step). */
async function onboardUpToPlacement(page: Page) {
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
  const choose = async (role: "radio" | "checkbox", name: string | RegExp) => {
    const option = page.getByRole(role, { name });
    await expect(async () => {
      if ((await option.getAttribute("aria-checked")) !== "true") await option.click();
      await expect(option).toHaveAttribute("aria-checked", "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
  };
  await choose("radio", "I'm completely new to Chinese");
  await page.getByRole("button", { name: "Continue" }).click();
  await choose("radio", "Not yet / not sure");
  await page.getByRole("button", { name: "Continue" }).click();
  await choose("checkbox", "Write characters by hand");
  await page.getByRole("button", { name: "Continue" }).click();
  await choose("radio", /^Regular/);
  await page.getByRole("button", { name: "Continue" }).click();
}

test("a new learner's review page leads to a first lesson (M15-c)", async ({ page }, info) => {
  await register(page, "First Run", uniqueEmail(info.project.name), throwawayPassword());
  await completeOnboarding(page);
  await page.goto("/review");
  await expect(page.getByText("Nothing to review yet")).toBeVisible();
  await expect(page.getByText("You're all caught up")).toHaveCount(0);
  // The week-ahead forecast only appears once something is scheduled.
  await expect(page.getByRole("heading", { name: "Coming up" })).toHaveCount(0);
  await page.getByRole("link", { name: "Start a lesson" }).click();
  await expect(page).toHaveURL(/\/learn$/);
  // No sideways scrolling on any screen size.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("a placement that skips nothing says why (M15-c)", async ({ page }, info) => {
  test.skip(!!info.project.use.isMobile, "Runs once");
  await register(page, "Placer", uniqueEmail(info.project.name), throwawayPassword());
  await onboardUpToPlacement(page);
  await page.getByRole("button", { name: "Take the placement check" }).click();
  await expect(page).toHaveURL(/\/placement/, { timeout: 15_000 });
  const counter = page.getByText(/^Question \d+ of \d+$/);
  await expect(counter).toBeVisible();
  const total = Number((await counter.textContent())!.match(/of (\d+)/)![1]);
  for (let q = 1; q <= total; q += 1) {
    // Answer each question only once it's on screen.
    await expect(counter).toHaveText(`Question ${q} of ${total}`);
    await page.getByRole("radio", { name: "I don't know" }).click();
    await page.getByRole("button", { name: /Next|Finish/ }).click();
  }
  await expect(page.getByRole("heading", { name: "Placement complete" })).toBeVisible();
  await expect(page.getByText(/You recognised 0 of \d+ characters/)).toBeVisible();
  await expect(
    page.getByText(/A unit is skipped only when you recognise every character we asked about/),
  ).toBeVisible();
});
