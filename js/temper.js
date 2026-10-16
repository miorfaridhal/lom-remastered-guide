// Mana Compass tempering simulator.
//
// Deterministic model of Legend of Mana forging and tempering for weapons. Every number it
// returns carries a confidence: "measured" rules reproduce in-game readings exactly, "guide"
// rules come from fan guides, and "estimate" parts are fitted to readings (see
// tools/calibrate.mjs and data/temper-model.json).
//
// Measured, exact (CONTEXT.md §3):
//   - power = floor( Σ weight_i × material_i / 128 ) for Slash, Heavy, Force, Tech.
//   - An attribute item (e.g. Dragon's Breath, Force +25% Tech +25%) changes the weights only
//     while it is the LAST item added. A new attribute item replaces it; any other item wipes it.
//   - Cards: 3 visible + 1 hidden slot. A new card enters the hidden slot; the hidden card moves
//     into view; the oldest visible card is pushed out. Stones make no card and push nothing.
//   - A Lilipod on an item with no essence makes a Pixie card.
//   - Golem block strength = floor((piece1 + piece2) / 17), shown up to +9.
// Guide:
//   - Essence level n costs the `energy` table entry for the material's resistance and the
//     number of wizard cards (Sorcerer: Wisp, Dryad, Salamander, Gnome; Witch: the other four).
//   - An item's energy feeds the element it taints. Coins also add 1 (silver) or 2 (gold) levels.
//   - Card conditions from the card table; Glow Crystal's Nymph of Dawn card releases 192 energy
//     when it is pushed out; varnish = three identical cards plus an attribute item last.
// Estimate (fitted):
//   - Each essence level adds k × base / growth to power (the guides' "base ÷ EG per level").
//   - Varnish multiplies the last attribute item's percentages by N.
//   - The model options below (where released energy goes, how wizard cards count, ...).

export const ELEMENTS = ["Wisp", "Shade", "Dryad", "Aura", "Salamander", "Gnome", "Jinn", "Undine"];
const SORCERER = new Set([0, 2, 4, 5]); // Wisp, Dryad, Salamander, Gnome
const ATTRS = ["Slash", "Heavy", "Force", "Tech"];
const STONES = new Set(["Fire Stone", "Earth Stone", "Wind Stone", "Water Stone"]);
const MAX_LEVEL = 9;

export const DEFAULT_MODEL = {
  k: 1,                 // essence gain per level, × base / growth
  varnishN: 6,          // varnish multiplies the final attribute item's percentages by this
  release: "cheapest",  // Nymph of Dawn's 192 energy: "none" | "cheapest" | "even"
  levels: "bank",       // "bank": costs paid as energy arrives; "retro": recomputed from all energy so far
  wizards: "current",   // wizard discount counts Sorcerer/Witch cards "current"ly on the item, or "ever" tempered
  varnishSlots: "all",  // the three identical cards may be in the "visible" slots only, or "all" four
  wizardEnergy: "none", // Sulpher / Mercury energy: "none", or "group" = spent on awake elements of their group
  glowEnergy: "none",   // Glow Crystal's own 96 energy when tempered: "none", or "awake" = spent on awake elements
  varnishMode: "amplify", // "amplify": the last item's percentages × varnishN; "scale": the item applies normally and power × varnishN
};

const ELEMENT_INDEX = Object.fromEntries(ELEMENTS.map((e, i) => [e, i]));
const SPECIAL_CARDS = {
  Sulpher: "Sorcerer", Mercury: "Witch", "Chaos Crystal": "Ancient Moon",
  "Glow Crystal": "Nymph of Dawn", Bumpkin: "Clown", Lilipods: "Enticed Nymph",
};

function parseAttr(effect) {
  const m = /Weapons: ([^.]*)/.exec(effect || "");
  if (!m) return null;
  const mult = [1, 1, 1, 1];
  let any = false;
  for (const part of m[1].split(",")) {
    const r = /(Slash|Heavy|Force|Tech) ([+-])(\d+)%/.exec(part);
    if (!r) continue;
    mult[ATTRS.indexOf(r[1])] = 1 + (r[2] === "-" ? -1 : 1) * Number(r[3]) / 100;
    any = true;
  }
  return any ? mult : null;
}

