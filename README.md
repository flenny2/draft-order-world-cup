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
| `data.js` | **DATA** — the one editable place: teams, members, fixtures, bracket topology |
| `engine.js` | **LOGIC** — pure ruleset → draft order. No DOM, no clock, no Firebase |
| `schedule.js` | pure time helpers (next match, countdown) — takes `now` explicitly |
| `report.js` | pure plain-text league-update generator |
| `store.js` | the Firebase boundary (Realtime DB + auth) — the only file that knows Firebase |
| `app.js` | **PRESENTATION** — views, routing, renders engine output |
| `demo.js` | a sample finished tournament (loadable from admin) |
| `engine.test.js` | invariant test harness (`node engine.test.js`) |

The engine is pure and deterministic; it's verified by a 5-invariant test suite
(no gaps, band-local tiebreaks, pens=draw, deterministic, locked-stability) plus a
seeded fuzz. Firebase is hidden behind `store.js` so the rest of the app never
depends on it — the same boundary the future live-score API will reuse.

## Run locally

ES modules need HTTP (not `file://`):

```bash
python3 -m http.server 8173     # then open http://localhost:8173
node engine.test.js             # run the test harness
```

Admin entry is at `#admin`. The Firebase web config in `store.js` is **not a
secret** — security comes from the database rules (public read; writes only from
the admin account).
