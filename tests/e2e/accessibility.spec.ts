/**
 * Automated accessibility and responsive-layout checks (M8). axe-core checks WCAG 2.1 A/AA
 * rules that can be detected automatically: contrast, names, labels, landmarks, ARIA. It can't
 * judge everything (e.g. meaningful focus order), so manual review is still needed.
 * Each page is checked in light and dark mode, on desktop and on the mobile project.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { completeOnboarding, register, throwawayPassword, uniqueEmail } from "./helpers";

test.describe.configure({ timeout: 240_000 });

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

interface Finding {
  page: string;
  scheme: string;
  rule: string;
  impact: string | null | undefined;
  targets: string[];
  help: string;
}

async function audit(page: Page, path: string, scheme: string, findings: Finding[]) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const v of results.violations) {
    findings.push({
      page: path,
      scheme,
      rule: v.id,
      impact: v.impact,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
      help: v.help,
    });
  }
  // No horizontal scrolling: content must fit the viewport (320 px phones included).
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 1) {
    findings.push({
      page: path,
      scheme,
      rule: "horizontal-overflow",
      impact: "serious",
      targets: [`${overflow}px wider than the viewport`],
      help: "Content overflows the viewport horizontally",
    });
  }
}

async function visit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

for (const scheme of ["light", "dark"] as const) {
  test(`learner and public pages have no detectable WCAG A/AA violations (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const findings: Finding[] = [];

    for (const path of ["/", "/login", "/register", "/privacy", "/terms", "/beta-guide"]) {
      await visit(page, path);
      await audit(page, path, scheme, findings);
    }

    await register(page, "A11y Learner", uniqueEmail(`a11y-${scheme}`), throwawayPassword());
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
    await page.waitForLoadState("networkidle");
    await audit(page, "/onboarding", scheme, findings);
    await completeOnboarding(page);

    await visit(page, "/learn");
    const lessonHref = await page.locator('a[href^="/learn/"]').first().getAttribute("href");
    expect(lessonHref).toBeTruthy();
    const lessonId = lessonHref!.split("/").pop()!;

    for (const path of [
      "/home",
      "/learn",
      `/learn/${lessonId}`,
      `/practice/lesson/${lessonId}`,
      "/practice/character/你",
      "/characters/你",
      "/review",
      "/progress",
      "/profile",
      "/feedback",
      "/offline",
      "/placement",
    ]) {
      await visit(page, path);
      await audit(page, path, scheme, findings);
    }

    const report = findings
      .map(
        (f) =>
          `${f.page} [${f.scheme}] ${f.rule} (${f.impact}): ${f.help}\n    ${f.targets.join("\n    ")}`,
      )
      .join("\n");
    expect(findings, report).toEqual([]);
  });
}