// Card condition text from the card table, e.g. "Wisp above 2, total above 4", "Dryad above 0, Salamander 0".
function parseNeeds(text) {
  if (!text || text === "None") return () => true;
  const tests = text.split(/,\s*(?=[A-Z]|total)/i).map(clause => {
    const c = clause.trim();
    let m = /^(.*?) (?:all )?above (\d+)$/i.exec(c);
    const names = s => s.split(/,\s*|\s+and\s+/).map(x => x.trim()).filter(Boolean);
    if (m) {
      const n = Number(m[2]);
      if (/^total$/i.test(m[1])) return lv => lv.reduce((a, b) => a + b, 0) > n;
      const idx = names(m[1]).map(x => ELEMENT_INDEX[x]);
      if (idx.some(i => i === undefined)) return null;
      return lv => idx.every(i => lv[i] > n);
    }
    m = /^(.*?) (\d+)$/.exec(c);
    if (m) {
      const idx = names(m[1]).map(x => ELEMENT_INDEX[x]);
      if (idx.some(i => i === undefined)) return null;
      return lv => idx.every(i => lv[i] === Number(m[2]));
    }
    return null;
  });
  if (tests.some(t => t === null)) return () => true; // unparsed: assume met (guide data is incomplete)
  return lv => tests.every(t => t(lv));
}

