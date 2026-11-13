import { expect, test } from "@playwright/test";
import { completeOnboarding, grantRole, register, throwawayPassword, uniqueEmail } from "./helpers";

test.describe.configure({ timeout: 120_000 });

test("a content reviewer can review but not edit; refused approvals explain why", async ({
  page,
}, testInfo) => {
  test.skip(!!testInfo.project.use.isMobile, "Admin tools are desktop-first; runs once");
  const email = uniqueEmail("reviewer");
  await register(page, "Reviewer", email, throwawayPassword());
  await completeOnboarding(page);
  await grantRole(email, "CONTENT_REVIEWER");

  await page.goto("/admin/review");
  await expect(page.getByRole("heading", { level: 1, name: "Content review" })).toBeVisible();
  await expect(page.getByText("Review progress")).toBeVisible();
  await expect(page.getByRole("link", { name: "Review", exact: true })).toBeVisible();

  const form = page.locator("form").filter({ hasText: "Record decision" }).first();
  // Requesting changes needs a note.
  await form.getByLabel("Decision").selectOption("REQUEST_CHANGES");
  await form.getByRole("button", { name: "Record decision" }).click();
  await expect(form.getByText(/Say what needs to change/)).toBeVisible();
  // Approval is refused with the reason (the repository's sources await the owner's approval,
  // or the item has no source, or the curriculum's items aren't approved).
  await form.getByLabel("Decision").selectOption("APPROVE_REVIEWED");
  await form.getByRole("button", { name: "Record decision" }).click();
  await expect(form.getByRole("alert")).toContainText("Can't approve");
  // A note-backed request for changes is recorded.
  await form.getByLabel("Decision").selectOption("REQUEST_CHANGES");
  await form.getByLabel("Note").fill("E2E: please check the gloss.");
  await form.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText(/Changes requested\. \(review/)).toBeVisible({ timeout: 15_000 });

  // Least privilege: no editing or importing. Inside /admin the response is a "soft" not-found
  // (status 200, because the admin loading boundary streams first): assert what's rendered.
  for (const path of ["/admin/characters/new", "/admin/vocabulary/new", "/admin/import"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" }),
      path,
    ).toBeVisible();
    await expect(page.locator("form"), path).toHaveCount(0);
  }
});

test("curriculum editors can't open the review queue", async ({ page }, testInfo) => {
  test.skip(!!testInfo.project.use.isMobile, "Runs once");
  const email = uniqueEmail("editor-noreview");
  await register(page, "Editor", email, throwawayPassword());
  await completeOnboarding(page);
  await grantRole(email, "CURRICULUM_EDITOR");
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: "Review", exact: true })).toHaveCount(0);
  await page.goto("/admin/review");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Content review" })).toHaveCount(0);
  await expect(page.locator("form").filter({ hasText: "Record decision" })).toHaveCount(0);
});
