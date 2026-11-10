import { expect, test } from "@playwright/test";
import {
  completeOnboarding,
  grantRole,
  register,
  throwawayPassword,
  uniqueEmail,
  writeOnCanvas,
} from "./helpers";

test.describe.configure({ timeout: 180_000 });

test("a curriculum editor builds, previews and publishes a lesson, imports content and records a handwriting sample", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Admin tools are desktop-first; runs once");
  const email = uniqueEmail("editor");
  await register(page, "Editor", email, throwawayPassword());
  await completeOnboarding(page);
  await grantRole(email, "CURRICULUM_EDITOR");
  const slug = `e2e-${Date.now()}`;

  // Curriculum → level → unit → lesson
  await page.goto("/admin/curricula");
  await page.getByLabel("Name").fill(`E2E ${slug}`);
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Version").fill(slug);
  await page.getByLabel("Source").fill("e2e test");
  await page.getByRole("button", { name: "Create curriculum" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `E2E ${slug}` })).toBeVisible();

  await page.getByLabel("Level number").fill("1");
  await page.getByRole("textbox", { name: "Name", exact: true }).last().fill("Level one");
  await page.getByRole("button", { name: "Add level" }).click();
  await expect(page.getByText("Level 1: Level one")).toBeVisible();

  await page.getByText("Add a unit").click();
  await page.getByLabel("Title").fill("Greetings");
  await page.getByLabel("Slug").fill("greetings");
  await page.getByRole("button", { name: "Create unit" }).click();
  await expect(page.getByRole("heading", { name: "Unit 1: Greetings" })).toBeVisible();

  await page.getByText("Add a lesson").click();
  await page.getByLabel("Title").last().fill("Hello again");
  await page.getByLabel("Slug").fill("hello-again");
  await page.getByRole("button", { name: "Create lesson (draft)" }).click();
  await expect(page.getByRole("heading", { name: "Hello again" })).toBeVisible();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();

  // Unknown words are refused; known ones generate characters and exercises.
  const words = page.getByLabel("Words");
  await words.fill("不存在 | bù cún zài");
  await page.getByRole("button", { name: "Save words" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "not in the vocabulary" })).toBeVisible();
  await words.fill("你好 | nǐ hǎo");
  await page.getByRole("button", { name: "Save words" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 characters" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /Exercises \(\d+\)/ })).toBeVisible();
  await expect(page.getByText("Revision history")).toBeVisible();

  // Preview a draft exactly as a learner would see it; nothing is saved.
  await page.getByRole("link", { name: "Preview as learner" }).click();
  await expect(page.getByText("Preview of a draft lesson")).toBeVisible();
  await expect(page.getByText("Provisional content")).toBeVisible();
  await expect(page.locator("text=/^1\\/\\d+$/")).toBeVisible();
  await page.getByRole("link", { name: "Back to editor" }).click();

  // Publish
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();

  // Field validation on a new character
  await page.goto("/admin/characters/new");
  await page.getByLabel("Character").fill("你");
  await page.getByLabel("Pinyin").fill("ni3");
  await page.getByLabel("Meaning").fill("you");
  await page.getByRole("button", { name: "Create character" }).click();
  await expect(page.getByText("tone marks", { exact: false }).last()).toBeVisible();
  // What the editor typed survives a failed submission.
  await expect(page.getByLabel("Meaning")).toHaveValue("you");

  // Import: invalid JSON is refused, valid content validates.
  await page.goto("/admin/import");
  await page.getByLabel("Or paste the JSON").fill("{ not json");
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("This is not valid JSON.")).toBeVisible();
  await page.getByLabel("Or paste the JSON").fill(
    JSON.stringify({
      curriculum: {
        slug: `${slug}-import`,
        name: "Imported",
        framework: "CUSTOM",
        version: `${slug}-import`,
        source: "e2e",
        licenseStatus: "ORIGINAL",
        verification: "PROVISIONAL",
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
              words: [{ simplified: "人", pinyin: "rén", meaning: "person" }],
            },
          ],
        },
      ],
    }),
  );
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("Validation passed.")).toBeVisible();
  await page.getByRole("button", { name: "Import as drafts" }).click();
  await expect(page.getByText(/Imported: 1 new lessons \(as drafts\)/)).toBeVisible({
    timeout: 30_000,
  });

  // Handwriting lab: record a labelled sample with consent.
  await page.goto("/admin/handwriting");
  await page.getByLabel("Participant code").fill("P99");
  await page.getByLabel("Character asked for").selectOption("你");
  await page.getByRole("checkbox").check();
  await writeOnCanvas(page, "你");
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByText("Sample saved.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("accepted (as expected)")).toBeVisible();
});

test("learners can't reach admin pages, and the 404 reveals nothing", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once");
  await register(page, "Learner", uniqueEmail("noadmin"), throwawayPassword());
  await completeOnboarding(page);
  for (const path of ["/admin", "/admin/curricula", "/admin/import", "/admin/handwriting"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    expect(await page.title()).not.toMatch(/admin|curricul|import|handwriting/i);
  }
  const api = await page.request.get("/api/admin/handwriting/samples");
  expect(api.status()).toBe(403);
});
