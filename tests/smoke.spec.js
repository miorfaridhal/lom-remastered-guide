// Smoke tests for Mana Compass. Run: npm test
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(new URL("./fixtures/progress.json", import.meta.url));
const progress = JSON.parse(readFileSync(fixturePath, "utf8"));
const KEY = "lom-tracker-v1";

// Fail any test whose page throws.
test.beforeEach(async ({ page }, info) => {
  info.pageErrors = [];
  page.on("pageerror", e => info.pageErrors.push(e.message));
});
test.afterEach(async ({}, info) => {
  expect(info.pageErrors, "uncaught page errors").toEqual([]);
});

async function seed(page) {
  await page.addInitScript(([key, data]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data));
  }, [KEY, progress]);
}

test("fresh visit renders every quest with nothing ticked", async ({ page }) => {
  await page.goto("./");
  await expect(page).toHaveTitle("Mana Compass");
  await expect(page.locator("h1")).toHaveText("Mana Compass");
  await expect(page.locator("#s-q")).toHaveText("0/68");
  await expect(page.locator("#qlist li[data-q]")).toHaveCount(68);
  await expect(page.locator("#i-empty")).toBeAttached();
});

test("saved progress renders the expected counts", async ({ page }) => {
  await seed(page);
  await page.goto("./");
  await expect(page.locator("#s-q")).toHaveText("37/68");
  await expect(page.locator("#s-p")).toHaveText("21/26");
  await expect(page.locator("#qlist .grp [data-cnt]")).toHaveText([
    "7/7 done", "10/10 done", "6/6 done", "5/5 done", "6/6 done", "3/12 done",
    "0/4 done", "0/4 done", "0/4 done", "0/7 done", "0/1 done", "0/2 done",
  ]);
});

test("Forge > Blocks shows the measured 133 spear", async ({ page }) => {
  await seed(page);
  await page.goto("./#forge");
  await page.locator('#fnav button[data-fs="blocks"]').click();
  await expect(page.locator("#f-blocks")).toBeVisible();
  await expect(page.locator("#f-blocks-l")).toContainText("Measured: 133");
  await expect(page.locator("#f-blocks-l")).toContainText("161 shows +9");
});

test("export downloads the progress in the saved format", async ({ page }) => {
  await seed(page);
  await page.goto("./");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#bk-exp").click()]);
  expect(download.suggestedFilename()).toMatch(/^mana-compass-progress-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(readFileSync(await download.path(), "utf8"));
  expect(data.v).toBe(1);
  expect(new Set(data.q)).toEqual(new Set(progress.q));
  expect(new Set(data.p)).toEqual(new Set(progress.p));
  await expect(page.locator("#bk-msg")).toContainText("37 finished quests");
});

test("import restores progress on a fresh browser", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#s-q")).toHaveText("0/68");
  await page.locator("#bk-file").setInputFiles(fixturePath);
  await expect(page.locator("#s-q")).toHaveText("37/68");
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).q.length, KEY)).toBe(37);
});

test("import rejects a file that is not a backup", async ({ page }) => {
  await page.goto("./");
  await page.locator("#bk-file").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
  await expect(page.locator("#bk-msg")).toContainText("not a Mana Compass backup");
  await expect(page.locator("#s-q")).toHaveText("0/68");
});

test("manifest and icons are installable", async ({ page, request }) => {
  await page.goto("./");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const res = await request.get(href);
  expect(res.ok()).toBeTruthy();
  const m = await res.json();
  expect(m.short_name).toBe("Mana Compass");
  expect(m.display).toBe("standalone");
  const sizes = m.icons.map(i => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(m.icons.some(i => i.purpose === "maskable")).toBeTruthy();
  for (const i of m.icons) expect((await request.get(i.src)).ok(), i.src).toBeTruthy();
});

test("works offline after the first visit", async ({ page, context }) => {
  await page.goto("./");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.locator("h1")).toHaveText("Mana Compass");
  await expect(page.locator("#qlist li[data-q]")).toHaveCount(68);
  await context.setOffline(false);
});

test("a new deploy shows the update toast and reloads on request", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.locator("#upd")).toBeHidden();

  await page.request.get("/__bump-sw");
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await expect(page.locator("#upd")).toBeVisible();

  await Promise.all([page.waitForEvent("load"), page.locator("#upd-go").click()]);
  await expect(page.locator("#upd")).toBeHidden();
  await expect(page.locator("h1")).toHaveText("Mana Compass");
});
