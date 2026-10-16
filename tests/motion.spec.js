// Motion and play: count-up status cards, tappable cards, the Mana tree tip, celebrations.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const progress = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/progress.json", import.meta.url)), "utf8"));
const GC_STUB = "window.goatcounter=Object.assign(window.goatcounter||{},{count:function(){}});";

test.beforeEach(async ({ page }, info) => {
  info.pageErrors = [];
  page.on("pageerror", e => info.pageErrors.push(e.message));
  await page.route("https://gc.zgo.at/**", r => r.fulfill({ contentType: "text/javascript", body: GC_STUB }));
  await page.route("https://*.goatcounter.com/**", r => r.abort());
  await page.addInitScript(p => { if (!localStorage.getItem("lom-tracker-v1")) localStorage.setItem("lom-tracker-v1", JSON.stringify(p)); }, progress);
});
test.afterEach(async ({}, info) => { expect(info.pageErrors, "uncaught page errors").toEqual([]); });

test("status cards count up when a tab opens and land on the real values", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#s-q")).toHaveText("37/68");
  // Sample the quest counter every frame while the next tab opens.
  const seen = await page.evaluate(() => new Promise(done => {
    const vals = [], el = document.querySelector("#s-q");
    location.hash = "pets";
    const t0 = performance.now();
    (function tick() { vals.push(el.textContent); performance.now() - t0 < 1100 ? requestAnimationFrame(tick) : done(vals); })();
  }));
  const nums = seen.map(v => +v.split("/")[0]);
  // The count restarts at 0 when the tab opens, then only rises until it lands on 37.
  const start = nums.indexOf(Math.min(...nums));
  expect(nums[start]).toBeLessThan(10);
  expect(nums.at(-1)).toBe(37);
  for (let i = start + 1; i < nums.length; i++) expect(nums[i]).toBeGreaterThanOrEqual(nums[i - 1]);
});

test("reduce motion skips the count-up", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  const seen = await page.evaluate(() => new Promise(done => {
    const vals = [], el = document.querySelector("#s-q");
    location.hash = "pets";
    const t0 = performance.now();
    (function tick() { vals.push(el.textContent); performance.now() - t0 < 400 ? requestAnimationFrame(tick) : done(vals); })();
  }));
  expect(new Set(seen)).toEqual(new Set(["37/68"]));
});

test("tapping a status card opens its tab", async ({ page }) => {
  await page.goto("./");
  await page.locator('a.st[href="#places"]').click();
  await expect(page.locator("#p-places")).toBeVisible();
  await page.locator('a.st[href="#skills"]').click();
  await expect(page.locator("#p-skills")).toBeVisible();
});

test("the Mana tree gives a tip, and Show me jumps to the quest", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#tip")).toBeHidden();
  // Click the middle of the tree canopy wherever the scene places it.
  // The header crops the tree on wide screens, so aim at the part of the canopy that is visible.
  const pt = await page.evaluate(() => {
    const c = document.querySelector("#scene .canopy").getBoundingClientRect(), h = document.querySelector(".hero").getBoundingClientRect();
    const top = Math.max(c.top, h.top), bottom = Math.min(c.bottom, h.bottom);
    return { x: c.left + c.width / 2, y: (top + bottom) / 2 };
  });
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator("#tip")).toBeVisible();
  await expect(page.locator("#tip-t")).not.toHaveText("");
  // Keep tapping until a tip names a quest, then follow it.
  for (let i = 0; i < 30 && await page.locator("#tip-go").isHidden(); i++) await page.locator("#tipbtn").evaluate(b => b.click());
  const id = (await page.locator("#tip-t").textContent()).match(/#(\d+)/)[1];
  await page.locator("#tip-go").click();
  await expect(page.locator("#p-quests")).toBeVisible();
  await expect(page.locator(`#qlist li[data-q="${id}"]`)).toHaveClass(/open/);
  await expect(page.locator("#tip")).toBeHidden();
});

test("finishing the last quest of a phase celebrates", async ({ page }) => {
  await page.goto("./");
  // Phase 6 is 3/12 in the sample save: tick everything except one, then the last one.
  const phase = await page.evaluate(() => [...document.querySelectorAll("#qlist .grp")][5].getAttribute("data-ids").split(","));
  const open = phase.filter(id => !progress.q.includes(id));
  const tick = id => page.locator(`#qlist input[data-k="q:${id}"]`).evaluate(el => { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); });
  for (const id of open.slice(0, -1)) await tick(id);
  await expect(page.locator("#cele")).toBeHidden();
  await tick(open.at(-1));
  await expect(page.locator("#cele")).toBeVisible();
  await expect(page.locator("#cele-t")).toHaveText("Phase complete");
});

test("finished groups wear a medal, untouched ones a dashed pill", async ({ page }) => {
  await page.goto("./");
  const pills = page.locator("#qlist .grp [data-cnt]");
  await expect(pills.nth(0)).toHaveText("7/7 done");
  await expect(pills.nth(0)).toHaveClass(/full/);
  await expect(pills.nth(0).locator("svg use")).toHaveAttribute("href", "#i-medal");
  await expect(page.locator("#qlist .grp").nth(0)).toHaveClass(/complete/);
  await expect(pills.nth(5)).toHaveText("3/12 done");
  await expect(pills.nth(5)).not.toHaveClass(/full|none/);
  await expect(pills.nth(6)).toHaveText("0/4 done");
  await expect(pills.nth(6)).toHaveClass(/none/);
  await expect(page.locator("#qlist .grp").nth(6)).not.toHaveClass(/complete/);
});

// A stand-in AudioContext that counts tones instead of playing them.
async function fakeAudio(page) {
  await page.addInitScript(() => {
    window.__tones = 0;
    const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    class FakeCtx {
      constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
      resume() {}
      createOscillator() { window.__tones++; return { type: "", frequency: param, connect() {}, start() {}, stop() {} }; }
      createGain() { return { gain: param, connect() {} }; }
    }
    window.AudioContext = FakeCtx;
  });
}

test("ticking plays a small sound, and the speaker button mutes it for good", async ({ page }) => {
  await fakeAudio(page);
  await page.goto("./");
  const tick = id => page.locator(`#qlist input[data-k="q:${id}"]`).evaluate(el => { el.checked = !el.checked; el.dispatchEvent(new Event("change", { bubbles: true })); });
  const open = [...Array(68).keys()].map(i => String(i + 1)).find(id => !progress.q.includes(id));
  const tones = () => page.evaluate(() => window.__tones);

  await expect(page.locator("#snd")).toHaveAttribute("aria-pressed", "true");
  await tick(open);
  expect(await tones()).toBeGreaterThan(0);

  await page.locator("#snd").click();
  await expect(page.locator("#snd")).toHaveAttribute("aria-pressed", "false");
  const before = await tones();
  await tick(open);
  expect(await tones()).toBe(before);

  await page.reload();
  await expect(page.locator("#snd")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#snd use")).toHaveAttribute("href", "#i-mute");
  await page.locator("#snd").click();
  await expect(page.locator("#snd")).toHaveAttribute("aria-pressed", "true");
});
