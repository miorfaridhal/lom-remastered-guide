// Legend of Mana route solver.
//
// Treats 100% completion as a planning problem over the 68 events:
//   - hard prerequisites (all-of / any-of other events),
//   - land access (an event in a land needs the event that hands over that land's artifact),
//   - "must happen before" rules for missable events (data/constraints.json),
//   - The Legend of Mana (#68) last.
// A greedy best-first search then picks, at each step, the available event with the highest score:
// protect missables first, then unlock the most new events, then stay in the same land and arc.
// It also checks the hand-curated play order used on the page against the same rules.
//
// Usage:
//   node solver/solve.mjs            solve, check the curated order, write data/route-solved.json and ROUTE.md
//   node solver/solve.mjs --check    only check the curated order (exit code 1 on any violation)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = f => JSON.parse(readFileSync(join(root, "data", f), "utf8"));
const quests = load("quests.json"), lands = load("lands.json"), cons = load("constraints.json"), curated = load("route-curated.json");

const Q = new Map(quests.map(q => [q.id, q]));
const LAND = new Map(lands.map(l => [l.land, l]));
// guard: protects a missable event. facility: opens a workshop, the Orchard or the Monster Corral,
// which pay off for the rest of the game, so they go as soon as they are available.
const W = { guard: 100, facility: 60, unlock: 10, sameLand: 3, sameArc: 2 };

// Every rule an event has to satisfy, as { ok(done), text }.
function rulesFor(q) {
  const rules = [];
  if (q.prereq.length) {
    const any = q.prereqMode === "any";
    rules.push({
      ok: d => any ? q.prereq.some(i => d.has(i)) : q.prereq.every(i => d.has(i)),
      text: `${any ? "any of" : "all of"} ${q.prereq.map(i => "#" + i).join(", ")}`,
    });
  }
  const land = LAND.get(q.land), src = land ? land.sourceQuests.filter(i => i !== q.id) : [];
  if (src.length) rules.push({ ok: d => src.every(i => d.has(i)), text: `${q.land} placed (${land.artifact} from ${src.map(i => "#" + i).join(", ")})` });
  for (const c of (cons.requires || []).filter(c => c.id === q.id))
    rules.push({ ok: d => c.anyOf.some(i => d.has(i)), text: `any of ${c.anyOf.map(i => "#" + i).join(", ")}: ${c.why}` });
  for (const c of cons.before.filter(c => c.then === q.id))
    rules.push({ ok: d => d.has(c.first), text: `#${c.first} first: ${c.why}` });
  if (q.id === cons.last) rules.push({ ok: d => d.size === quests.length - 1, text: "every other event done" });
  return rules;
}
const RULES = new Map(quests.map(q => [q.id, rulesFor(q)]));
const available = (id, done) => !done.has(id) && RULES.get(id).every(r => r.ok(done));

function score(q, done, prev) {
  const guards = cons.before.filter(c => c.first === q.id && !done.has(c.then)).length;
  const before = quests.filter(o => available(o.id, done)).length;
  const next = new Set(done).add(q.id);
  const unlocks = quests.filter(o => available(o.id, next)).length - (before - 1);
  const facility = q.arc === "Crafting";
  const s = W.guard * guards + (facility ? W.facility : 0) + W.unlock * Math.max(0, unlocks) +
    (prev && prev.land === q.land ? W.sameLand : 0) + (prev && prev.arc === q.arc ? W.sameArc : 0);
  const why = [];
  if (guards) why.push(`protects ${guards} missable rule${guards > 1 ? "s" : ""}`);
  if (facility) why.push("opens a facility");
  if (unlocks > 0) why.push(`opens ${unlocks} new event${unlocks > 1 ? "s" : ""}`);
  if (prev && prev.land === q.land) why.push("same land");
  else if (prev && prev.arc === q.arc) why.push("same arc");
  return { s, why: why.join(", ") || "next available" };
}

