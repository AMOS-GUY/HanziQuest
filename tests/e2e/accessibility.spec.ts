/**
 * Automated accessibility and responsive-layout checks (M8). axe-core checks WCAG 2.1 A/AA
 * rules that can be detected automatically: contrast, names, labels, landmarks, ARIA. It can't
 * judge everything (e.g. meaningful focus order), so manual review is still needed.
 * Each page is checked in light and dark mode, on desktop and on the mobile project.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { completeOnboarding, grantRole, register, throwawayPassword, uniqueEmail } from "./helpers";

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

    for (const path of [
      "/",
      "/login",
      "/register",
      "/reset-password?token=expired",
      "/privacy",
      "/terms",
      "/beta-guide",
    ]) {
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

/** Admin pages (integration audit). Staff use them on desktop and on phones. */
const ADMIN_LISTS = [
  "/admin",
  "/admin/curricula",
  "/admin/lessons",
  "/admin/characters",
  "/admin/characters/new",
  "/admin/vocabulary",
  "/admin/vocabulary/new",
  "/admin/import",
  "/admin/content-quality",
  "/admin/review",
  "/admin/handwriting",
  "/admin/feedback",
  "/admin/users",
  "/admin/audit-logs",
  "/admin/invites",
  "/admin/operations",
];

/** Detail pages, reached through the first matching link on a list page. */
const ADMIN_DETAILS: [list: string, link: RegExp][] = [
  ["/admin/curricula", /^\/admin\/curricula\/[^/]+$/],
  ["/admin/lessons", /^\/admin\/lessons\/[^/]+$/],
  ["/admin/characters", /^\/admin\/characters\/(?!new)[^/]+$/],
  ["/admin/vocabulary", /^\/admin\/vocabulary\/(?!new)[^/]+$/],
  ["/admin/users", /^\/admin\/users\/[^/]+$/],
];

for (const scheme of ["light", "dark"] as const) {
  test(`admin pages have no detectable WCAG A/AA violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const findings: Finding[] = [];
    const email = uniqueEmail(`a11y-admin-${scheme}`);
    await register(page, "A11y Admin", email, throwawayPassword());
    await completeOnboarding(page);
    await grantRole(email, "SUPER_ADMIN");

    const paths = [...ADMIN_LISTS];
    for (const [list, link] of ADMIN_DETAILS) {
      await visit(page, list);
      const hrefs = await page
        .locator('main a[href^="/admin/"]')
        .evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
      const href = hrefs.find((h) => link.test(h));
      expect(href, `a detail link on ${list}`).toBeTruthy();
      paths.push(href!);
    }
    // A lesson's exercise editor and learner preview, and a unit, from the lesson page.
    await visit(
      page,
      paths.find((p) => /^\/admin\/lessons\/[^/]+$/.test(p))!,
    );
    const lessonLinks = await page
      .locator('main a[href^="/admin/"]')
      .evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
    for (const pattern of [
      /^\/admin\/exercises\/[^/]+$/,
      /^\/admin\/lessons\/[^/]+\/preview$/,
      /^\/admin\/units\/[^/]+$/,
    ]) {
      const href = lessonLinks.find((h) => pattern.test(h));
      expect(href, `${pattern} on the lesson page`).toBeTruthy();
      paths.push(href!);
    }

    for (const path of paths) {
      await visit(page, path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
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
