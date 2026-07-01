# PLAN.md — World Cup Fantasy Draft Order Tool (build handoff)

> Planning artifact. `claude.md` in this folder is the **canonical ruleset + spec** —
> read it first, this doc never overrides it. This file captures the agreed
> architecture, the researched 2026 fixture skeleton, and the phased build order so a
> fresh session can start Phase 1 cold. Planning was done 2026-06-30.

## Status: planning complete, no code written yet. Start at Phase 1.

The tournament is **live now** (Round of 32 in progress; R16 starts July 4 2026), so
the real fixture data below is current and time-sensitive — build with urgency.

---

## Confirmed decisions (from planning Q&A)

1. **Standalone repo + GitHub Pages.** This folder becomes its own git repo / GitHub
   repo, deployed via Pages. (Folder will be relocated out of the fantasy-football
   repo before building.)
2. **Bake in the real official schedule** (captured below) as the default editable
   fixture skeleton. Admin can still edit any of it.
3. **Firebase deferred to Phase 2.** Phase 1 runs entirely on local placeholder data
   — no Firebase account needed to start.
4. **Store = Firebase Realtime Database** (confirmed; not Firestore/Supabase).

---

## Architecture — vanilla ES modules, no build step

A small file set, not one giant file, to honor the spec's DATA / LOGIC / PRESENTATION
separation. Served over http (GitHub Pages); for local dev run `python3 -m http.server`
(ES modules block `file://`).

```
index.html   shell + <script type="module" src="app.js">
styles.css   all styling; dark-mode via CSS custom properties
data.js      EDITABLE DATA: bracket topology + fixture skeleton + placeholders (the one marked place)
engine.js    PURE LOGIC: ruleset -> draft order. No DOM, no Firebase. Importable under Node for tests.
store.js     Firebase boundary: realtime read subscribe + auth-gated admin writes. ONLY file that knows Firebase.
app.js       PRESENTATION: views, hash routing, renders engine output. Never re-implements ruleset logic.
engine.test.js   Node-runnable invariant harness (see below).
```

`store.js` is also the **clean score-input boundary** the spec wants for the v2
live-score API: swapping manual entry for an API later should touch only this file.

---

## Compute engine design (the heart — get this exactly right)

### Bands, best -> worst
`ALIVE` (undetermined) -> `CHAMPION` -> `RUNNER_UP` -> `THIRD` -> `FOURTH` ->
`QF_LOSERS` -> `R16_LOSERS`

- A team stays in `ALIVE` until a result eliminates it, then drops into its band by
  **where it lost**.
- The two loser bands sort internally by **match GD desc -> match GF desc ->
  tiebreak number asc**. Tiebreaks only ever compare teams in the *same* band.
- **Pens = draw:** eliminated team's match GD/GF use end-of-ET score, so a pens-loser
  has GD 0 and outranks any regulation loser (GD <= -1) in its band.
- **No gaps:** rank all 16, filter to the 12 assigned, number 1..12. Unassigned teams
  in higher bands let lower bands slide up automatically. If the actual champion was
  unassigned, the best-finishing *assigned* team is pick 1.

### Locking — derived from which rounds are fully final
The real primitive: a band's picks lock once (a) its internal order is fully
determined AND (b) the **count of assigned teams in all higher bands is frozen**.
A lower band can therefore lock *before* a higher one (e.g. all 4 QFs final locks the
QF-loser band even before the Final, because all 4 QF winners finish above the whole
band regardless of how SF/Final shake out). Chronologically this reads bottom-up
since R16 matches finish first. Verified equivalent to claude.md's four bullets:

| Band | Locks when |
|---|---|
| Champion / Runner-up | Final is final |
| 3rd / 4th | 3rd-place game final (implies SFs final) |
| QF-loser band | all 4 QFs final |
| R16-loser band | all 8 R16s final |

### Three modes, one function
Engine takes the match set with a per-match settled (final) vs provisional
(in-progress) flag.
- **Order** computed from settled + provisional -> the PROJECTED ("if scores hold")
  order.
- **Locked flags** computed from settled-only -> the LOCKED order.
- **Hypothetical** mode: caller passes imagined matches all marked final; lock flags
  ignored; never reads/writes the live store.
- A still-tied in-progress knockout match can't project a loser -> both teams stay
  `ALIVE` (honest "undetermined"); don't fabricate an eliminee.

### Invariant test harness (engine.test.js, runs under Node)
Treat as the definition of "done":
1. No gaps (1..12 contiguous, unassigned skipped).
2. Band-local tiebreaks only.
3. Pens = draw (GD/GF ignore shootout).
4. Deterministic (same inputs -> identical output).
5. Locked stability — **fuzz test**: lock a pick, then replay every permutation of
   remaining results and assert that pick never moves.

---

## Data model (all editable data in data.js, mirrored to the Firebase tree in Phase 2)

- **members** `{id, name, teamId, tiebreakNumber}` x12 — seed the 12 real names
  below; `teamId` and `tiebreakNumber` stay null until the draw (Phase 2 reveal).
  List order = last season's final standings; it's display order only and does NOT
  feed the engine. Assignments + the distinct 1–12 tiebreak numbers come from the
  random.org draw, entered in admin. "Commish" = Dylan (admin), matching the fantasy
  app naming.

  | # | Member | | # | Member |
  |---|---|---|---|---|
  | 1 | Nathan | | 7 | Tyler |
  | 2 | James | | 8 | Andrew |
  | 3 | Lance | | 9 | Erik |
  | 4 | Volkan | | 10 | Kyle |
  | 5 | Sally | | 11 | Josh |
  | 6 | Jake | | 12 | Commish |
