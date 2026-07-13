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

---

## 2026-07-12 — Profile contract validator + uniform `tools/validate` entrypoint

**What changed.** Added `tournament-validate.js` (`validateProfile`) — a pure check that a
profile's `ruleset` satisfies the things `engine.js` silently ASSUMES: `ALIVE` is the first
band, every band a round names actually exists, a `provisional` round's losers get upgraded
by a later round, `lockNeeds` only names genuinely-earlier rounds, and `tiebreakMax` covers
the whole roster. Also added `tools/validate`, a shell entrypoint that runs the node test
files directly.

**Why.** This is the safety net UNDER the profile layer (see the entry above). Break one of
those ruleset assumptions and the symptom is subtle runtime weirdness — a team stuck in the
wrong band, picks that never lock, tiebreak numbers out of range — never a clear error. That
is exactly the failure a non-expert adding a new profile can't diagnose, so the validator
turns the assumptions into an explicit contract that fails LOUDLY. It backs the promise the
`new-tournament` skill makes: "new tournament = add one profile file."

**Honest limit.** The check is STRUCTURAL — the ruleset carries no bracket topology (that
lives in `seed`), so the provisional-upgrade check relies on `rounds` being written in
chronological order. It catches a provisional round with nothing after it; it is not a full
bracket verifier.

**Watch: two validation lists that can drift.** `tools/validate` runs FOUR suites
(`engine`, `tournament`, `poller`, `tournament-validate`) because some agent sessions can't
invoke `npm` but `node` always works — it is the fuller superset. `npm test` currently runs
only the first three (it omits `tournament-validate.test.js`). Keep them in sync when you
touch either; `tools/validate` is the authoritative "all green" gate.
