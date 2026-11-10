import { expect, test, type Page } from "@playwright/test";
import {
  completeOnboarding,
  register,
  throwawayPassword,
  uniqueEmail,
  writeCurrentExercise,
} from "./helpers";

test.describe.configure({ timeout: 180_000 });

/** Reads what this browser has stored offline. */
function localData(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        packages: { userId: string }[];
        outbox: { userId: string; status: string }[];
        active: string | null;
      }>((resolve, reject) => {
        const open = indexedDB.open("hanziquest");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["packages", "outbox", "meta"], "readonly");
          const all = (name: string) =>
            new Promise<unknown[]>((r) => {
              const q = tx.objectStore(name).getAll();
              q.onsuccess = () => r(q.result as unknown[]);
            });
          void Promise.all([all("packages"), all("outbox"), all("meta")]).then(
            ([packages, outbox, meta]) => {
              const active =
                (meta as { key: string; value: string }[]).find((m) => m.key === "lastUserId")
                  ?.value ?? null;
              resolve({
                packages: packages as { userId: string }[],
                outbox: outbox as { userId: string; status: string }[],
                active,
              });
              db.close();
            },
          );
        };
      }),
  );
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });
}

async function logout(page: Page) {
  await page.goto("/profile");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
}

async function totalXp(page: Page) {
  await page.goto("/progress");
  const value = page.getByText("Total XP").locator("xpath=preceding-sibling::p[1]");
  return Number(await value.textContent());
}

test("offline data is isolated per account across sign-out and account switching", async ({
  page,
  context,
}, testInfo) => {
  test.skip(!!testInfo.project.use.isMobile, "Runs on desktop projects");
  // The scenario blocks /api/sync with context.route(); only Chromium routes requests from
  // service-worker-controlled pages. In WebKit the sync gets through (verified: the result
  // synced to its owner, nothing was lost), so the "unsynced at sign-out" state can't be set up.
  test.skip(
    testInfo.project.use.defaultBrowserType !== "chromium",
    "Needs Chromium request routing for service-worker pages",
  );
  const a = { email: uniqueEmail("acct-a"), password: throwawayPassword() };
  const b = { email: uniqueEmail("acct-b"), password: throwawayPassword() };

  // Account A downloads a lesson and practises offline.
  await register(page, "Learner A", a.email, a.password);
  await completeOnboarding(page);
  await page.getByRole("link", { name: "Start" }).click();
  await page.getByRole("button", { name: "Download for offline" }).click();
  await expect(page.getByText("Available offline")).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.goto("/offline");
  await page.getByRole("link", { name: "Practise" }).click();
  await writeCurrentExercise(page);
  await expect(page.getByText("Saved on this device. It will sync")).toBeVisible({
    timeout: 15_000,
  });

  // Back online, but the sync endpoint is unreachable (an interrupted sync).
  await context.route("**/api/sync", (route) => route.abort("connectionfailed"));
  await context.setOffline(false);
  const before = await localData(page);
  const aId = before.active!;
  expect(before.packages.every((p) => p.userId === aId)).toBe(true);
  expect(before.outbox.filter((e) => e.userId === aId)).toHaveLength(1);

  // Signing out deletes A's downloads and the active-account marker; the unsynced result stays
  // with its owner.
  await logout(page);
  const afterSignOut = await localData(page);
  expect(afterSignOut.packages).toHaveLength(0);
  expect(afterSignOut.active).toBeNull();
  expect(afterSignOut.outbox.filter((e) => e.userId === aId)).toHaveLength(1);

  // The offline page shows nothing to a signed-out visitor.
  await page.goto("/offline");
  await expect(page.getByText("Not signed in")).toBeVisible();

  // Account B on the same device: never sees or uploads A's queued result.
  await context.unroute("**/api/sync");
  await register(page, "Learner B", b.email, b.password);
  await completeOnboarding(page);
  await page.waitForTimeout(2_000);
  const asB = await localData(page);
  expect(asB.active).not.toBe(aId);
  expect(asB.outbox.filter((e) => e.userId === aId)).toHaveLength(1);
  expect(await totalXp(page)).toBe(0);
  await page.goto("/offline");
  await expect(page.getByText("No lessons downloaded")).toBeVisible();
  await logout(page);

  // A signs back in: the queued result syncs to A, exactly once.
  await login(page, a.email, a.password);
  await expect
    .poll(async () => (await localData(page)).outbox.filter((e) => e.userId === aId).length, {
      timeout: 20_000,
    })
    .toBe(0);
  const xp = await totalXp(page);
  expect(xp).toBeGreaterThan(0);
  await page.reload();
  expect(await totalXp(page)).toBe(xp);
});
