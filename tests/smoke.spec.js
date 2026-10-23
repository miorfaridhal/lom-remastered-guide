// Smoke tests for Mana Compass. Run: npm test
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(new URL("./fixtures/progress.json", import.meta.url));
const progress = JSON.parse(readFileSync(fixturePath, "utf8"));
const KEY = "lom-tracker-v1";

// Fail any test whose page throws. GoatCounter is replaced by a stand-in that records counts,
// so test runs never reach the real dashboard.
const GC_STUB = "window.goatcounter=Object.assign(window.goatcounter||{},{count:function(v){(window.__gc=window.__gc||[]).push(v)}});";
test.beforeEach(async ({ page }, info) => {
  info.pageErrors = [];
  page.on("pageerror", e => info.pageErrors.push(e.message));
  await page.route("https://gc.zgo.at/**", r => r.fulfill({ contentType: "text/javascript", body: GC_STUB }));
  await page.route("https://*.goatcounter.com/**", r => r.abort());
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
  await expect(page).toHaveTitle("Legend of Mana Remastered Walkthrough and Quest Guide | Mana Compass");
  await expect(page.locator("h1")).toHaveText("Legend of Mana Remastered Mana Compass");
  await expect(page.locator("#s-q")).toHaveText("0/68");
  await expect(page.locator("#qlist li[data-q]")).toHaveCount(68);
  await expect(page.locator("#i-empty")).toBeAttached();
});

test("sources live on one About page, other tabs only link to it", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#p-quests")).toBeVisible();
  await expect(page.locator(".srclist")).toBeHidden();
  await expect(page.locator(".foot a")).toHaveText("Sources, credits and privacy");
  await page.locator(".foot a").click();
  await expect(page.locator("#p-about")).toBeVisible();
  expect(await page.locator(".srclist li").count()).toBeGreaterThan(20);
  await expect(page.locator("#priv-text")).toContainText("only in this browser");
  await expect(page.locator("#priv-count")).toContainText("GoatCounter");
  await expect(page.locator("#usage")).toBeHidden();
});

test("GoatCounter gets the page load and each tab, with no cookies", async ({ page, context }) => {
  const loads = [];
  page.on("request", r => { if (r.url().startsWith("https://gc.zgo.at/")) loads.push(r.url()); });
  await page.goto("./");
  await expect.poll(() => page.evaluate(() => (window.__gc || []).length)).toBe(1);
  expect(loads).toEqual(["https://gc.zgo.at/count.v4.js"]);
  expect(await page.locator('script[data-goatcounter]').getAttribute("data-goatcounter")).toBe("https://manacompass.goatcounter.com/count");

  await page.evaluate(() => { location.hash = "forge"; });
  await expect.poll(() => page.evaluate(() => (window.__gc || []).length)).toBe(2);
  const counts = await page.evaluate(() => window.__gc);
  expect(counts.map(c => c.path)).toEqual(["/lom-remastered-guide/quests", "/lom-remastered-guide/forge"]);
  expect(counts.every(c => c.event === false)).toBe(true);
  expect(await context.cookies()).toEqual([]);
});

test("every foldable card and group really hides its content when tapped", async ({ page }) => {
  test.setTimeout(90000);
  await seed(page);
  await page.goto("./");
  const tabs = ["quests", "places", "npcs", "hidden", "skills", "weapons", "plan", "money", "drops", "pets", "eggs", "about", "forge"];
  const fsubs = ["start", "calc", "mats", "gear", "golem", "blocks", "ult", "items", "cards", "recipes"];
  const broken = [];
  let checked = 0;
  // For each visible header: click it, then check that the content next to it changed visibility.
  // One pass per tab inside the page keeps this fast.
  async function sweep(where) {
    const r = await page.evaluate(() => {
      const shown = el => getComputedStyle(el).display !== "none";
      const out = { checked: 0, broken: [] };
      for (const h of document.querySelectorAll(".panel:not([hidden]) .grp>header, .panel:not([hidden]) .fac>header")) {
        if (!h.offsetParent) continue;
        const body = [...h.parentNode.children].find(c => c !== h);
        if (!body) continue;
        const before = shown(body);
        h.click();
        out.checked++;
        if (shown(body) === before) out.broken.push(h.textContent.trim().slice(0, 40));
      }
      return out;
    });
    checked += r.checked;
    broken.push(...r.broken.map(t => `${where}: "${t}"`));
  }
  for (const t of tabs) {
    await page.evaluate(t => { location.hash = t; }, t);
    if (t === "forge") {
      for (const s of fsubs) { await page.locator(`#fnav button[data-fs="${s}"]`).click(); await sweep("forge/" + s); }
    } else await sweep(t);
  }
  expect(checked).toBeGreaterThan(100);
  expect(broken, "cards whose content did not hide or show").toEqual([]);
});

