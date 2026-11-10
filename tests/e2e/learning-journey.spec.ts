import { expect, test } from "@playwright/test";
import {
  completeOnboarding,
  register,
  throwawayPassword,
  uniqueEmail,
  writeCurrentExercise,
} from "./helpers";

test.describe.configure({ timeout: 180_000 });

test("learner completes the first lesson by writing every exercise; progress persists", async ({
  page,
}, testInfo) => {
  test.skip(
    !!testInfo.project.use.isMobile,
    "Full lesson run once (desktop); mobile covered by the auth journey",
  );
  await register(page, "Writer", uniqueEmail(testInfo.project.name), throwawayPassword());
  await completeOnboarding(page);

  await page.getByRole("link", { name: "Start" }).click();
  await expect(page.getByRole("heading", { name: "Saying hello" })).toBeVisible();
  await page.getByRole("link", { name: /Start practice/ }).click();
  await expect(page).toHaveURL(/\/practice\/lesson\//);

  const counter = page.locator("text=/^\\d+\\/\\d+$/").first();
  await expect(counter).toBeVisible();
  const total = Number((await counter.textContent())!.split("/")[1]);

  for (let i = 0; i < total; i += 1) {
    await expect(counter).toHaveText(`${i + 1}/${total}`);
    await writeCurrentExercise(page);
    const check = page.getByRole("button", { name: "Check" });
    if (await check.isVisible()) await check.click();
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });
    // A correctly written exercise must be graded Excellent or Good.
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /Excellent|Good/ })
        .first(),
    ).toBeVisible();
    await page.getByRole("button", { name: i + 1 < total ? "Continue" : "Finish" }).click();
  }

  await expect(page.getByRole("heading", { name: "Lesson complete!" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("link", { name: "Next lesson" }).click();
  await expect(page.getByRole("heading", { name: "Thanks and goodbye" })).toBeVisible();

  // Progress persists across reloads.
  await page.goto("/learn");
  await page.reload();
  await expect(page.getByRole("link", { name: "Saying hello, Completed" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Thanks and goodbye, Start" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sorry and please, Locked" })).toBeVisible();
});

test("a locked lesson cannot be practised", async ({ page }, testInfo) => {
  await register(page, "Locked", uniqueEmail(testInfo.project.name), throwawayPassword());
  await completeOnboarding(page);
  await page.goto("/learn");
  const locked = page.getByRole("link", { name: "Sorry and please, Locked" });
  const href = await locked.getAttribute("href");
  await page.goto(href!.replace("/learn/", "/practice/lesson/"));
  await expect(page).toHaveURL(href!);
  await expect(page.getByText("Finish the previous lesson to unlock this one.")).toBeVisible();
});

test("stroke-order page plays and steps through strokes", async ({ page }, testInfo) => {
  await register(page, "Strokes", uniqueEmail(testInfo.project.name), throwawayPassword());
  await completeOnboarding(page);
  await page.goto(`/characters/${encodeURIComponent("你")}`);
  await expect(page.getByRole("img", { name: "Stroke order of 你" })).toBeVisible();
  await page.getByRole("button", { name: "Pause animation" }).click();
  await page.getByRole("button", { name: "Replay from the start" }).click();
  await page.getByRole("button", { name: "Pause animation" }).click();
  await expect(page.getByText("7 strokes — press play or next")).toBeVisible();
  await page.getByRole("button", { name: "Next stroke" }).click();
  await page.getByRole("button", { name: "Next stroke" }).click();
  await expect(page.getByText("Stroke 2 of 7")).toBeVisible();
  await page.getByRole("button", { name: "Previous stroke" }).click();
  await expect(page.getByText("Stroke 1 of 7")).toBeVisible();
});
