import { expect, test } from "@playwright/test";
import {
  completeOnboarding,
  grantRole,
  register,
  setAccountStatus,
  throwawayPassword,
  uniqueEmail,
} from "./helpers";

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

/** Removes a role (test databases only, like `grantRole`). */
async function revokeRole(email: string, role: string) {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `DELETE FROM "UserRole" WHERE "userId" = (SELECT id FROM "User" WHERE email = $1)
       AND "roleId" = (SELECT id FROM "Role" WHERE key = $2::"RoleKey")`,
      [email, role],
    );
  } finally {
    await client.end();
  }
}

/** Review decisions recorded with this note (test databases only). */
async function decisionsWithNote(note: string) {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const r = await client.query(`SELECT count(*)::int AS n FROM "ContentReview" WHERE note = $1`, [
      note,
    ]);
    return r.rows[0].n as number;
  } finally {
    await client.end();
  }
}

test("an open review form is refused once the reviewer loses the permission or is suspended", async ({
  page,
}, testInfo) => {
  test.skip(!!testInfo.project.use.isMobile, "Runs once");
  await import("dotenv/config");
  const email = uniqueEmail("reviewer-revoked");
  await register(page, "Reviewer R", email, throwawayPassword());
  await completeOnboarding(page);
  // Also an editor, so the account stays staff and the request reaches the server action.
  await grantRole(email, "CURRICULUM_EDITOR");
  await grantRole(email, "CONTENT_REVIEWER");

  const submitAfter = async (change: () => Promise<void>, note: string) => {
    await page.goto("/admin/review");
    const form = page.locator("form").filter({ hasText: "Record decision" }).first();
    await form.getByLabel("Decision").selectOption("REQUEST_CHANGES");
    await form.getByLabel("Note").fill(note);
    await change();
    await form.getByRole("button", { name: "Record decision" }).click();
    return form;
  };

  // 1. The role is revoked while the form is open: the action checks the permission itself.
  const revokedNote = `E2E: after revocation ${Date.now()}`;
  const form = await submitAfter(() => revokeRole(email, "CONTENT_REVIEWER"), revokedNote);
  await expect(form.getByRole("alert")).toContainText("You do not have permission");
  expect(await decisionsWithNote(revokedNote)).toBe(0);

  // 2. Suspended while the form is open: the admin gate refuses the request before any action
  // runs (a 404 for everything under /admin), so nothing is recorded either.
  await grantRole(email, "CONTENT_REVIEWER");
  const suspendedNote = `E2E: after suspension ${Date.now()}`;
  try {
    await submitAfter(() => setAccountStatus(email, "SUSPENDED"), suspendedNote);
    const response = await page.goto("/admin/review");
    expect(response?.status()).toBe(404);
    expect(await decisionsWithNote(suspendedNote)).toBe(0);
  } finally {
    await setAccountStatus(email, "ACTIVE");
  }
});
