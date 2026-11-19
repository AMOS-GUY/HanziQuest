import { expect, test } from "@playwright/test";
import {
  completeOnboarding,
  grantRole,
  register,
  throwawayPassword,
  uniqueEmail,
  writeCurrentExercise,
} from "./helpers";

test.describe.configure({ timeout: 180_000 });

test("a learner disputes a handwriting result and a reviewer records a finding (M13)", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(!!testInfo.project.use.isMobile, "Runs once");
  await register(page, "Disputer", uniqueEmail("disputer"), throwawayPassword());
  await completeOnboarding(page);

  // Character practice: guided, then free writing (the result that can be disputed).
  await page.goto("/practice/character/你");
  for (let i = 0; i < 2; i += 1) {
    await writeCurrentExercise(page);
    const check = page.getByRole("button", { name: "Check" });
    if (await check.isVisible()) await check.click();
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });
    if (i === 0) await page.getByRole("button", { name: "Continue" }).click();
  }
  await page.getByRole("button", { name: "Grading looks wrong?" }).click();
  const form = page.getByRole("form", { name: "Dispute this result" });
  await expect(form).toBeFocused();
  const send = form.getByRole("button", { name: "Send to a reviewer" });
  await expect(send).toBeDisabled();
  await form.getByRole("radio", { name: "My strokes weren't captured properly" }).check();
  await expect(send).toBeDisabled(); // consent is required
  await form.getByRole("checkbox", { name: /A reviewer may look at this writing/ }).check();
  await send.click();
  await expect(
    page.getByRole("status").filter({ hasText: /A reviewer will look at it/ }),
  ).toBeVisible();

  await page.goto("/profile");
  await expect(
    page.getByRole("heading", { name: "Handwriting results you disputed" }),
  ).toBeVisible();
  await expect(page.getByText("Waiting for a reviewer")).toBeVisible();
  // A learner can't open the review page.
  await page.goto("/admin/disputes");
  expect(await page.title()).not.toMatch(/dispute/i);

  // A reviewer (curriculum editor) claims it and records a finding.
  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  const reviewerEmail = uniqueEmail("dispute-reviewer");
  await register(reviewer, "Reviewer", reviewerEmail, throwawayPassword());
  await completeOnboarding(reviewer);
  await grantRole(reviewerEmail, "CURRICULUM_EDITOR");
  await reviewer.goto("/admin/disputes");
  await expect(
    reviewer.getByRole("heading", { level: 1, name: "Handwriting disputes" }),
  ).toBeVisible();
  const card = reviewer
    .getByRole("article")
    .filter({ hasText: "My strokes weren't captured properly" })
    .first();
  await expect(card.getByRole("img", { name: /Learner's writing for 你/ })).toBeVisible();
  await card.getByRole("button", { name: "Review this" }).click();
  await expect(card.getByRole("button", { name: "The result was right" })).toBeVisible();
  await card.getByRole("button", { name: "The result was right" }).click();
  await reviewer.goto("/admin/disputes?status=RESOLVED");
  await expect(reviewer.getByText("The result was right").first()).toBeVisible();
  await reviewerContext.close();

  // The learner sees the finding; nothing about their result changed.
  await page.goto("/profile");
  await expect(page.getByText("The result was right")).toBeVisible();
});
