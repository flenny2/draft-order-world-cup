<!-- ===========================================================================
CLAUDE.md — World Cup Fantasy Draft Order Tool  ·  read every session
status: LIVE — a 12-person league is running on the DEPLOYED build right now
deploy-hold: DO NOT PUSH before 2026-07-19 (the Final). All work this window is
             merged LOCAL-ONLY; a mid-tournament deploy can change live draft
             output. See DECISIONS.md "Deploy tripwire".
architecture: profile-driven — engine.js (pure LOGIC) reads a `ruleset` from
              tournament.js (DATA); app.js is PRESENTATION. File map: README.md.
canonical: THE RULESET section below is the spec; code conforms to it, not the
           reverse.
updated: 2026-07-13
=========================================================================== -->

# CLAUDE.md — World Cup Fantasy Draft Order Tool

> ⚠️ **DEPLOY HOLD — no push before 2026-07-19.** A live 12-person league is on the
> deployed build. Every change this window is merged **local-only**; a mid-tournament
> deploy could change draft-order output under a running league. (The unattended queue
> runner never pushes anyway.) The hold lifts after the Final — then the planned
> generalization push (women's WC / Euros / UCL profiles) can go out.

## What this is
A shareable, mobile-first web tool that ties a 12-person fantasy league's draft
order to the 2026 World Cup knockout stage. It explains the system to leaguemates,
shows the draft order updating live as the tournament plays out, and lets me (the
admin) enter results from my phone so everyone sees changes in real time.

The tool lives through four phases; the home screen should adapt to whichever is
active: (1) Pre-draw — rules + hype, all placeholders; (2) The draw — teams assigned
to members; (3) Tournament live — matches resolve, picks lock bottom-up, daily use;
(4) Final — order locked, page becomes a record/recap.

---

## Current state — what's built (2026-07-13)
The app is fully built and deployed; the sections below still read as the *spec* the
code implements, but nothing here is greenfield anymore. Full file map: `README.md`.

- **Profile-driven engine (the big architectural shift).** `engine.js` no longer
  hard-codes the men's 2026 WC — it takes a `ruleset` (defaulting to the men's WC) and
  stays pure LOGIC. All tournament STRUCTURE (finish bands + order, round→band map, lock
  dependencies, tiebreak range) lives in `tournament.js` as a *profile*; `data.js` is
  just the men's-WC seed. This is what makes "add the women's WC / Euros / UCL" a new
  profile, not an engine edit. Rationale + guardrails: `DECISIONS.md` (2026-07-07) and
  the `new-tournament` skill. **Naming trap:** `profiles.js` is unrelated sticker-card
  facts; `tournament.js` is the tournament CONFIG — keep them separate.
- **Profile contract validator.** `tournament-validate.js` (`validateProfile`) checks a
  profile against the engine's silent assumptions so a malformed profile fails loudly,
  not subtly. See `DECISIONS.md` (2026-07-12).
- **Realtime store — built.** Firebase Realtime DB behind `store.js` (the only file that
  knows Firebase); public read, admin-UID-gated writes. Config in code is not a secret.
- **iMessage league-update generator — built.** `report.js`, pure plain-text, diffs
  against a baseline snapshot for "what changed since last update".
- **July UI passes (all LIVE).** Sticker cards v2 (flip cards: team profile front /
  league-history back, the knockout run rendered live from `state.matches`) +
  share-preview card (`og-card.png`); the **Matchday Wire** (neutral, news-only match
  feed — only prints real changes); programme-tab nav + iOS fixes; Results-first admin;
  Bracket wall-chart; Schedule ticket rail; What-if pools coupon; Help-as-programme;
  the show-don't-tell prose trims.
- **Finale pass (Jul-18, LOCAL-ONLY — commit `d7854b5`).** LOCKED picks darken their WHOLE
  plate (was: number block only) — pure CSS off the engine's `locked` flag, so the
  3rd-place score darkens picks 3–4 by itself and the Final's score darkens 1–2; pick 1
  exempt so the finished #1 shines in foil. When all 12 picks lock (phase `final`), the
  Order page celebrates: finale plaque (champions line from the Final MATCH, not
  `picks[0]` — the champion can be undrawn) + foil confetti auto-fired once per device
  (`wcdraft.finaleSeen.v1`), trophy tap = encore. Taste forks banked in `TODOS.md` §finale.
