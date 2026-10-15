# Legend of Mana Tracker

A fan-made completion tracker and route planner for **Legend of Mana Remastered**. It covers all 68 events in a prerequisite-safe play order, missable-quest warnings, abilities and weapon techniques, forging and tempering, farming, drops, pets and egg spots.

**Live page:** https://miorfaridhal.github.io/lom-remastered-guide/

Ticks are saved in your own browser (localStorage). Nothing is sent anywhere.

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

## Sources

Quest prerequisites, routes, ability and technique requirements, forge tables, drops and pet stats were compiled from fan guides, including Legend of Mana Info, StrategyWiki, GamePretty, Seikens, Wiki of Mana, GameFAQs and Steam community guides. The full list with links is at the bottom of the page.

## Disclaimer

Fan-made and unofficial. Legend of Mana is a trademark of Square Enix. This project is not affiliated with or endorsed by Square Enix. All icons are original drawings, not game artwork.

Code is MIT licensed (see [LICENSE](LICENSE)).
