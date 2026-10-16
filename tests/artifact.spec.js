// Tests the claude.ai artifact build (build/artifact.html, made by tools/build-artifact.mjs)
// against a stand-in window.claude: account sync and visit counts through db + user,
// export through downloads.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const progress = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/progress.json", import.meta.url)), "utf8"));
const PROGRESS = "data/users/viewer-1/progress";

// A minimal window.claude with the same call shapes the page uses. `docs` seeds the store by path.
async function fakeClaude(page, { docs = {}, owner = true } = {}) {
  await page.addInitScript(([seed, owner]) => {
    const store = { ...seed }, writes = [], saves = [];
    const snap = (path) => ({ id: path.split("/").pop(), exists: path in store, data: () => store[path] });
    const doc = path => ({
      get: () => Promise.resolve(snap(path)),
      onSnapshot(fn) { setTimeout(() => fn(snap(path)), 0); return () => {}; },
      set(data) { writes.push({ path, data }); store[path] = data; return Promise.resolve(); },
    });
    const collection = path => ({
      get: () => {
        const docs = Object.keys(store).filter(p => p.startsWith(path + "/") && p.split("/").length === path.split("/").length + 1).map(snap);
        return Promise.resolve({ docs, size: docs.length, empty: !docs.length });
      },
    });
    const api = {
      db: { doc, collection },
      user: { id: () => Promise.resolve("viewer-1"), isOwner: () => Promise.resolve(owner) },
      downloads: { save: req => { saves.push(req); return Promise.resolve({ status: "saved" }); } },
    };
    window.__fake = { writes, saves, store };
    window.claude = { use: name => new Promise(r => setTimeout(() => r(api[name] || null), 10)) };
  }, [docs, owner]);
}
const writesTo = (page, path) => page.evaluate(p => window.__fake.writes.filter(w => w.path === p), path);

test.beforeEach(async ({ page }, info) => {
  info.pageErrors = [];
  info.gcRequests = [];
  page.on("pageerror", e => info.pageErrors.push(e.message));
  page.on("request", r => { if (/goatcounter|gc\.zgo\.at/.test(r.url())) info.gcRequests.push(r.url()); });
  await page.route(/goatcounter|gc\.zgo\.at/, r => r.abort());
});
test.afterEach(async ({}, info) => {
  expect(info.gcRequests, "the artifact build never calls GoatCounter").toEqual([]);
});
test.afterEach(async ({}, info) => {
  expect(info.pageErrors, "uncaught page errors").toEqual([]);
});

test("artifact build loads account progress and saves ticks back to it", async ({ page }) => {
  await fakeClaude(page, { docs: { [PROGRESS]: progress } });
  await page.goto("build/artifact.html");
  await expect(page).toHaveTitle("Legend of Mana Compass");
  await expect(page.locator("#save")).toHaveText("Saved to your account");
  await expect(page.locator("#s-q")).toHaveText("37/68");
  await expect(page.locator("#bk-where")).toContainText("saved to your Claude account");
  expect(await page.evaluate(() => "serviceWorker" in navigator && navigator.serviceWorker.controller)).toBeFalsy();
  await expect(page.locator("#upd")).toHaveCount(0);

  const open = [...Array(68).keys()].map(i => String(i + 1)).find(id => !progress.q.includes(id));
  await page.locator(`#qlist input[data-k="q:${open}"]`).evaluate(el => { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await expect(page.locator("#s-q")).toHaveText("38/68");
  await expect.poll(async () => (await writesTo(page, PROGRESS)).length).toBeGreaterThan(0);
  const last = (await writesTo(page, PROGRESS)).at(-1);
  expect(last.data.q).toContain(open);
});

test("artifact build exports through the downloads capability", async ({ page }) => {
  await fakeClaude(page, { docs: { [PROGRESS]: progress } });
  await page.goto("build/artifact.html");
  await expect(page.locator("#s-q")).toHaveText("37/68");
  await page.locator("#bk-exp").click();
  await expect(page.locator("#bk-msg")).toContainText("Exported 37 finished quests");
  const save = await page.evaluate(() => window.__fake.saves[0]);
  expect(save.filename).toMatch(/^mana-compass-progress-\d{4}-\d{2}-\d{2}\.json$/);
  expect(JSON.parse(save.data).q.length).toBe(37);
});

test("artifact build with an empty account uploads the browser's progress", async ({ page }) => {
  await fakeClaude(page);
  await page.addInitScript(p => { if (!localStorage.getItem("lom-tracker-v1")) localStorage.setItem("lom-tracker-v1", JSON.stringify(p)); }, progress);
  await page.goto("build/artifact.html");
  await expect.poll(async () => (await writesTo(page, PROGRESS)).length).toBeGreaterThan(0);
  expect((await writesTo(page, PROGRESS))[0].data.q.length).toBe(37);
});

test("artifact build counts the visit and shows the owner a usage card", async ({ page }) => {
  const day = new Date().toISOString().slice(0, 10);
  await fakeClaude(page, { docs: {
    [PROGRESS]: progress,
    "visits/someone-else": { first: "2026-10-01T00:00:00Z", last: new Date().toISOString(), visits: 4, days: { [day]: 2 }, tabs: { quests: 3, forge: 5 } },
  } });
  await page.goto("build/artifact.html#forge");
  await expect.poll(async () => (await writesTo(page, "visits/viewer-1")).length).toBeGreaterThan(0);
  const v = (await writesTo(page, "visits/viewer-1"))[0].data;
  expect(v.visits).toBe(1);
  expect(v.days[day]).toBe(1);
  expect(v.tabs.forge).toBe(1);
  expect(JSON.stringify(v)).not.toMatch(/name|email/i);

  await page.goto("build/artifact.html#about");
  await expect(page.locator("#usage")).toBeVisible();
  await expect(page.locator("#usage .usage-stats")).toContainText("2people");
  await expect(page.locator("#priv-count")).toContainText("anonymous id");
});

test("artifact build hides the usage card from viewers who are not the owner", async ({ page }) => {
  await fakeClaude(page, { docs: { [PROGRESS]: progress }, owner: false });
  await page.goto("build/artifact.html#about");
  await expect.poll(async () => (await writesTo(page, "visits/viewer-1")).length).toBeGreaterThan(0);
  await expect(page.locator("#usage")).toBeHidden();
});