- **Live-scores poller — Phase A only (dry-run).** `scripts/poller.mjs` + the `poller.yml`
  workflow map football-data's LIVE / EXTRA_TIME / PENALTY_SHOOTOUT statuses but **do not
  write to the live store** — this is the v2 auto-fetch sitting *behind the score-input
  boundary* (see Scope). Design + rollout: `AUTOMATION.md`, `PHASE-B-RUNBOOK.md`. (Those
  docs reference Firebase JSON paths like `automation/enabled` — data paths, not files.)
- **Validation.** `tools/validate` is the uniform entrypoint (runs the node test files
  directly, since some sessions can't invoke `npm`). See `DECISIONS.md` (2026-07-12).

---

## THE RULESET — canonical source of truth
This is the spec. The compute engine must implement it exactly. If any code
conflicts with this section, this section wins. If anything here is ambiguous,
ask before coding — do not guess.

### Pool & assignment
1. The 2026 World Cup is 48 teams: group stage → Round of 32 → Round of 16 (R16)
   → Quarterfinals (QF) → Semifinals → Final, plus a 3rd-place playoff. Our system
   starts at the **R16**, where 16 teams remain.
2. All 16 R16 teams go into a draw. Each of the 12 league members is randomly
   assigned exactly one team. The draw is done externally on random.org and entered
   by me. The 4 unassigned teams are out of play.
3. Only the 12 assigned teams are ever ranked.

### Draft order
4. A member's draft pick = how far their assigned team advances. Best finish =
   pick 1, earliest elimination = pick 12.
5. Finish order, best to worst:
   Champion → Runner-up → 3rd-place-game winner → 3rd-place-game loser →
   the 4 QF losers (a band) → the 8 R16 losers (a band).
6. The top 4 finishes are each decided by a single match (the Final and the
   3rd-place game), so they can never tie.

### Tiebreakers
7. Tiebreakers apply ONLY within the two loser bands (QF losers, R16 losers).
   Within a band, order assigned teams by:
   1. Goal difference in that team's elimination match
   2. Goals scored in that match
   3. The team's tiebreak number (lower = better pick)
8. After the draw, the 12 assigned teams each get a **distinct** number 1–12.
   This is the final tiebreaker and, because the numbers are distinct, it always
   resolves cleanly.

### Penalty shootouts
9. A penalty-shootout result counts as a **draw**. The recorded score is the score
   at the end of extra time; the shootout only determines who advances.
10. Therefore GD and GF for that match come from the end-of-ET score, NOT the
    shootout. A team eliminated on penalties has match GD 0, ranking it ahead of a
    team that lost in regulation (GD ≤ −1). Implement this carefully — it's the
    most error-prone rule.

---

## COMPUTE ENGINE — pure, central, the heart of the app
One pure module: data in (assignments + tiebreak numbers + all matches) → draft
order out. No DOM access inside it. Presentation reads its output and never
re-implements ruleset logic. The engine runs in THREE modes:

1. **LOCKED** — order from FINAL match results only, with a per-pick "locked" flag
   meaning that exact pick cannot change under ANY remaining or in-progress result.
2. **PROJECTED ("if scores hold")** — final results PLUS current in-progress scores
   treated as if final, clearly labeled provisional. Teams in not-yet-started
   matches remain "still alive / undetermined."
3. **HYPOTHETICAL** — for the what-if explorer; user-supplied imagined results.
   Never reads from or writes to the live store.

### Locking rule (the subtle part — get this exactly right)
- Champion & Runner-up picks lock when the Final is final.
- 3rd & 4th picks lock when the 3rd-place game is final.
- The QF-loser band's picks lock when ALL four QF matches are final (every QF loser
  and its match stats known, so the band is fully ranked).
- The R16-loser band's picks lock when ALL eight R16 matches are final.
- Account for unassigned teams shifting pick numbers when deciding lockedness.
A locked pick must NEVER move as later or in-progress scores change.

## COMPUTE INVARIANTS — treat as the test suite; verify each before "done"
- **No gaps.** Unassigned teams are skipped and never create holes in the 1–12
  order. Pick numbers come from ordering only the drawn teams and numbering them
  1..12, so if a higher-band team is unassigned, lower bands slide up. If the actual
  champion was unassigned, the best-finishing *assigned* team takes pick 1.
- **Band-local tiebreaks.** A tiebreaker comparison only ever happens between two
  assigned teams in the *same* band (QF or R16). Never across bands.
- **Pens = draw.** Match GD/GF ignore the shootout (rules 9–10).
- **Deterministic.** Same assignments + tiebreak numbers + results → identical
  output. No hidden randomness in the compute path.
- **Locked stability.** A locked pick is stable under any future or in-progress
  result.
When you add or change engine logic, state which invariant(s) it touches and how
you verified them.

---