export function createSimulator(forge, model = {}) {
  const M = { ...DEFAULT_MODEL, ...model };
  const materials = new Map(forge.materials.map(m => [m.name, m]));
  const weapons = new Map(forge.weapons.map(w => [w.name, w]));
  const items = new Map(forge.items.map(i => [i.name, i]));
  const cardFor = new Map();
  for (const c of forge.cards)
    for (const name of c.item.split(/\s+or\s+|,\s*/)) cardFor.set(name.trim(), { card: c.card, ok: parseNeeds(c.needs) });

  function resolveItem(name) {
    const coin = /^(\w+) (Silver|Gold) coin$/.exec(name);
    if (coin && ELEMENT_INDEX[coin[1]] !== undefined)
      return { name, energy: coin[2] === "Gold" ? 64 : 48, taint: ELEMENT_INDEX[coin[1]], points: coin[2] === "Gold" ? 2 : 1, attr: null };
    const it = items.get(name);
    if (!it) throw new Error(`Unknown tempering item: ${name}`);
    const taint = ELEMENT_INDEX[it.taint];
    return { name, energy: it.energy, taint: taint === undefined ? null : taint, points: 0, attr: parseAttr(it.effect) };
  }

  function costRow(mat, e, wiz) {
    const table = forge.energy[mat.resistance[e]] || forge.energy[String(mat.resistance[e])];
    if (!table) throw new Error(`No energy row for resistance ${mat.resistance[e]}`);
    return table[Math.min(3, wiz)];
  }

  return function simulate({ material, type, steps = [] }) {
    const mat = materials.get(material), wpn = weapons.get(type);
    if (!mat) throw new Error(`Unknown material: ${material}`);
    if (!wpn) throw new Error(`Unknown weapon type: ${type}`);

    const s = {
      levels: Array(8).fill(0), bank: Array(8).fill(0), invested: Array(8).fill(0), points: Array(8).fill(0),
      fixed: null, visible: [], hidden: null, attr: null, varnish: null, wizEver: { sorc: 0, witch: 0 }, released: 0,
    };
    const wizards = e => {
      const key = SORCERER.has(e) ? "Sorcerer" : "Witch";
      if (M.wizards === "ever") return SORCERER.has(e) ? s.wizEver.sorc : s.wizEver.witch;
      return [...s.visible, s.hidden].filter(c => c === key).length;
    };
    const total = () => s.levels.reduce((a, b) => a + b, 0);

    function recompute() {
      if (M.levels !== "retro") return;
      for (let e = 0; e < 8; e++) {
        const row = costRow(mat, e, wizards(e));
        let lv = 0, spent = 0;
        while (lv < MAX_LEVEL && spent + row[lv] <= s.invested[e]) spent += row[lv++];
        s.levels[e] = Math.min(MAX_LEVEL, (s.fixed ? s.fixed[e] : 0) + s.points[e] + lv);
      }
    }
    function feed(e, energy) {
      s.invested[e] += energy;
      if (M.levels === "retro") return;
      s.bank[e] += energy;
      const row = costRow(mat, e, wizards(e));
      while (s.levels[e] < MAX_LEVEL && s.bank[e] >= row[s.levels[e]]) s.bank[e] -= row[s.levels[e]++];
    }
    function release(energy, how = M.release, only = null) {
      s.released += energy;
      const awake = [...Array(8).keys()].filter(e => s.levels[e] > 0 && s.levels[e] < MAX_LEVEL && (!only || only.has(e)));
      if (!awake.length || how === "none") return;
      if (how === "even") { for (const e of awake) feed(e, energy / awake.length); return; }
      let left = energy; // "cheapest": buy the cheapest next level, repeatedly
      for (;;) {
        let best = -1, need = Infinity;
        for (const e of awake) {
          if (s.levels[e] >= MAX_LEVEL) continue;
          const d = M.levels === "retro"
            ? costRow(mat, e, wizards(e)).slice(0, s.levels[e] - s.points[e] + 1).reduce((a, b) => a + b, 0) - s.invested[e]
            : costRow(mat, e, wizards(e))[s.levels[e]] - s.bank[e];
          if (d < need) { need = d; best = e; }
        }
        if (best < 0 || need > left) { if (best >= 0 && left > 0) feed(best, left); break; }
        feed(best, Math.max(0, need)); left -= Math.max(0, need); recompute();
      }
    }
    function addCard(card) {
      if (!card) return;
      if (s.hidden) s.visible.unshift(s.hidden);
      s.hidden = card;
      while (s.visible.length > 3) {
        const out = s.visible.pop();
        if (out === "Nymph of Dawn") release(192);
      }
      if (card === "Sorcerer") s.wizEver.sorc++;
      if (card === "Witch") s.wizEver.witch++;
    }
    function cardOf(it) {
      if (it.name === "Lilipods") return total() === 0 ? "Pixie" : "Enticed Nymph";
      if (SPECIAL_CARDS[it.name]) return SPECIAL_CARDS[it.name];
      if (STONES.has(it.name)) return null;
      const c = cardFor.get(it.name);
      if (c && c.ok(s.levels)) return c.card;
      return it.taint !== null ? ELEMENTS[it.taint] : null;
    }
    function identicalCards() {
      const slots = M.varnishSlots === "visible" ? s.visible : [...s.visible, s.hidden];
      const n = {};
      for (const c of slots) if (c) n[c] = (n[c] || 0) + 1;
      return Math.max(0, ...Object.values(n));
    }

    const trace = [];
    for (const step of steps) {
      if (step && step.levels) {
        s.fixed = step.levels.slice();
        s.levels = step.levels.slice();
        s.attr = null; s.varnish = null;
        trace.push(snapshot("set levels"));
        continue;
      }
      const it = resolveItem(step);
      // Attribute rule (measured): only the last item's attribute change counts.
      const wasVarnishable = it.attr && identicalCards() >= 3;
      s.attr = it.attr;
      s.varnish = !wasVarnishable ? null
        : M.varnishMode === "scale" ? it.attr.slice()
        : it.attr.map(m => Math.max(0, 1 + M.varnishN * (m - 1)));
      if (it.name === "Holy Water" || it.name === "Garlicrown") {
        s.visible = s.visible.filter(c => c !== "Pixie");
        if (s.hidden === "Pixie") s.hidden = null;
      }
      if (it.taint !== null) {
        s.points[it.taint] += it.points;
        if (M.levels === "bank") s.levels[it.taint] = Math.min(MAX_LEVEL, s.levels[it.taint] + it.points);
        feed(it.taint, it.energy);
      }
      recompute();
      addCard(cardOf(it));
      recompute();
      if (M.wizardEnergy === "group" && (it.name === "Sulpher" || it.name === "Mercury"))
        release(it.energy, "cheapest", it.name === "Sulpher" ? SORCERER : new Set([1, 3, 6, 7]));
      if (M.glowEnergy === "awake" && it.name === "Glow Crystal") release(it.energy, "cheapest");
      recompute();
      trace.push(snapshot(it.name));
    }
    if (!trace.length) trace.push(snapshot("forge"));
    return trace;

    function snapshot(label) {
      const mult = s.varnish || s.attr || [1, 1, 1, 1];
      const L = total();
      const sum = wpn.weights.reduce((a, w, i) => a + w * mult[i] * mat.weapon[i], 0);
      const scale = s.varnish && M.varnishMode === "scale" ? M.varnishN : 1;
      const power = Math.floor(sum * (1 + M.k * L / mat.growth) * scale / 128 + 1e-9);
      return {
        step: label, power, levels: s.levels.slice(), totalLevels: L,
        visible: s.visible.slice(), hidden: s.hidden, varnished: !!s.varnish, attr: s.attr ? s.attr.slice() : null,
        confidence: L === 0 && !s.varnish ? "measured" : "estimate",
      };
    }
  };
}

// Golem logic block strength (measured): floor((a + b) / 17), shown from +1 to +9.
export function blockStrength(a, b) {
  return Math.min(9, Math.floor((a + b) / 17));
}
