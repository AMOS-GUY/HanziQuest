import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export function uniqueEmail(project: string) {
  return `e2e-${project}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@hanziquest.test`;
}

/** Throwaway credential for a local/CI test database only. */
export function throwawayPassword() {
  return `e2e-${Math.random().toString(36).slice(2)}-pw`;
}

export async function register(page: Page, name: string, email: string, password: string) {
  await page.goto("/register");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("checkbox", { name: /beta terms/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
}

/** Completes onboarding with default answers and starts from the first lesson. */
export async function completeOnboarding(page: Page) {
  // Account creation hashes the password (bcrypt cost 12); allow for parallel test load.
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
  // The first click can land before React hydrates; retry until the selection registers.
  const choose = async (role: "radio" | "checkbox", name: string | RegExp) => {
    const option = page.getByRole(role, { name });
    await expect(async () => {
      if ((await option.getAttribute("aria-checked")) !== "true") await option.click();
      await expect(option).toHaveAttribute("aria-checked", "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
  };
  const next = async (heading: string | RegExp) => {
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  };
  await choose("radio", "I'm completely new to Chinese");
  await next("Have you studied for the HSK?");
  await choose("radio", "Not yet / not sure");
  await next("What are you learning for?");
  await choose("checkbox", "Write characters by hand");
  await next("Pick a daily goal");
  await choose("radio", /^Regular/);
  await next("Want to skip what you already know?");
  await page.getByRole("button", { name: "Start from the beginning" }).click();
  await expect(page).toHaveURL(/\/home$/);
}

/**
 * Writes the current practice exercise by replaying reference stroke medians as pointer input
 * (our canvas) or mouse input (Hanzi Writer guided quiz). Simulates a learner writing correctly.
 */
export async function writeCurrentExercise(page: Page) {
  const expected = await expectedAnswer(page);
  const guided = (await page.locator("[role=application]").count()) > 0;
  const prompt = guided ? ((await page.locator(".hanzi").first().textContent())?.trim() ?? "") : "";
  const medians = Object.fromEntries(
    [...new Set([...expected, ...[...prompt]])].map((h) => [h, strokeMedians(h)]),
  );
  // Stroke data comes from the test process, so this also works while the browser is offline.
  await page.evaluate(
    async ({ expected, medians }) => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const fetchMedians = async (hanzi: string) => medians[hanzi]!;
      const densify = (median: number[][]) => {
        const pts: number[][] = [];
        for (let i = 0; i < median.length - 1; i += 1)
          for (let k = 0; k < 5; k += 1)
            pts.push([
              median[i]![0]! + ((median[i + 1]![0]! - median[i]![0]!) * k) / 5,
              median[i]![1]! + ((median[i + 1]![1]! - median[i]![1]!) * k) / 5,
            ]);
        pts.push(median[median.length - 1]!);
        return pts;
      };

      const guidedHost = document.querySelector("[role=application]");
      if (guidedHost) {
        const svg = guidedHost.querySelector("svg")!;
        const prompt = document.querySelector(".hanzi")!.textContent!.trim();
        const rect = svg.getBoundingClientRect();
        const pad = Math.round(rect.width * 0.06);
        const scale = (rect.width - 2 * pad) / 1024;
        const at = ([x, y]: number[]) => ({
          clientX: rect.left + pad + x! * scale,
          clientY: rect.top + pad + (900 - y!) * scale,
        });
        for (const median of await fetchMedians(prompt)) {
          const pts = densify(median);
          svg.dispatchEvent(new MouseEvent("mousedown", { ...at(pts[0]!), bubbles: true }));
          for (const p of pts.slice(1)) {
            svg.dispatchEvent(new MouseEvent("mousemove", { ...at(p), bubbles: true }));
            await sleep(5);
          }
          document.dispatchEvent(
            new MouseEvent("mouseup", { ...at(pts[pts.length - 1]!), bubbles: true }),
          );
          svg.dispatchEvent(
            new MouseEvent("mouseup", { ...at(pts[pts.length - 1]!), bubbles: true }),
          );
          await sleep(450);
        }
        return;
      }

      const tabs = [...document.querySelectorAll("[role=tab]")] as HTMLButtonElement[];
      const count = Math.max(1, tabs.length);
      if (expected.length !== count)
        throw new Error(`expected ${count} characters, got ${expected.join("")}`);
      for (let i = 0; i < count; i += 1) {
        if (tabs[i]) {
          tabs[i]!.click();
          await sleep(100);
        }
        const canvas = document.querySelector("canvas")!;
        const rect = canvas.getBoundingClientRect();
        const at = ([x, y]: number[]) => ({
          clientX: rect.left + (0.1 + (0.8 * x!) / 1024) * rect.width,
          clientY: rect.top + (0.1 + (0.8 * (900 - y!)) / 1024) * rect.height,
        });
        for (const median of await fetchMedians(expected[i]!)) {
          const pts = densify(median);
          const fire = (type: string, p: number[]) =>
            canvas.dispatchEvent(
              new PointerEvent(type, {
                ...at(p),
                pointerId: 1,
                pointerType: "pen",
                isPrimary: true,
                button: 0,
                buttons: type === "pointerup" ? 0 : 1,
                bubbles: true,
              }),
            );
          fire("pointerdown", pts[0]!);
          for (const p of pts.slice(1)) fire("pointermove", p);
          fire("pointerup", pts[pts.length - 1]!);
          await sleep(60);
        }
      }
    },
    { expected, medians },
  );
}

function strokeMedians(hanzi: string): number[][][] {
  const file = path.resolve(process.cwd(), "node_modules/hanzi-writer-data", `${hanzi}.json`);
  if (!fs.existsSync(file)) return [];
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { medians: number[][][] }).medians;
}

type Content = {
  characters: Record<string, { pinyin: string; meaning: string }>;
  units: { lessons: { words: { simplified: string; pinyin: string; meaning: string }[] }[] }[];
};
const content = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "content/hsk1-starter.json"), "utf8"),
) as Content;
const words = content.units.flatMap((u) => u.lessons.flatMap((l) => l.words));