## Data & sync — tiny free hosted realtime store
Source of truth is a free hosted realtime store so I can update from my phone and
all viewers see it live with no redeploy.
- **Store:** Firebase Realtime Database (recommended — generous free tier, realtime
  listeners, works from vanilla JS via the modular CDN SDK, no build step). Propose
  an alternative in planning only with a one-sentence trade-off.
- **Access:** reads PUBLIC (all data is meant to be seen); writes AUTH-GATED via
  security rules — not to stop leaguemates, but because an open-write internet DB
  gets found and wiped by bots. One admin account (email/password); rule allows
  writes only from that admin UID.
- The Firebase web config in client code is NOT a secret — security comes from the
  rules, so committing it is fine.
- Clients subscribe with realtime listeners so order, bracket, and scores update
  without a refresh. Show a "last updated" timestamp.

### Data model (editable config + live store) — keep ALL editable data in ONE marked place
- **Members:** 12 slots — name/nickname + assigned team + tiebreak number. Start as
  editable PLACEHOLDERS (real names entered later). Show the 4 unassigned teams.
- **Matches:** round (R16/QF/SF/Final/3rd), bracket slot, the two teams
  (nullable/TBD until known), date-time, status (scheduled / in-progress / final),
  scoreA, scoreB, decidedByPens (bool), penWinner (optional).
- **Bracket topology:** encode the fixed WC knockout wiring so a final result
  auto-populates the winner into the next round's slot (less admin typing, fewer
  errors). Later-round matchups show TBD until fed.

---

## Live behavior
As scores come in, viewers see (a) locked picks and (b) the "if it stands" projected
order updating live. Bonus per-match insight on a match card, e.g. "this result
would move [member] to pick 4."

## Admin & league-update output
- **Phone-first** (I enter results from work on my phone). A hash route like `#admin`
  is fine for the UI; real protection is the store's auth-gated writes.
- Enter/edit: the 12 assignments + tiebreak numbers; each match's teams, date-time,
  status, score, pens toggle. Mark in-progress (live score) or final (locks).
- Edit/undo any result; live preview of exactly what the public view shows; a reset.
- **iMessage update generator:** outputs PLAIN TEXT, no markdown (it's pasted into a
  group chat) — current order, what changed since last update, what's still in
  contention, plus the link.

---

## Scope
**In v1:** the hosted realtime store; manual live scores + the projected "if scores
hold" order; schedule + "next match" countdown; the what-if explorer; personalization
("find my team", remember-me via localStorage — fine on a deployed static site).

**Out of v1 (note as future, do NOT build):**
- **Live-score API auto-fetch** — the planned v2. Build the score-input as a clean
  boundary so it drops in later touching ONLY the score-input layer (engine, store
  schema, and UI unchanged).
- User accounts beyond the single admin; concurrent multi-person editing.

---

## Tech & architecture
- **Vanilla HTML/CSS/JS, no build step** — single file or a minimal set. This is for
  shareability and one-link hosting, **not a complexity ceiling.**
- **Write production-quality code at whatever sophistication the problem warrants.**
  Keep it clean, well-named, and commented on non-obvious lines so it stays readable.
  If a small framework is genuinely warranted, propose it in planning with a
  one-sentence trade-off; default is vanilla.
- **Strict separation: DATA / LOGIC / PRESENTATION.** Pure engine (no DOM access);
  all editable data in one clearly-marked place; presentation never re-implements
  ruleset logic.
- **Hosting:** one stable public URL (GitHub Pages or Netlify, free static). The
  realtime store keeps it current without redeploys.

## Code conventions
- Clean, well-named variables and functions; optimize for readability.
- Brief comments on non-obvious lines only — don't over-comment obvious code, but
  never leave tricky logic (esp. the pens/GD handling and locking) unexplained.
- When fixing a bug, explain what went wrong and why the fix works, not just the fix.
- Multiple valid approaches → give the trade-off in one sentence, pick the simpler
  one unless I say otherwise.
- Keep the ruleset logic centralized — if I tweak a rule later, one obvious place
  to change it.

## Workflow
- **Plan before coding.** For any non-trivial task, propose the approach/options
  first; proceed after I confirm. Small obvious tasks, just do them.
- **Ask when ambiguous** rather than assuming — especially on ruleset details.
- **Build in phases, simplest working version first**, checking in between (the
  kickoff prompt holds the detailed phase plan): engine + basic order view →
  realtime store + admin + locked-vs-projected view → bracket + schedule +
  personalization → what-if explorer + iMessage generator + education → polish.
- Read and follow this file every session. If a request conflicts with the ruleset
  above, flag it before proceeding.
