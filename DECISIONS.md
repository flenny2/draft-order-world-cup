# DECISIONS.md — architectural choices whose *why* isn't obvious from the code

Small log of load-bearing decisions that span files or record a rejected/constrained
path. Inline comments cover the local "why"; this file covers the "why" that needs a
map of several files or a constraint that lives outside the code.

---

## 2026-07-07 — Tournament profile layer (engine takes a `ruleset`)

**What changed.** `engine.js` was hard-coded to the men's 2026 World Cup. It now takes a
`ruleset` on every entry point (`classifyTeams`, etc.), defaulting to the men's WC — so
existing callers and the test suite are unchanged. All tournament-specific STRUCTURE
(finish bands + their order, the round→band map, lock dependencies, the tiebreak-number
range) moved out of the engine into `tournament.js` as a *profile*. `engine.js` stays pure
LOGIC and knows nothing tournament-specific; `app.js` (PRESENTATION) reads a profile's
`labels`/`seed`, and `data.js` is now just the men's-WC seed.

**Why.** So the women's World Cup, the Euros, and the Champions League become "add a
profile to `tournament.js`", not "edit the engine." Before this, generalizing meant
forking the ruleset logic. (Naming trap: `profiles.js` is unrelated sticker-card facts —
`tournament.js` is the tournament CONFIG. Keep them separate.)

**Safety net.** The men's-WC profile MUST stay behaviour-identical to the pre-profile
engine — do not "tidy" its `ruleset` values without re-running the suite; they ARE the
current behaviour. `tournament.test.js` was added to `npm test` and CI to lock this.

**Deploy tripwire — LOCAL ONLY, do NOT push before 2026-07-19.** A live 12-person league
is running on the *deployed* version right now. This refactor (and every other change
merged during this window) was merged **locally only** and must not reach the public URL
until AFTER the Final (2026-07-19, per PLAN.md). A mid-tournament deploy risks changing
draft-order output under a live league. No push until the tournament is over.

**Downstream.** The staged queue specs 70/75/80/85 build ON this profile layer (they add
further profiles / profile-driven behaviour). They assume `engine.js` reads structure
from `ruleset` and that new tournaments are data, not engine edits — don't collapse the
layer back into the engine.
