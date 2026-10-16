// Pulls the quest, land and play-order data out of index.html into data/*.json,
// so the solver and the page share one source of truth.
// Usage: node tools/extract.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");

// Grab `var NAME=<literal>;` where the literal is an array or object, balancing brackets and skipping strings.
// `ctx` supplies any constants the literal refers to.
function literal(name, ctx = {}) {
  const start = html.indexOf(`var ${name}=`);
  if (start < 0) throw new Error(`${name} not found in index.html`);
  let i = html.indexOf("=", start) + 1, depth = 0, str = null, from = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (str) { if (c === "\\") i++; else if (c === str) str = null; continue; }
    if (c === '"' || c === "'") str = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return vm.runInNewContext("(" + html.slice(from, i) + ")", ctx);
}
// `var R8="…", WR="…", AR="…";` are shared resistance rows used inside MATS.
function strings(name) {
  const m = html.match(new RegExp(`\\b${name}="([^"]*)"`));
  if (!m) throw new Error(`${name} not found in index.html`);
  return m[1];
}

const Q = literal("Q"), ORDER = literal("ORDER"), PHASES = literal("PHASES"), LANDS = literal("LANDS");

const quests = Q.map(r => ({
  id: r[0], name: r[1], land: r[2], arc: r[3], npc: r[4], start: r[5], needs: r[6],
  reward: r[7], end: r[8], warning: r[9], prereq: r[10], prereqMode: r[11],
  route: (r[12] || []).map(s => { const [step, path] = s.split("||"); return path ? { step, path } : { step }; }),
  routeNote: r[13] || "",
}));
const lands = LANDS.map((l, i) => ({
  order: i + 1, land: l[0], artifact: l[1], source: l[2],
  sourceQuests: [...l[2].matchAll(/#(\d+)/g)].map(m => +m[1]),
}));
const phases = PHASES.map(p => ({ fromStep: p[0], title: p[1] }));

// Forge tables for the tempering simulator (js/temper.js).
const nums = s => s.split(" ").map(Number);
const MATS = literal("MATS", { R8: strings("R8"), WR: strings("WR"), AR: strings("AR") });
const forge = {
  elements: literal("ELEM").map(e => e[0]),
  materials: MATS.map(m => ({ name: m[0], class: m[1], weapon: nums(m[2]), armor: nums(m[3]), growth: m[4], resistance: nums(m[5]) })),
  weapons: literal("WEAP").map(w => ({ name: w[0], weights: nums(w[1]) })),
  armor: literal("ARM").map(a => ({ name: a[0], class: a[1], weights: nums(a[2]) })),
  energy: literal("ENERGY"),
  items: literal("ITEMS").flatMap(([group, rows]) => rows.map(r => ({ name: r[0], group, energy: r[1], taint: r[2], effect: r[3] }))),
  cards: literal("CARDS").map(c => ({ card: c[0], item: c[1], needs: c[2], effect: c[3] })),
};

mkdirSync(join(root, "data"), { recursive: true });
const out = (f, v) => writeFileSync(join(root, "data", f), JSON.stringify(v, null, 2) + "\n");
out("quests.json", quests);
out("lands.json", lands);
out("route-curated.json", { order: ORDER, phases });
out("forge.json", forge);
console.log(`Extracted ${quests.length} quests, ${lands.length} lands, ${ORDER.length}-step curated order, ` +
  `${forge.materials.length} materials, ${forge.items.length} tempering items, ${forge.cards.length} item cards.`);
