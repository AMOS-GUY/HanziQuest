/**
 * M19 learner-experience regressions (docs/m19/M19-findings.md). Each test pins one confirmed
 * finding so it can't silently come back.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { completeOnboarding, register, throwawayPassword, uniqueEmail } from "./helpers";

test.describe.configure({ timeout: 120_000 });

test("F-01: the landing page's call to action is on the first screen of a small phone", async ({
  page,
}, info) => {
  test.skip(!!info.project.use.isMobile, "Runs once; it sets its own phone viewports");
  for (const size of [
    { width: 375, height: 667 },
    { width: 360, height: 780 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/");
    const cta = page.getByRole("link", { name: "Join the quest" });
    await expect(cta).toBeVisible();
    const box = (await cta.boundingBox())!;
    expect(box.y + box.height, `${size.width}×${size.height}`).toBeLessThanOrEqual(size.height);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test("F-03/F-04: onboarding works by keyboard, and each new question takes focus", async ({
  page,
}, info) => {
  test.skip(!!info.project.use.isMobile, "Keyboard flow; runs on desktop");
  await register(page, "Keyboard Learner", uniqueEmail(info.project.name), throwawayPassword());
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
  const options = page.getByRole("radio");
  await expect(options.first()).toBeVisible();
  // One tab stop for the group; arrows move and select (wait for hydration to settle).
  await expect(async () => {
    await options.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-checked", "true", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(options.nth(1)).toBeFocused();
  expect(await options.evaluateAll((els) => els.map((e) => (e as HTMLElement).tabIndex))).toEqual([
    -1, 0, -1, -1,
  ]);
  await page.keyboard.press("End");
  await expect(options.last()).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Have you studied for the HSK?" }),
  ).toBeFocused();
});

test("F-05/F-06: account deletion is styled as destructive and readable in light and dark", async ({
  page,
}, info) => {
  test.skip(!!info.project.use.isMobile, "Runs once");
  await register(page, "Danger Zone", uniqueEmail(info.project.name), throwawayPassword());
  await completeOnboarding(page);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/profile");
    await page.getByText("Delete my account", { exact: true }).click();
    const button = page.getByRole("button", { name: "Delete my account permanently" });
    await expect(button).toBeVisible();
    // The danger colour, not the primary one.
    const bg = await button.evaluate((b) => getComputedStyle(b).backgroundColor);
    const danger = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--danger").trim(),
    );
    expect(danger).not.toBe("");
    expect(bg).not.toBe(
      await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.backgroundColor = "var(--primary)";
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      }),
    );
    const axe = await new AxeBuilder({ page })
      .include("details")
      .withRules(["color-contrast"])
      .analyze();
    expect(axe.violations.map((v) => `${colorScheme}: ${v.id}`)).toEqual([]);
  }
});

test("F-07: small header and footer links are comfortable touch targets", async ({
  page,
}, info) => {
  test.skip(!info.project.use.isMobile, "Phone layout only");
  await page.goto("/beta-guide");
  for (const name of ["Join the beta", "Beta guide", "Privacy", "Terms"]) {
    const box = (await page.getByRole("link", { name, exact: true }).first().boundingBox())!;
    expect(box.height, name).toBeGreaterThanOrEqual(24);
  }
  await register(page, "Thumb", uniqueEmail(info.project.name), throwawayPassword());
  await completeOnboarding(page);
  await page.goto("/home");
  const feedback = (await page
    .getByRole("banner")
    .getByRole("link", { name: "Feedback" })
    .boundingBox())!;
  expect(feedback.height).toBeGreaterThanOrEqual(44);
});
