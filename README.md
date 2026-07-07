# World Cup Fantasy — Draft Order

A shareable, mobile-first web tool that ties a 12-person fantasy league's draft
order to the 2026 World Cup knockout stage. Each member is randomly assigned one
Round-of-16 team; your draft pick is how far your team goes (best finish = pick 1).
The order updates live as results are entered, with locked vs. "if scores hold"
projections.

## How it works

Finish order, best → worst: **Champion → Runner-up → 3rd → 4th → the 4 QF losers
(a band) → the 8 R16 losers (a band)**, numbered 1–12 over only the drawn teams.
Within the two loser bands, ties break on: elimination-match goal difference →
goals scored → a distinct 1–12 tiebreak number drawn for each team. A penalty
shootout counts as a **draw** (the recorded score is the end of extra time), so a
pens-loser outranks a regulation loser. Full ruleset in [`claude.md`](./claude.md).

## Architecture (vanilla ES modules, no build step)

| File | Responsibility |
|---|---|
| `index.html` / `styles.css` | shell + styling (dark, mobile-first) |
| `data.js` | **DATA** — the men's-WC seed: teams, members, fixtures, bracket topology |
| `tournament.js` | **DATA** — tournament profiles: knockout structure (`ruleset`), labels, seed. The active profile is chosen here |
| `engine.js` | **LOGIC** — pure ruleset → draft order. No DOM, no clock, no Firebase; reads structure from a profile's `ruleset` (defaults to men's WC) |
| `schedule.js` | pure time helpers (next match, countdown) — takes `now` explicitly |
| `report.js` | pure plain-text league-update generator |
| `store.js` | the Firebase boundary (Realtime DB + auth) — the only file that knows Firebase |
| `app.js` | **PRESENTATION** — views, routing, renders engine output |
| `demo.js` | a sample finished tournament (loadable from admin) |
| `engine.test.js` | invariant test harness (`node engine.test.js`) |
| `simulate.js` | Monte Carlo tiebreak-fairness report + process fuzzer (`node simulate.js`) |

The engine is pure and deterministic; it's verified by a 5-invariant test suite
(no gaps, band-local tiebreaks, pens=draw, deterministic, locked-stability) plus a
seeded fuzz. Firebase is hidden behind `store.js` so the rest of the app never
depends on it — the same boundary the future live-score API will reuse.

## Run locally

ES modules need HTTP (not `file://`):

```bash
python3 -m http.server 8173     # then open http://localhost:8173
node engine.test.js             # run the test harness
node simulate.js                # fairness report + process stress test
```

Admin entry is at `#admin`. The Firebase web config in `store.js` is **not a
secret** — security comes from the database rules (public read; writes only from
the admin account). CI runs the harness and the simulator on every push.

## Draw-night runbook (do these in order)

Team names live only in `data.js`; kickoff times and venues are editable in
the admin UI too (each match card's "Kickoff & venue" panel — times entered in
your device's local zone). "Reset to blank seed" seeds the live database from
`data.js`, so the seed must be correct **before** the reset; a later reset
wipes everything entered.

1. **When the Round of 32 finishes:** put the real 16 teams into `data.js`
   (replace the `W77`–`W88` placeholders: id/code/name/flag, and the team ids
   in the 8 R16 match rows), and verify every R16 row — teams, venue, kickoff
   time and UTC offset — against TV listings. July offsets: EDT −04, CDT −05,
   PDT −07, Mexico City −06 (no DST there).
2. Run `node engine.test.js` and `node simulate.js`; commit and push (GitHub
   Pages redeploys, CI re-runs the same checks).
3. In `#admin`: **Reset to blank seed** — this replaces the demo data.
4. Run the draw on random.org. Enter the 12 assignments **and** the 12 distinct
   tiebreak numbers. The issues banner must show no errors.
5. Spot-check the public view (12 rows in the order, 4 chips under "Out of
   play"), then share the link.

Safety nets: every admin write first copies the state it replaces to `/backup`
in the database (restorable from the Firebase console), and the save toast +
tab-close guard warn when a write hasn't reached the server yet.