test("a folded facility card stays folded after a reload", async ({ page }) => {
  await page.goto("./#places");
  const card = page.locator('#fac .fac[data-fac="0"]');
  await expect(card.locator("ol").first()).toBeVisible();
  await card.locator("header").click();
  await expect(card.locator("ol").first()).toBeHidden();
  await page.reload();
  await expect(page.locator('#fac .fac[data-fac="0"] ol').first()).toBeHidden();
  await expect(page.locator('#fac .fac[data-fac="0"] > header')).toHaveAttribute("aria-expanded", "false");
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

test("import over existing progress asks first, in the page", async ({ page }) => {
  await seed(page);
  await page.goto("./");
  const other = { ...progress, q: progress.q.slice(0, 5) };
  const file = { name: "other.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(other)) };

  await page.locator("#bk-file").setInputFiles(file);
  await expect(page.locator("#bk-ask")).toBeVisible();
  await expect(page.locator("#bk-ask-t")).toContainText("37 finished quests");
  await page.locator("#bk-no").click();
  await expect(page.locator("#bk-ask")).toBeHidden();
  await expect(page.locator("#s-q")).toHaveText("37/68");

  await page.locator("#bk-file").setInputFiles(file);
  await page.locator("#bk-yes").click();
  await expect(page.locator("#s-q")).toHaveText("5/68");
  await expect(page.locator("#bk-msg")).toContainText("Imported 5 finished quests");
});

test("import rejects a file that is not a backup", async ({ page }) => {
  await page.goto("./");
  await page.locator("#bk-file").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
  await expect(page.locator("#bk-msg")).toContainText("not a Mana Compass backup");
  await expect(page.locator("#s-q")).toHaveText("0/68");
});

test("search engines get a description, canonical address, structured data and a sitemap", async ({ page, request }) => {
  await page.goto("./");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /walkthrough and quest guide/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://miorfaridhal.github.io/lom-remastered-guide/");
  const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
  expect(ld["@graph"].map(n => n["@type"])).toEqual(["WebSite", "WebApplication"]);
  expect(ld["@graph"][1].about.name).toBe("Legend of Mana Remastered");
  const map = await request.get("sitemap.xml");
  expect(map.ok()).toBeTruthy();
  expect(await map.text()).toContain("<loc>https://miorfaridhal.github.io/lom-remastered-guide/</loc>");
});

test("manifest and icons are installable", async ({ page, request }) => {
  await page.goto("./");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const res = await request.get(href);
  expect(res.ok()).toBeTruthy();
  const m = await res.json();
  expect(m.short_name).toBe("Mana Compass");
  expect(m.name).toContain("Legend of Mana");
  expect(m.display).toBe("standalone");
  // Android paints its bottom system bar (and the splash screen) in background_color, and the manifest
  // allows one colour only, so it is the header teal, which suits both the light and dark skins.
  expect(m.background_color).toBe("#1D5F66");
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
  await expect(page.locator("h1")).toHaveText("Legend of Mana Remastered Mana Compass");
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
  await expect(page.locator("h1")).toHaveText("Legend of Mana Remastered Mana Compass");
});

test("Forge > Ultimate shows the max-power weapon recipe, and its pickers redo the estimate", async ({ page }) => {
  await seed(page);
  await page.goto("./#forge");
  await page.locator('#fnav button[data-fs="ult"]').click();
  const root = page.locator("#f-ult-l");
  await expect(root).toContainText("Ultimate weapon: pick weapon and material");
  await expect(root).toContainText("Ultimate weapon: max-power recipe");
  await expect(root).toContainText("2H Sword in Beiser Gold");
  await expect(root).toContainText("Measured on Laurent Silver Spear: 28, 39, 58, 133.");
  await page.locator("#uw-type").selectOption("Spear");
  await expect(root).toContainText("Spear in Lorimar Iron"); // a new weapon picks its best material you can get
  await page.locator("#uw-mat").selectOption("Laurent Silver");
  await expect(root).toContainText("Spear in Laurent Silver: plain 28, est. about 133 after the full list."); // the measured spear itself
  await page.reload();
  await page.locator('#fnav button[data-fs="ult"]').click();
  await expect(page.locator("#uw-type")).toHaveValue("Spear");
});

test("materials use the Remastered names, and an old PS1 name still finds them", async ({ page }) => {
  await page.goto("./#forge");
  await page.locator('#fnav button[data-fs="mats"]').click();
  await page.locator("#msearch").fill("Vizel Gold");
  const shown = page.locator("#f-mats .row:not([hidden])");
  await expect(shown.first()).toContainText("Beiser Gold");
  expect(await shown.count()).toBeGreaterThan(0);
  await page.locator("#msearch").fill("Lorant");
  await expect(shown.first()).toContainText("Laurent Silver");
  await page.evaluate(() => { location.hash = "about"; });
  await expect(page.locator("#names-note")).toContainText("Beiser Gold (was Vizel Gold)");
});

test("quest #42 gives the route to the hidden Duma Desert oasis", async ({ page }) => {
  await page.goto("./");
  await page.locator("#qsearch").fill("Blessed Elixir");
  const row = page.locator('#qlist li[data-q="42"]');
  await row.locator(".rh").click();
  await expect(row).toContainText("sand waterfall");
  await expect(row).toContainText("hidden behind the rocks in the top-left corner");
});

test("Forge > Ultimate lists the best build for every weapon, and Use loads the Hammer", async ({ page }) => {
  await seed(page);
  await page.goto("./#forge");
  await page.locator('#fnav button[data-fs="ult"]').click();
  const best = page.locator("#uw-best");
  await expect(best.locator("tbody tr")).toHaveCount(11);
  const hammer = best.locator("tr", { has: page.locator('[data-uw="Hammer"]') });
  await expect(hammer).toContainText("8 72 64 16");
  await expect(hammer).toContainText("Lorimar Iron");
  await expect(hammer).toContainText("Giant's Horn");
  await hammer.locator("[data-uw]").click();
  await expect(page.locator("#uw-type")).toHaveValue("Hammer");
  await expect(page.locator("#f-ult-l")).toContainText("Hammer in Lorimar Iron: plain 56");
  await expect(page.locator("#f-ult-l")).toContainText("Giant's Horn (last)");
});