/** Works out the answer from the visible prompt, as a learner who knows the content would. */
async function expectedAnswer(page: Page): Promise<string[]> {
  await page.locator("[role=application] svg, canvas").first().waitFor();
  const label =
    (await page.locator("p.uppercase").first().textContent())?.trim().toLowerCase() ?? "";
  const big = (await page.locator("p.uppercase + p").first().textContent())?.trim() ?? "";
  let answer: string | undefined;
  if (label.startsWith("trace each stroke")) return [];
  if (label.startsWith("write it in characters"))
    answer = words.find((w) => w.pinyin === big)?.simplified;
  else if (label.startsWith("write the chinese for"))
    answer = words.find((w) => `“${w.meaning}”` === big)?.simplified;
  else if (label.startsWith("write from memory"))
    answer = Object.entries(content.characters).find(
      ([, c]) => big === `${c.pinyin} · ${c.meaning}`,
    )?.[0];
  if (!answer) throw new Error(`Could not resolve prompt: ${label} / ${big}`);
  return [...answer];
}

/** Grants a role to an account directly in the e2e database (test setup only). */
export async function grantRole(email: string, role: string) {
  const { Client } = await import("pg");
  await import("dotenv/config");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "UserRole" ("userId", "roleId")
       SELECT u.id, r.id FROM "User" u, "Role" r WHERE u.email = $1 AND r.key = $2::"RoleKey"
       ON CONFLICT DO NOTHING`,
      [email, role],
    );
  } finally {
    await client.end();
  }
}

/** Draws a character's reference strokes on the first writing canvas. */
export async function writeOnCanvas(page: Page, hanzi: string) {
  const medians = strokeMediansFor(hanzi);
  await page.locator("canvas").first().waitFor();
  await page.evaluate(async (medians: number[][][]) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const canvas = document.querySelector("canvas")!;
    const rect = canvas.getBoundingClientRect();
    const at = ([x, y]: number[]) => ({
      clientX: rect.left + (0.1 + (0.8 * x!) / 1024) * rect.width,
      clientY: rect.top + (0.1 + (0.8 * (900 - y!)) / 1024) * rect.height,
    });
    for (const median of medians) {
      const pts: number[][] = [];
      for (let i = 0; i < median.length - 1; i += 1)
        for (let k = 0; k < 5; k += 1)
          pts.push([
            median[i]![0]! + ((median[i + 1]![0]! - median[i]![0]!) * k) / 5,
            median[i]![1]! + ((median[i + 1]![1]! - median[i]![1]!) * k) / 5,
          ]);
      pts.push(median[median.length - 1]!);
      const fire = (type: string, p: number[]) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            ...at(p),
            pointerId: 1,
            pointerType: "pen",
            isPrimary: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            bubbles: true,
          }),
        );
      fire("pointerdown", pts[0]!);
      for (const p of pts.slice(1)) fire("pointermove", p);
      fire("pointerup", pts[pts.length - 1]!);
      await sleep(60);
    }
  }, medians);
}

function strokeMediansFor(hanzi: string): number[][][] {
  const file = path.resolve(process.cwd(), "node_modules/hanzi-writer-data", `${hanzi}.json`);
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { medians: number[][][] }).medians;
}