export function solve() {
  const done = new Set(), route = [];
  let prev = null;
  while (done.size < quests.length) {
    const cands = quests.filter(q => available(q.id, done))
      .map(q => ({ q, ...score(q, done, prev) }))
      .sort((a, b) => b.s - a.s || a.q.id - b.q.id);
    if (!cands.length) {
      const left = quests.filter(q => !done.has(q.id)).map(q => `#${q.id} (${RULES.get(q.id).filter(r => !r.ok(done)).map(r => r.text).join("; ")})`);
      throw new Error("Dead end. Still blocked:\n  " + left.join("\n  "));
    }
    const pick = cands[0];
    route.push({ step: route.length + 1, id: pick.q.id, name: pick.q.name, land: pick.q.land, arc: pick.q.arc, why: pick.why, choices: cands.length });
    done.add(pick.q.id);
    prev = pick.q;
  }
  return route;
}

export function check(order) {
  const done = new Set(), problems = [];
  const missing = quests.filter(q => !order.includes(q.id)).map(q => q.id);
  if (missing.length) problems.push(`Missing events: ${missing.map(i => "#" + i).join(", ")}`);
  order.forEach((id, i) => {
    if (!Q.has(id)) return problems.push(`Step ${i + 1}: unknown event #${id}`);
    if (done.has(id)) return problems.push(`Step ${i + 1}: #${id} appears twice`);
    for (const r of RULES.get(id)) if (!r.ok(done)) problems.push(`Step ${i + 1}: #${id} ${Q.get(id).name} needs ${r.text}`);
    done.add(id);
  });
  return problems;
}

function routeMd(route) {
  const esc = s => String(s).replace(/\|/g, "\\|");
  const L = [];
  L.push("# Legend of Mana: full completion route", "");
  L.push("Generated by `node solver/solve.mjs` from `data/`. Do not edit by hand.", "");
  L.push(`All ${route.length} events in an order that respects every prerequisite, every land unlock and every missable rule in \`data/constraints.json\`. ` +
    "After every event: go home, talk to Li'l Cactus, go downstairs to watch him write it on the leaf, then save.", "");
  L.push("| Step | Event | Land | Arc | Why now |", "|---:|---|---|---|---|");
  for (const r of route) L.push(`| ${r.step} | [#${r.id} ${esc(r.name)}](#${r.step}-${r.id}) | ${esc(r.land)} | ${esc(r.arc)} | ${esc(r.why)} |`);
  L.push("");
  for (const r of route) {
    const q = Q.get(r.id);
    L.push(`<a id="${r.step}-${r.id}"></a>`, `## ${r.step}. #${q.id} ${q.name}`, "");
    L.push(`- **Land:** ${q.land} · **Arc:** ${q.arc}`);
    L.push(`- **Starts:** ${q.npc}. ${q.start}`);
    L.push(`- **Needs:** ${q.needs}`);
    L.push(`- **Gives:** ${q.reward}`);
    L.push(`- **Ends:** ${q.end}`);
    if (q.warning) L.push(`- **Warning:** ${q.warning}`);
    L.push("");
    q.route.forEach((s, i) => L.push(`${i + 1}. ${s.step}${s.path ? `\n   - Path: ${s.path}` : ""}`));
    if (q.routeNote) L.push("", `> ${q.routeNote}`);
    L.push("");
  }
  return L.join("\n");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const problems = check(curated.order);
  console.log(problems.length ? `Curated order: ${problems.length} problem(s)\n  ${problems.join("\n  ")}` : `Curated order: all ${curated.order.length} steps pass every rule.`);
  if (process.argv.includes("--check")) process.exit(problems.length ? 1 : 0);
  const route = solve();
  const self = check(route.map(r => r.id));
  if (self.length) throw new Error("Solver produced an invalid route:\n" + self.join("\n"));
  writeFileSync(join(root, "data", "route-solved.json"), JSON.stringify(route, null, 2) + "\n");
  writeFileSync(join(root, "ROUTE.md"), routeMd(route) + "\n");
  console.log(`Solved route: ${route.length} steps, valid. Wrote data/route-solved.json and ROUTE.md.`);
  for (const r of route) console.log(`${String(r.step).padStart(2)}. #${String(r.id).padEnd(2)} ${r.name.padEnd(40)} ${r.land.padEnd(16)} ${r.why}`);
}
