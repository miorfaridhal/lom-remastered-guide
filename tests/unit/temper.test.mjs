// Calibration tests for the tempering simulator. Run: npm run test:unit
//
// 1. Readings that use only measured rules (no essence, no varnish) must match exactly,
//    whatever the fitted settings are.
// 2. Every measured reading (28, 31, 30, 39, 58, 133, 160, ...) is replayed with the fitted
//    model in data/temper-model.json. Each must stay within the error recorded at fit time, so
//    any change to the simulator that moves a prediction away from the game fails here.
// 3. The card-slot rules and golem block strength (+9 at 161) are checked directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSimulator, blockStrength } from "../../js/temper.js";

const read = f => JSON.parse(readFileSync(new URL(`../../${f}`, import.meta.url), "utf8"));
const forge = read("data/forge.json"), cal = read("data/calibration.json"), fitted = read("data/temper-model.json");
const sim = createSimulator(forge, fitted.model);
const last = r => { const t = sim(r); return t[(r.at || t.length) - 1]; };
const recorded = new Map(fitted.readings.map(r => [r.id, r]));

test("readings that use only measured rules match exactly", () => {
  const exactOnly = cal.readings.filter(r => r.kind === "measured" && last(r).confidence === "measured");
  assert.ok(exactOnly.length >= 15, `expected at least 15 rule-only readings, got ${exactOnly.length}`);
  for (const r of exactOnly) assert.equal(last(r).power, r.power, r.id);
});

for (const r of cal.readings.filter(r => r.kind === "measured")) {
  const tol = Math.abs((recorded.get(r.id) || {}).error || 0);
  test(`measured ${r.id}: ${r.material} ${r.type} reads ${r.power}${tol ? ` (fit allows ±${tol})` : " (exact)"}`, () => {
    const rec = recorded.get(r.id);
    assert.ok(rec, `${r.id} is missing from data/temper-model.json; run npm run calibrate`);
    const got = last(r).power;
    assert.ok(Math.abs(got - r.power) <= Math.abs(rec.error),
      `${r.id}: predicted ${got}, game shows ${r.power}; the fit allowed ±${Math.abs(rec.error)}`);
  });
}

test("the fitted model reproduces the recorded predictions (no drift)", () => {
  for (const r of cal.readings) assert.equal(last(r).power, recorded.get(r.id).predicted, r.id);
});

test("key measured readings are exact: 39, 133, 160", () => {
  for (const id of ["piece3-chaos", "piece1-full", "ishe-2h-recipe5"]) {
    const r = cal.readings.find(x => x.id === id);
    assert.equal(last(r).power, r.power, id);
  }
});

test("Lilipod on a spear with no essence makes a Pixie card", () => {
  const r = cal.readings.find(x => x.id === "piece2-lilipod");
  const s = last(r);
  assert.ok([...s.visible, s.hidden].includes("Pixie"));
});

test("the 133 spear ends with three Clown cards in view and varnished", () => {
  const s = last(cal.readings.find(x => x.id === "piece1-full"));
  assert.deepEqual(s.visible, ["Clown", "Clown", "Clown"]);
  assert.equal(s.varnished, true);
});

for (const rule of cal.rules.filter(r => r.steps)) {
  test(`card slots: ${rule.id}`, () => {
    const t = sim({ material: "Lorant Silver", type: "Spear", steps: rule.steps });
    const s = t[t.length - 1];
    assert.equal(s.visible.filter(c => c === "Clown").length, rule.visibleClowns);
    if (rule.hiddenCard) assert.equal(s.hidden, rule.hiddenCard);
  });
}

test("golem block strength: 133 + 28 = 161 shows +9", () => {
  const rule = cal.rules.find(r => r.id === "block-plus-9");
  assert.equal(blockStrength(...rule.pieces), rule.strength);
  assert.equal(blockStrength(100, 52), 8);
  assert.equal(blockStrength(300, 300), 9);
});

test("attribute items count only while they are the last item", () => {
  const run = steps => { const t = sim({ material: "Lorant Silver", type: "Spear", steps }); return t[t.length - 1].power; };
  assert.equal(run(["Dragon's Breath"]), 31);
  assert.equal(run(["Dragon's Breath", "Dragon's Breath"]), 31, "stacking does nothing");
  assert.equal(run(["Dragon's Breath", "Fire Stone"]), run(["Fire Stone"]), "a stone wipes the attribute change");
});
