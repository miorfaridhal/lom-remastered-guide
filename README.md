# Mana Compass: Legend of Mana Remastered Companion

<img src="icons/icon-192.png" alt="" width="96" align="right">

A fan-made companion for **Legend of Mana Remastered**. It points you to the next step and the best gear. It covers all 68 events in a missable-safe play order, abilities and weapon techniques, forging and tempering, farming, drops, pets and egg spots.

**Open it:** https://miorfaridhal.github.io/lom-remastered-guide/

- **Install it.** On Android Chrome use *Add to Home screen* (or *Install app*); on iPhone Safari use *Share → Add to Home Screen*. It opens full screen like an app.
- **Works offline.** After the first visit the whole app is cached, so it runs with no signal. When a new version is published, an *Update available* toast offers a one-tap reload.
- **Your progress stays yours.** Ticks are saved in your browser (localStorage) and never sent anywhere. Use *Export progress* at the bottom of any tab to save a JSON file, and *Import progress* on another device to carry on there.

## What is in it

| Tab | What it does |
|---|---|
| Story → Quests | All 68 events, in play order or grouped by artifact. Each has where it starts, what it needs, what it gives, warnings and a step-by-step route. Status tags (Ready / Waiting / Done) update as you tick. |
| Story → Places | What unlocks the Monster Corral, Orchard and each workshop, the artifact placement order, and an interactive 6×6 artifact map for a new game. |
| Story → NPCs, Hidden | Quests by the NPC who starts them; missable quests, secrets with no quest entry, mana-gated pets, New Game Plus notes. |
| Skills | The 26 abilities and what unlocks each; every weapon's special techniques with Ready / Locked status. |
| Forge | Forging and tempering rules, a base-stat calculator, materials, cards, immunities and worked recipes. |
| Farm | Stage-by-stage farm plan, money loops, and a drop finder with odds by monster level. |
| Pets | All 64 pets ranked by base stats, and every egg spot. |

## Route solver

Completing the game is treated as a planning problem. [`solver/solve.mjs`](solver/solve.mjs) builds the full rule set for each event:

