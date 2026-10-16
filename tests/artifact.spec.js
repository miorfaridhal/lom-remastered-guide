// Tests the claude.ai artifact build (build/artifact.html, made by tools/build-artifact.mjs)
// against a stand-in window.claude: account sync through db + user, export through downloads.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const progress = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/progress.json", import.meta.url)), "utf8"));

// A minimal window.claude with the same call shapes the page uses.
async function fakeClaude(page, { stored }) {
  await page.addInitScript(stored => {
    const writes = [], saves = [];
    let listener = null;
    const doc = path => ({
      onSnapshot(fn) {
        listener = fn;
        setTimeout(() => fn({ exists: !!stored, data: () => stored }), 0);
        return () => { listener = null; };
      },
      set(data) { writes.push({ path, data }); stored = data; return Promise.resolve(); },
    });
    const api = {
      db: { doc },
      user: { id: () => Promise.resolve("viewer-1") },
      downloads: { save: req => { saves.push(req); return Promise.resolve({ status: "saved" }); } },
    };
    window.__fake = { writes, saves };
    window.claude = { use: name => new Promise(r => setTimeout(() => r(api[name] || null), 10)) };
  }, stored);
}

test.beforeEach(async ({ page }, info) => {
  info.pageErrors = [];
  page.on("pageerror", e => info.pageErrors.push(e.message));
});
test.afterEach(async ({}, info) => {
  expect(info.pageErrors, "uncaught page errors").toEqual([]);
});

test("artifact build loads account progress and saves ticks back to it", async ({ page }) => {
  await fakeClaude(page, { stored: progress });
  await page.goto("build/artifact.html");
  await expect(page).toHaveTitle("Legend of Mana Compass");
  await expect(page.locator("#save")).toHaveText("Saved to your account");
  await expect(page.locator("#s-q")).toHaveText("37/68");
  await expect(page.locator("#bk-where")).toContainText("saved to your Claude account");
  expect(await page.evaluate(() => "serviceWorker" in navigator && navigator.serviceWorker.controller)).toBeFalsy();
  await expect(page.locator("#upd")).toHaveCount(0);

  const open = [...Array(68).keys()].map(i => String(i + 1)).find(id => !progress.q.includes(id));
  const box = page.locator(`#qlist input[data-k="q:${open}"]`);
  await box.evaluate(el => { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await expect(page.locator("#s-q")).toHaveText("38/68");
  await expect.poll(() => page.evaluate(() => window.__fake.writes.length)).toBeGreaterThan(0);
  const last = await page.evaluate(() => window.__fake.writes.at(-1));
  expect(last.path).toBe("data/users/viewer-1/progress");
  expect(last.data.q).toContain(open);
});

test("artifact build exports through the downloads capability", async ({ page }) => {
  await fakeClaude(page, { stored: progress });
  await page.goto("build/artifact.html");
  await expect(page.locator("#s-q")).toHaveText("37/68");
  await page.locator("#bk-exp").click();
  await expect(page.locator("#bk-msg")).toContainText("Exported 37 finished quests");
  const save = await page.evaluate(() => window.__fake.saves[0]);
  expect(save.filename).toMatch(/^mana-compass-progress-\d{4}-\d{2}-\d{2}\.json$/);
  expect(JSON.parse(save.data).q.length).toBe(37);
});

test("artifact build with an empty account uploads the browser's progress", async ({ page }) => {
  await fakeClaude(page, { stored: null });
  await page.addInitScript(p => { if (!localStorage.getItem("lom-tracker-v1")) localStorage.setItem("lom-tracker-v1", JSON.stringify(p)); }, progress);
  await page.goto("build/artifact.html");
  await expect.poll(() => page.evaluate(() => window.__fake.writes.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__fake.writes[0].data.q.length)).toBe(37);
});
