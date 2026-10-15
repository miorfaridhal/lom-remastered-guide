// Pulls the quest, land and play-order data out of index.html into data/*.json,
// so the solver and the page share one source of truth.
// Usage: node tools/extract.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");

// Grab `var NAME=<literal>;` where the literal is an array, balancing brackets and skipping strings.
function literal(name) {
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
  return vm.runInNewContext("(" + html.slice(from, i) + ")");
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

mkdirSync(join(root, "data"), { recursive: true });
const out = (f, v) => writeFileSync(join(root, "data", f), JSON.stringify(v, null, 2) + "\n");
out("quests.json", quests);
out("lands.json", lands);
out("route-curated.json", { order: ORDER, phases });
console.log(`Extracted ${quests.length} quests, ${lands.length} lands, ${ORDER.length}-step curated order.`);