1. **Prerequisites**: all-of or any-of other events (from `data/quests.json`).
2. **Land access**: an event in a land needs the event that hands over that land's artifact (from `data/lands.json`).
3. **Missable rules**: "A must be cleared before B", for events that are lost, fail or will not start otherwise (from `data/constraints.json`, each with its reason).
4. **Finale**: The Legend of Mana (#68) comes last.

It then runs a greedy best-first search. At every step it scores each event that is currently available and takes the best one:

| Signal | Weight | Why |
|---|---:|---|
| Protects a missable rule | 100 | Clear the event that would otherwise be locked out. |
| Opens a facility | 60 | Workshops, the Orchard and the Monster Corral pay off for the rest of the game. |
| Each newly unlocked event | 10 | Prefer events whose rewards (usually artifacts) open more of the game. |
| Same land as the last event | 3 | Less travel. |
| Same story arc | 2 | Keeps arcs together. |

The solver checks its own result against every rule and fails if anything is broken. It also checks the hand-curated play order that the page uses, so both orders are known to be valid.

```bash
node solver/solve.mjs
```

```bash
node solver/solve.mjs --check
```

The first command writes [`data/route-solved.json`](data/route-solved.json) and a full walkthrough, [`ROUTE.md`](ROUTE.md). The second only checks the curated order and exits non-zero on any violation. Both need Node 18 or later and no packages.

### Limits

- The solver does not model mana levels. A few events (#43 Seeing Double, #66 The Wimpy Thugling, #67 Pee-Wee Birdie) also need a land's element at level 3, which depends on where you place artifacts. Use the artifact map on the Places tab.
- The rules come from fan guides written around both the PlayStation original and the remaster. If a rule is wrong for your version, fix it in `data/constraints.json` and re-run.

## Tempering simulator

[`js/temper.js`](js/temper.js) is a deterministic model of forging and tempering a weapon. Give it a material, a weapon type and the items in order; it returns the power, the eight essence levels, the visible and hidden cards and whether varnish is active after every step. It is the engine for the forging advisor that comes next.

Each part of the model has a confidence level:

| Part | Confidence | Rule |
|---|---|---|
| Base power | Measured | floor(Σ weight × material value ÷ 128) over Slash, Heavy, Force and Tech |
| Attribute items | Measured | An item like Dragon's Breath changes the weights only while it is the last item added |
| Card slots | Measured | 3 visible + 1 hidden; a new card enters hidden; stones make no card; a Lilipod on an item with no essence makes a Pixie |
| Golem block strength | Measured | floor((piece 1 + piece 2) ÷ 17), shown up to +9 |
| Essence energy | Guide | Level costs from the energy table by resistance and wizard cards; tainting items feed their element |
| Essence → power, varnish | Estimate | Fitted to the readings below |

How essence turns into power is not published, so [`tools/calibrate.mjs`](tools/calibrate.mjs) fits it. It tries over 200,000 combinations of the model's open choices against [`data/calibration.json`](data/calibration.json): 19 readings measured in the Android remaster and 5 figures from fan guides. Measured readings always win over guide figures. [`CALIBRATION.md`](CALIBRATION.md) lists every prediction and its error.

**Current fit:** 18 of 19 measured readings are exact, including 39 after the Chaos Crystal, 133 for the varnished Laurent Silver spear and 160 for the Ishe Platinum 2H Sword. The 58 after the Glow Crystal comes out as 61. The older guide varnish figures (Dragon Scales 711, Altena 414) do not fit the same model as the remaster readings, and the report shows by how much.

```bash
npm run test:unit
```

```bash
npm run calibrate
```

The unit tests replay every measured reading. A reading the fit gets exactly must stay exact, and any change to the simulator that moves a prediction fails the build. After adding a new reading to `data/calibration.json`, run `npm run calibrate` and commit the updated `data/temper-model.json` and `CALIBRATION.md`.

## Data

The page (`index.html`) is the source of truth. `tools/extract.mjs` pulls its quest, land and order tables into `data/`:

```bash
node tools/extract.mjs
```

| File | Contents |
|---|---|
| `data/quests.json` | 68 events with land, arc, start, needs, reward, end, warning, prerequisites and route steps |
| `data/lands.json` | 26 lands in placement order, their artifact and which event gives it |
| `data/route-curated.json` | The hand-curated play order and its phases, as shown on the page |
| `data/constraints.json` | Missable "before" rules and extra requirements, each with a reason |
| `data/route-solved.json` | The solver's route with the reason for each step |

## Usage counts

- **claude.ai artifact:** each signed-in viewer with Contributor access or above keeps one counter document, `visits/<anonymous id>`: number of visits, visits per day (last 120 days) and tabs opened. No names or emails. The artifact's database rules let each viewer write only their own counter and only the owner read them all; the owner sees the totals on the About tab.
- **Website:** GitHub Pages has no visitor statistics, so the site can use [GoatCounter](https://www.goatcounter.com/) (no cookies, no personal data). It is on, with site code `manacompass` (`GC_CODE` in `index.html`): it counts page loads, each tab as its own path, and opens of the installed app. Tests stand in for GoatCounter, so test runs never add visits to the dashboard.

## Development

The site is static: `index.html`, `sw.js`, `manifest.webmanifest` and `icons/`, served from the `main` branch root by GitHub Pages. There is no build step for the page itself. Node 18 or later is needed for the tools and tests.

```bash
npm ci
```

```bash
npx playwright install chromium
```

```bash
npm run serve
```

```bash
npm test
```

```bash
npm run build
```

| Command | What it does |
|---|---|
| `npm run serve` | Serves the site at http://127.0.0.1:4173/lom-remastered-guide/, the same path as GitHub Pages. |
| `npm test` | Playwright smoke tests on a 390 px phone and a desktop: no page errors, quest and land counts with a sample save (`tests/fixtures/progress.json`), Forge > Blocks shows the measured 133 spear, export and import, manifest and icons, offline after first load, and the update toast. |
| `npm run build` | Re-extracts `data/`, re-runs the solver and stamps `sw.js` with a hash of the app shell. **Run it after any change to `index.html` or `icons/`**, or visitors keep the cached old version. CI fails if you forget. |
| `npm run icons` | Re-renders the PNG icons from `icons/icon.svg` and `icons/icon-maskable.svg`. |

Progress is stored under the localStorage keys `lom-tracker-v1` (ticks) and `lom-ui-v1` (folded cards). Keep those names so existing saves keep loading.

## Sources

Quest prerequisites, routes, ability and technique requirements, forge tables, drops and pet stats were compiled from fan guides, including Legend of Mana Info, StrategyWiki, GamePretty, Seikens, Wiki of Mana, GameFAQs and Steam community guides. The full list with links is at the bottom of the page.

## Disclaimer

Fan-made and unofficial. Legend of Mana is a trademark of Square Enix. This project is not affiliated with or endorsed by Square Enix. All icons are original drawings, not game artwork.

Code is MIT licensed (see [LICENSE](LICENSE)).
