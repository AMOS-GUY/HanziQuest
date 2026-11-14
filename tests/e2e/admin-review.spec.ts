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
  // The page confirms what was recorded and moves focus to the confirmation.
  const confirmation = page.getByRole("status").filter({ hasText: /^Recorded:/ });
  await expect(confirmation).toContainText("returned with a request for changes", {
    timeout: 15_000,
  });
  await expect(confirmation).toBeFocused();

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

test("the admin import refuses files that declare REVIEWED or VERIFIED (D-074)", async ({
  page,
}, testInfo) => {
  test.skip(!!testInfo.project.use.isMobile, "Runs once");
  await import("dotenv/config");
  const email = uniqueEmail("status-importer");
  await register(page, "Importer", email, throwawayPassword());
  await completeOnboarding(page);
  await grantRole(email, "CURRICULUM_EDITOR");
  for (const verification of ["REVIEWED", "VERIFIED"]) {
    const slug = `e2e-status-${verification.toLowerCase()}-${Date.now()}`;
    await page.goto("/admin/import");
    await page.getByLabel("Or paste the JSON").fill(
      JSON.stringify({
        curriculum: {
          slug,
          name: "Status injection",
          framework: "CUSTOM",
          version: slug,
          source: "e2e",
          sourceRefs: ["hanziquest-authored"],
          licenseStatus: "ORIGINAL",
          verification,
        },
        level: { level: 1, name: "L1" },
        characters: { 人: { pinyin: "rén", meaning: "person" } },
        units: [
          {
            slug: "u1",
            title: "U1",
            lessons: [
              {
                slug: "l1",
                title: "L1",
                words: [{ simplified: "人", pinyin: "rén", meaning: "person; people" }],
              },
            ],
          },
        ],
      }),
    );
    await page.getByRole("button", { name: "Validate" }).click();
    await expect(page.getByText(/may only declare PROVISIONAL/).first()).toBeVisible();
    await expect(page.getByText("Validation passed.")).toHaveCount(0);
    // Importing anyway is refused by the server too.
    const importButton = page.getByRole("button", { name: "Import as drafts" });
    if (await importButton.isVisible()) {
      await importButton.click();
      await expect(
        page.getByText(/Fix the validation errors first|may only declare/).first(),
      ).toBeVisible();
    }
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const r = await client.query(`SELECT count(*)::int AS n FROM "Curriculum" WHERE slug = $1`, [
        slug,
      ]);
      expect(r.rows[0].n, verification).toBe(0);
    } finally {
      await client.end();
    }
  }
});

test("the review queue works by keyboard alone and fits a phone screen", async ({
  page,
}, testInfo) => {
  const email = uniqueEmail("reviewer-keyboard");
  await register(page, "Reviewer K", email, throwawayPassword());
  await completeOnboarding(page);
  await grantRole(email, "CONTENT_REVIEWER");
  await page.goto("/admin/review");
  await expect(page.getByRole("heading", { level: 1, name: "Content review" })).toBeVisible();

  if (testInfo.project.use.isMobile) {
    // No sideways scrolling at phone width, even with long Chinese text and fingerprints.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    return;
  }

  // Keyboard only: reach the first decision, choose, write a note, submit with Enter.
  const form = page.locator("form").filter({ hasText: "Record decision" }).first();
  const decision = form.getByLabel("Decision");
  await decision.focus();
  await page.keyboard.press("Tab"); // to the note
  await expect(form.getByLabel("Note")).toBeFocused();
  await page.keyboard.type("E2E: keyboard-only request.");
  await page.keyboard.press("Tab"); // to the submit button
  await expect(form.getByRole("button", { name: "Record decision" })).toBeFocused();
  await page.keyboard.press("Enter");
  const confirmation = page.getByRole("status").filter({ hasText: /^Recorded:/ });
  await expect(confirmation).toContainText("returned with a request for changes", {
    timeout: 15_000,
  });
  // Focus lands on the confirmation, so keyboard and screen-reader users know where they are.
  await expect(confirmation).toBeFocused();
});
