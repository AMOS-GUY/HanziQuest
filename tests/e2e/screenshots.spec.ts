/**
 * Documentation screenshots (opt-in): SCREENSHOTS=1 npx playwright test screenshots
 * Writes PNGs to docs/screenshots/ from the current build. Not an assertion-based test.
 */
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  completeOnboarding,
  register,
  throwawayPassword,
  uniqueEmail,
  writeOnCanvas,
} from "./helpers";

test.skip(!process.env.SCREENSHOTS, "Set SCREENSHOTS=1 to regenerate documentation screenshots");
test.describe.configure({ timeout: 180_000 });

const OUT = path.resolve(process.cwd(), "docs/screenshots");

for (const scheme of ["light", "dark"] as const) {
  test(`screens (${scheme})`, async ({ page }, testInfo) => {
    const device = testInfo.project.name;
    // Light on desktop, dark on the phone: one set each keeps the repository small.
    test.skip((scheme === "light") !== (device === "desktop"), "light on desktop, dark on mobile");
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const shot = (name: string) =>
      page.screenshot({ path: path.join(OUT, `${device}-${scheme}-${name}.png`) });

    await register(page, "Mei", uniqueEmail("shots"), throwawayPassword());
    await completeOnboarding(page);
    await page.waitForLoadState("networkidle");
    await shot("home");

    await page.goto("/learn");
    await page.waitForLoadState("networkidle");
    await shot("learn");

    await page.goto("/practice/character/你");
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("img", { name: /Writing area/ })).toBeVisible();
    await writeOnCanvas(page, "你");
    await shot("writing");
    await page.getByRole("button", { name: "Check" }).click();
    await expect(page.getByRole("group", { name: "Result" })).toBeVisible();
    await page.waitForTimeout(300);
    await shot("feedback");

    await page.goto("/progress");
    await page.waitForLoadState("networkidle");
    await shot("progress");
  });
}
