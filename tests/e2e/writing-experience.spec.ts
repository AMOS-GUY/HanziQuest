/** M8: the handwriting canvas and writing flow on different inputs and screen sizes. */
import { expect, test, type Page } from "@playwright/test";
import { completeOnboarding, register, throwawayPassword, uniqueEmail } from "./helpers";

test.describe.configure({ timeout: 150_000 });

/** Opens free writing of 你 (character practice: guided first, which we skip). */
async function openFreeWriting(page: Page) {
  await register(page, "Writer", uniqueEmail("writer"), throwawayPassword());
  await completeOnboarding(page);
  await page.goto("/practice/character/你");
  // Skip goes straight to the next exercise.
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("img", { name: /Writing area/ })).toBeVisible();
}

/** Draws one straight stroke with synthetic pointer events of the given type. */
async function stroke(
  page: Page,
  pointerType: "pen" | "touch" | "mouse",
  options: { pointerId?: number; cancel?: boolean; from?: [number, number] } = {},
) {
  await page.evaluate(
    ({ pointerType, pointerId, cancel, from }) => {
      const canvas = document.querySelector("canvas")!;
      const r = canvas.getBoundingClientRect();
      const fire = (type: string, fx: number, fy: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            clientX: r.left + fx * r.width,
            clientY: r.top + fy * r.height,
            pointerId,
            pointerType,
            isPrimary: true,
            button: 0,
            buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
            bubbles: true,
            cancelable: true,
          }),
        );
      const [x, y] = from;
      fire("pointerdown", x, y);
      for (let i = 1; i <= 10; i += 1) fire("pointermove", x + i * 0.04, y);
      fire(cancel ? "pointercancel" : "pointerup", x + 0.4, y);
    },
    {
      pointerType,
      pointerId: options.pointerId ?? 7,
      cancel: options.cancel ?? false,
      from: options.from ?? [0.2, 0.5],
    },
  );
}

test("canvas: touch, stylus and mouse draw; palm rejection; cancelled gestures are dropped", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Input types are emulated directly");
  await openFreeWriting(page);
  const count = page.getByText(/^\d+ strokes?$|^Write with your/);
  await expect(count).toHaveText(/Write with your/);

  // The canvas never lets the browser pan or zoom, so drawing can't scroll the page.
  const touchAction = await page
    .locator("canvas")
    .evaluate((c) => [
      getComputedStyle(c).touchAction,
      getComputedStyle(c.parentElement!).touchAction,
    ]);
  expect(touchAction).toEqual(["none", "none"]);

  await stroke(page, "touch", { from: [0.2, 0.3] });
  await expect(count).toHaveText("1 stroke");
  await stroke(page, "mouse", { from: [0.2, 0.4] });
  await expect(count).toHaveText("2 strokes");

  // A gesture the system cancels is not saved as a partial stroke.
  await stroke(page, "touch", { cancel: true });
  await expect(count).toHaveText("2 strokes");

  // Once a stylus is used, touches (a resting palm) are ignored.
  await stroke(page, "pen", { from: [0.2, 0.6] });
  await expect(count).toHaveText("3 strokes");
  await stroke(page, "touch", { from: [0.2, 0.7] });
  await expect(count).toHaveText("3 strokes");

  // Undo removes the last stroke; Clear empties the canvas; both are disabled when empty.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(count).toHaveText("2 strokes");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(count).toHaveText(/Write with your/);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Clear" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Check" })).toBeDisabled();

  // Learners are told before using a hint that it makes the attempt guided.
  await expect(page.getByText(/A hint makes this guided practice/)).toBeVisible();
  await page.getByRole("button", { name: "Hint" }).click();
  await expect(page.getByText(/You used a hint/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Hint" })).toBeDisabled();
});

test("keyboard: after Check, focus moves to the result; Retry returns it to the prompt", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Keyboard flow");
  await openFreeWriting(page);
  await stroke(page, "pen");
  const check = page.getByRole("button", { name: "Check" });
  await check.focus();
  await page.keyboard.press("Enter");
  const result = page.getByRole("group", { name: "Result" });
  await expect(result).toBeVisible();
  await expect(result).toBeFocused();
  // Retry returns to writing with focus on the prompt.
  await page.getByRole("button", { name: "Retry" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("img", { name: /Writing area/ })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.textContent ?? ""))
    .toContain("Write from memory");
});

test("small landscape phone: the canvas and Check fit on screen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Phone viewport");
  await page.setViewportSize({ width: 740, height: 360 });
  await openFreeWriting(page);
  const canvas = await page.locator("canvas").boundingBox();
  expect(canvas!.height).toBeLessThanOrEqual(360);
  expect(canvas!.height).toBeGreaterThanOrEqual(250);
  await page.getByRole("img", { name: /Writing area/ }).scrollIntoViewIfNeeded();
  const viewportScroll = await page.evaluate(() => window.scrollY);
  await page.getByRole("button", { name: "Check" }).scrollIntoViewIfNeeded();
  const checkBox = await page.getByRole("button", { name: "Check" }).boundingBox();
  // From the canvas, Check is at most a short scroll away (less than one screen).
  expect((await page.evaluate(() => window.scrollY)) - viewportScroll).toBeLessThan(360);
  expect(checkBox!.y + checkBox!.height).toBeLessThanOrEqual(360);
});

test("narrow phone (320 px): no horizontal scrolling while writing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Phone viewport");
  await page.setViewportSize({ width: 320, height: 640 });
  await openFreeWriting(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  const canvas = await page.locator("canvas").boundingBox();
  expect(canvas!.width).toBeGreaterThanOrEqual(250);
});
