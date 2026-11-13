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
  test.skip(!!testInfo.project.use.isMobile, "Admin tools are desktop-first; runs once");
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

  // A published lesson in a draft curriculum is still invisible to learners. Publishing the
  // curriculum releases it to the learning path.
  await page.goto("/learn");
  await expect(page.getByRole("heading", { name: `E2E ${slug}` })).toHaveCount(0);
  await page.goto("/admin/curricula");
  await page.getByRole("link", { name: `E2E ${slug}` }).click();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish curriculum" }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  await page.goto("/learn");
  await expect(page.getByRole("heading", { name: `E2E ${slug}` })).toBeVisible();
  await expect(
    page.getByRole("region", { name: `E2E ${slug}` }).getByText("Hello again"),
  ).toBeVisible();
  // Withdraw it again so other tests' learning paths are unaffected.
  await page.goto("/admin/curricula");
  await page.getByRole("link", { name: `E2E ${slug}` }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived", { exact: true })).toBeVisible();

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
        // Imports must cite the source register (M14).
        sourceRefs: ["hanziquest-authored"],
        licenseStatus: "ORIGINAL",
        verification: "PROVISIONAL",
      },
      level: { level: 1, name: "L1" },
      // Same reading and gloss as the starter curriculum: characters are shared, and a test
      // must not rewrite real content.
      characters: { 人: { pinyin: "rén", meaning: "person" } },
      units: [
        {
          slug: "u1",
          title: "U1",
          lessons: [
            {
              slug: "l1",
              title: "L1",
              words: [
                {
                  simplified: "人",
                  pinyin: "rén",
                  meaning: "person; people",
                  partOfSpeech: "noun",
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("Validation passed.")).toBeVisible();
  // Validation also previews what the import would change, read-only.
  await expect(page.getByText("— Import preview —")).toBeVisible();
  await expect(page.getByText(/^Lessons: 1 new/)).toBeVisible();
  // M13: the advisory confusable-character check is shown, and it doesn't block the import.
  await expect(page.getByText("— Confusable characters —")).toBeVisible();
  await expect(
    page.getByText(/^Confusable-character check \(advisory; synthetic ink/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import as drafts" }).click();
  await expect(page.getByText(/Imported: 1 new lessons \(as drafts\)/)).toBeVisible({
    timeout: 30_000,
  });

  // Content quality report
  await page.goto("/admin/content-quality");
  await expect(page.getByRole("heading", { level: 1, name: "Content quality" })).toBeVisible();
  // Two tables name the curriculum: the quality table and (M14-b) review progress.
  await expect(
    page
      .getByRole("region", { name: "Curricula quality (scrolls sideways)" })
      .getByRole("cell", { name: "HSK 1 Starter", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Review progress (scrolls sideways)" })
      .getByRole("cell", { name: /^HSK 1 Starter \(/ }),
  ).toBeVisible();

  // Handwriting lab (M12): no recording without consent; consent, record, erase, refused.
  const code = `TEST${Date.now() % 100_000_000}`;
  await page.goto("/admin/handwriting");
  const recordSampleOnce = async () => {
    await page.getByLabel("Participant code", { exact: true }).fill(code);
    await page.getByLabel("Character asked for").selectOption("你");
    await page.getByLabel(/signed consent is recorded/).check();
    // A refused attempt keeps its ink on the canvas: start each attempt from a clean canvas.
    const clear = page.getByRole("button", { name: "Clear" });
    if (await clear.isEnabled()) await clear.click();
    await writeOnCanvas(page, "你");
    await page.getByRole("button", { name: "Record", exact: true }).click();
  };
  await recordSampleOnce();
  await expect(page.getByText(/No consent is recorded for this code/)).toBeVisible({
    timeout: 15_000,
  });

  await page.getByLabel("Code giving consent").fill(code);
  await page.getByLabel("Date signed (YYYY-MM-DD)").fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel("Signed form").selectOption("yes");
  await page.getByRole("button", { name: "Record consent" }).click();
  await expect(page.getByText(`Consent pilot-v0.1 recorded for ${code}.`)).toBeVisible();

  await page.getByLabel("Hesitated").check();
  await recordSampleOnce();
  await expect(page.getByText("Sample saved.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("accepted (as expected)")).toBeVisible();

  // Erasure is Super Admin only: hidden (and refused server-side) for curriculum editors.
  await expect(page.getByLabel("Code to erase")).toHaveCount(0);
  await grantRole(email, "SUPER_ADMIN");
  await page.reload();
  await page.getByLabel("Code to erase").fill(code);
  await page.getByLabel("Reason").selectOption("WITHDRAWAL");
  await page.getByLabel("Type the code again to confirm").fill(code);
  await page.getByRole("button", { name: "Erase permanently" }).click();
  await expect(page.getByText(`${code}: 1 sample(s) deleted`)).toBeVisible();

  await recordSampleOnce();
  await expect(page.getByText(/has withdrawn/)).toBeVisible({ timeout: 15_000 });
});

test("learners can't reach admin pages, and the 404 reveals nothing", async ({
  page,
}, testInfo) => {
  test.skip(!!testInfo.project.use.isMobile, "Runs once");
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
