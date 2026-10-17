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
    // Stop once it has restarted low and landed again, or after 5 s on a slow machine.
    (function tick() {
      vals.push(el.textContent);
      const low = vals.some(v => parseInt(v) < 10), landed = el.textContent === "37/68";
      (low && landed) || performance.now() - t0 > 5000 ? done(vals) : requestAnimationFrame(tick);
    })();
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

test("finishing the last quest of a phase celebrates with a fanfare, and a tap closes it", async ({ page }) => {
  await fakeAudio(page);
  await page.goto("./");
  // Phase 6 is 3/12 in the sample save: tick everything except one, then the last one.
  const phase = await page.evaluate(() => [...document.querySelectorAll("#qlist .grp")][5].getAttribute("data-ids").split(","));
  const open = phase.filter(id => !progress.q.includes(id));
  const tick = id => page.locator(`#qlist input[data-k="q:${id}"]`).evaluate(el => { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); });
  for (const id of open.slice(0, -1)) await tick(id);
  await expect(page.locator("#cele")).toBeHidden();
  const before = await page.evaluate(() => window.__tones);
  await tick(open.at(-1));
  await expect(page.locator("#cele")).toBeVisible();
  await expect(page.locator("#cele-t")).toHaveText("Phase complete");
  await expect(page.locator("#cele-k")).toHaveText("Hooray!");
  await expect(page.locator("#cele-n")).toHaveText(/^Phase 6 of 12 · \d+\/68 events$/);
  expect(await page.evaluate(() => window.__tones) - before).toBeGreaterThan(30); // trumpets, drum, sparkles, bells
  await page.mouse.click(12, 200); // tap the dimmed backdrop, away from the card
  await expect(page.locator("#cele")).toBeHidden();
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

// Li'l Cactus: where he stands is the translate in his inline transform.
const cactusAt = page => page.locator("#cactus").evaluate(el => { const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(el.style.transform); return { x: +m[1], y: +m[2] }; });

test("Li’l Cactus chases the mouse", async ({ page, isMobile }) => {
  test.skip(isMobile, "mouse only");
  await page.goto("./");
  await expect(page.locator("#cactus")).toBeVisible();
  const start = await cactusAt(page);
  await page.mouse.move(200, 300);
  await expect.poll(async () => { const p = await cactusAt(page); return Math.hypot(p.x - 218, p.y - 314); }, { timeout: 10000 }).toBeLessThan(3);
  expect((await cactusAt(page)).x).toBeLessThan(start.x);
  await expect(page.locator("#cactus")).toHaveClass(/left/);
});

test("Li’l Cactus hops beside a tap on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch only");
  await page.goto("./");
  await page.touchscreen.tap(100, 400);
  await expect.poll(async () => { const p = await cactusAt(page); return Math.hypot(p.x - 136, p.y - 330); }, { timeout: 10000 }).toBeLessThan(3);
});

test("tapping Li’l Cactus gives a tip, and his button hides him for good", async ({ page }) => {
  await page.goto("./");
  await page.locator("#cactus").click();
  await expect(page.locator("#tip")).toBeVisible();
  await expect(page.locator("#tip-t")).not.toHaveText("");

  await page.locator("#cac-toggle").click();
  await expect(page.locator("#cactus")).toBeHidden();
  await expect(page.locator("#cac-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(page.locator("#cactus")).toBeHidden();
  await page.locator("#cac-toggle").click();
  await expect(page.locator("#cactus")).toBeVisible();
});

test("Li’l Cactus stays put under reduce motion", async ({ page, isMobile }) => {
  test.skip(isMobile, "mouse only");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  const start = await cactusAt(page);
  await page.mouse.move(200, 300);
  await page.waitForTimeout(600);
  expect(await cactusAt(page)).toEqual(start);
});

test("Li’l Cactus waits when the mouse reaches him, so he can be clicked", async ({ page, isMobile }) => {
  test.skip(isMobile, "mouse only");
  await page.goto("./");
  await page.mouse.move(300, 300);
  await expect.poll(async () => { const p = await cactusAt(page); return Math.hypot(p.x - 318, p.y - 314); }, { timeout: 10000 }).toBeLessThan(3);
  await page.mouse.move(340, 340); // onto him
  const here = await cactusAt(page);
  await page.waitForTimeout(500);
  expect(await cactusAt(page)).toEqual(here);
});

test("tapping anywhere in the page body shows the touch sparkle, not only in the banner", async ({ page }) => {
  await page.goto("./");
  const h = await page.locator(".hero").boundingBox();
  // The effect only lasts half a second, so count what gets added rather than racing it.
  await page.evaluate(() => {
    window.__fx = { ring: 0, spark: 0 };
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      if (n.classList?.contains("tapring")) window.__fx.ring++;
      if (n.classList?.contains("fx")) window.__fx.spark++;
    }))).observe(document.body, { childList: true });
  });
  await page.mouse.click(200, h.y + h.height + 300);
  await expect.poll(() => page.evaluate(() => window.__fx)).toEqual({ ring: 1, spark: 5 });
  await expect(page.locator(".tapring")).toHaveCount(0, { timeout: 3000 });
});

test("sideways menus show a more-this-way arrow and note until they are scrolled", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the Forge menu fits on a wide screen");
  await page.goto("./#forge");
  const wrap = page.locator(".sh", { has: page.locator("#fnav") });
  await expect(wrap).toHaveClass(/\br\b/);
  await expect(wrap.locator(".sh-r")).toBeVisible();
  await expect(wrap.locator(".sh-note")).toBeVisible();
  await expect(wrap.locator(".sh-l")).toBeHidden();
  await page.waitForTimeout(2000); // let the one-time peek finish
  await wrap.locator(".sh-r").click();
  await expect.poll(() => page.locator("#fnav").evaluate(e => e.scrollLeft)).toBeGreaterThan(50);
  await expect(wrap.locator(".sh-note")).toBeHidden();
  await expect(wrap.locator(".sh-l")).toBeVisible();
});

test("Li’l Cactus naps after a quiet spell, wakes on the next touch, and smiles with a tip", async ({ page, isMobile }) => {
  test.skip(isMobile, "mouse only");
  await page.clock.install();
  await page.goto("./");
  const cac = page.locator("#cactus");
  await expect(cac).not.toHaveClass(/sleep/);
  await page.clock.fastForward(31000);
  await expect(cac).toHaveClass(/sleep/);
  await page.mouse.move(400, 300);
  await expect(cac).not.toHaveClass(/sleep/);
  await cac.click();
  await expect(cac).toHaveClass(/say/);
  await expect(cac.locator(".cac-happy")).toBeVisible();
  await expect(page.locator("#tip")).toBeVisible();
});