- **teams** — the 16 R16 teams `{id, code, name, flagEmoji}`; 4 flagged unassigned.
- **matches** `{id, round, slot, teamA, teamB, datetimeISO, venue, status, scoreA,
  scoreB, decidedByPens, penWinner}`. status in {scheduled, in_progress, final}.
- **bracket topology** — static wiring so a final result auto-feeds the next slot
  (see table below).
- **meta** `{rulesLockedDate, lastUpdated}`.

---

## 2026 World Cup knockout fixture skeleton (researched 2026-06-30)

Store as explicit ISO datetimes with venue UTC offset (EDT = -04:00, CDT = -05:00,
PDT = -07:00). **Verify the two Mexico City entries** — source labeled them EDT but
Mexico City is UTC-6 and does not observe DST; admin can edit. Some R16 teams already
known (Canada, Morocco, Paraguay, Brazil); rest are "Winner Match NN" until R32
resolves.

### Round of 16
| Match | Date 2026 | Kickoff (local) | Venue | Feeds from |
|---|---|---|---|---|
| 89 | Jul 4 | 3:00 PM EDT | Philadelphia | W79 v W80 |
| 90 | Jul 4 | 6:00 PM CDT | Houston | Canada v Morocco |
| 91 | Jul 5 | 3:00 PM EDT | Mexico City | W81 v W82 |
| 92 | Jul 5 | 6:00 PM EDT | Mexico City | W83 v W84 |
| 93 | Jul 6 | 3:00 PM CDT | Seattle | W85 v W87 |
| 94 | Jul 6 | 6:00 PM CDT | Arlington | W86 v W88 |
| 95 | Jul 7 | 3:00 PM PDT | Vancouver | Paraguay v W77 |
| 96 | Jul 7 | 6:00 PM PDT | Vancouver | Brazil v W78 |

### Quarterfinals
| Match | Date 2026 | Kickoff (local) | Venue | Feeds from |
|---|---|---|---|---|
| 97 | Jul 9 | 8:00 PM EDT | Foxborough | W89 v W90 |
| 98 | Jul 10 | 8:00 PM PDT | Inglewood | W93 v W94 |
| 99 | Jul 11 | 3:00 PM EDT | Miami Gardens | W91 v W92 |
| 100 | Jul 11 | 6:00 PM CDT | Kansas City | W95 v W96 |

### Semifinals
| Match | Date 2026 | Kickoff (local) | Venue | Feeds from |
|---|---|---|---|---|
| 101 | Jul 14 | 8:00 PM CDT | Arlington | W97 v W98 |
| 102 | Jul 15 | 8:00 PM EDT | Atlanta | W99 v W100 |

### Third-place & Final
| Match | Date 2026 | Kickoff (local) | Venue | Feeds from |
|---|---|---|---|---|
| 3rd | Jul 18 | 3:00 PM EDT | Miami Gardens | L101 v L102 |
| Final | Jul 19 | 8:00 PM EDT | East Rutherford | W101 v W102 |

### Bracket wiring (for auto-populate)
- QF97 = W89 v W90 · QF98 = W93 v W94 · QF99 = W91 v W92 · QF100 = W95 v W96
- SF101 = W97 v W98 · SF102 = W99 v W100
- Final = W101 v W102 · 3rd place = L101 v L102

---

## Phased build order (check in between phases)

1. **Engine + data + basic order view** from FINAL results only, against placeholder
   assignments + the invariant harness. No Firebase.
2. **Firebase wired** (live read subscribe) + admin entry (`#admin`) + locked-vs-
   projected "if scores hold" view + "last updated" stamp.
3. **Bracket + schedule + countdown + "find my team"** personalization.
4. **What-if explorer + iMessage (plain-text) generator + education/FAQ** (worked
   tiebreaker example, finish->pick diagram).
5. **Polish:** lock/reveal animations, dark mode, final-locks celebration, trust
   stamps (random.org note, rules-locked date, public tiebreak numbers).

---

## Firebase setup (Phase 2 — Dylan's console steps)

1. console.firebase.google.com -> Add project.
2. Build -> **Realtime Database** -> Create -> region -> start locked.
3. **Authentication** -> enable **Email/Password** -> add one admin user -> copy its **UID**.
4. Rules:
   ```json
   { "rules": { ".read": true, ".write": "auth != null && auth.uid === 'YOUR_ADMIN_UID'" } }
   ```
5. Project settings -> Add Web App -> copy `firebaseConfig` into `store.js`
   (not a secret; safe to commit).

---

## First steps for the new session
1. `git init` this folder as a standalone repo.
2. Read `claude.md` (ruleset) then this file.
3. Build Phase 1: `engine.js` + `data.js` (bake the fixture skeleton above) +
   `engine.test.js` + a basic order view in `index.html`/`app.js`. Run the harness,
   confirm all 5 invariants, then check in before Phase 2.
