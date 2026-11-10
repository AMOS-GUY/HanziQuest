import { expect, test } from "@playwright/test";
import {
  completeOnboarding,
  register,
  throwawayPassword,
  uniqueEmail,
  writeCurrentExercise,
} from "./helpers";

test.describe.configure({ timeout: 120_000 });

test("a downloaded lesson can be practised offline and syncs into progress", async ({
  page,
  context,
}, testInfo) => {
  test.skip(!!testInfo.project.use.isMobile, "Offline flow runs once (desktop)");
  await register(page, "Offline", uniqueEmail(testInfo.project.name), throwawayPassword());
  await completeOnboarding(page);

  await page.getByRole("link", { name: "Start" }).click();
  await expect(page.getByRole("heading", { name: "Saying hello" })).toBeVisible();
  await page.getByRole("button", { name: "Download for offline" }).click();
  await expect(page.getByText("Available offline")).toBeVisible();

  // The service worker precaches the offline pages during install.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await context.setOffline(true);
  await page.goto("/learn");
  await expect(page.getByRole("heading", { name: "Offline practice" })).toBeVisible();
  await page.getByRole("link", { name: "Practise" }).click();
  await expect(page).toHaveURL(/\/offline\/practice\?lesson=/);

  await writeCurrentExercise(page);
  const check = page.getByRole("button", { name: "Check" });
  if (await check.isVisible()) await check.click();
  await expect(page.getByText("Saved on this device. It will sync")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("status").filter({ hasText: "1 saved on this device" }),
  ).toBeVisible();

  await context.setOffline(false);
  await expect(
    page.getByRole("status").filter({ hasText: /saved on this device|Syncing/ }),
  ).toHaveCount(0, { timeout: 20_000 });

  await page.goto("/progress");
  const totalXp = page.getByText("Total XP").locator("xpath=preceding-sibling::p[1]");
  await expect(totalXp).not.toHaveText("0");
  await expect(page.getByRole("link", { name: /^你/ })).toBeVisible();
});
