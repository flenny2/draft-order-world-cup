---
name: new-tournament
description: Checklist for adding a tournament to the draft-order app once the profile architecture is merged — profile file, theme block, validation, namespacing check, tests, docs. Use when Dylan says "add the Euros/women's World Cup/new tournament" or "set up the 2027 deployment". Has hard STOP points; never touches live Firebase.
---

# New Tournament — profile checklist with STOP points

End state per the architecture review: launching a new tournament = write one
profile file, flip `activeProfile`, validate, test, deploy to a fresh URL + fresh
DB root. This skill is the path there, with STOPs where the live 2026 record is
at risk.

## STOP gate 0 — is the architecture even merged?

```bash
ls tournament.js && grep -n "activeProfile" tournament.js
```

If `tournament.js` doesn't exist on the current branch, the
`auto/10-wc-tournament-profile-*` refactor hasn't merged — **STOP**, nothing below
applies. Also confirm which tournament is live: during a live tournament (2026 WC
through ~Jul 19) all of this stays local and unpushed.

## Workflow

1. **Read, in order:** lowercase `claude.md` (canonical ruleset — NOT auto-loaded
   on Linux, so read it explicitly), `tournament.js` (the profile shape + the
   `demo4` worked example), and
   `meta-fable-supervisor/reports/fable-review-world-cup.md` §1 (profile contract,
   Euros worked example, the gaps list).

2. **Write the profile** (a JS module — JSON was explicitly rejected; comments are
   load-bearing): `{ id, name, ruleset, labels, copy, seed, theme }` where
   `ruleset` = `bands` (ordered — array order IS band rank), `tiebreakBands`,
   `rounds` (round → winner/loser band, `provisional` flag), `lockNeeds`,
   `tiebreakMax`. Comment the *why* on every non-obvious rule (the SF_LOSERS
   ranking rationale, lockNeeds choices). Euros reference shape: no 3rd-place game
   ⇒ `SF_LOSERS` as a real 2-team tiebreak band, `rounds.SF` NOT provisional,
   `lockNeeds.SF_LOSERS = ['R16','QF','SF']`.

3. **Theme block** per the design package
   (`meta-fable-supervisor/design-packages/world-cup/` — read
   `theming-architecture.md` + `direction-spec.md` §2; the two mockup HTML files
   carry worked value sets): `theme.day`/`theme.night` revalue existing custom
   properties, `theme.bands` keyed by THIS profile's band ids, `theme.rails` per
   round id, `theme.foilStrike`, `theme.assets`. Rules: **revalue, never re-role**
   (gold = prize, coral = live/eliminated, green = alive — always); type and layout
   are untouchable; contrast pairs must pass AA (≥4.5:1 text, ≥3:1 large) in both
   day and night. Note the §4 groundwork dependency: the hardcoded rung/rail/foil
   hexes must already be promoted to `:root` tokens, or theming has nothing to hook.

4. **Validate the profile.**
   ```bash
   node -e "import('./tournament.js').then(m => console.log(m.validateProfile(m.<profile>)))"
   ```
   If `validateProfile()` doesn't exist yet (queue candidate 75), check the
   contract manually and say you did: `bands[0] === 'ALIVE'`; every band named in
   `rounds`/`lockNeeds`/`tiebreakBands` exists in `bands`; provisional rounds have
   a later round upgrading their losers; `lockNeeds` lists genuinely-earlier rounds.

5. **STOP gate — store namespacing (the live-2026-record landmine).** Check whether
   `store.js` derives its DB root from `profile.id`:
   ```bash
   grep -n "tournaments/\|profile.id\|ref(" store.js | head
   ```
   If store paths are still fixed, a second profile pointed at them **destroys the
   live 2026 league record** ("Reset to blank seed... wipes everything"). **HARD
   STOP** — the profile may exist and be tested, but it must not become
   `activeProfile` in any deployed/served copy until namespacing lands (staged spec
   85-wc has the design doc). Tell Dylan exactly this.

6. **Tests.** Non-interactive shells need nvm's node on PATH
   (`$HOME/.nvm/versions/node/<ver>/bin`).
   ```bash
   npm test          # engine + tournament + poller suites
   node simulate.js  # fairness Monte Carlo + fuzz
   ```
   Add profile-specific tests in `tournament.test.js` following the `demo4`
   pattern: band ranking, tiebreak fires inside the new band(s), locking on the
   profile's `lockNeeds`, and absence of bands the tournament doesn't have. Any
   engine change (e.g. two-legged ties) re-verifies all five compute invariants,
   especially pens=draw — but engine changes are NOT part of this checklist; STOP
   and ask.

7. **Docs entry.** Add/extend the README "Adding a tournament" section with this
   profile as the example; fix any claims that drift (the review caught "app.js
   consumes labels" advertised before it was true — don't repeat that).

8. **Deployment is Dylan's, entirely.** New tournament = new deployment + new DB
   root, not a runtime switcher. Hand Dylan the checklist: fresh Pages target,
   fresh Firebase root, poller `integrations` block (network + secrets — supervised),
   favicon/og-card regenerated from `theme.assets`.

## Hard limits

- **Never run the app or admin flows against live Firebase; never touch "Reset to
  blank seed".** The league's live record outranks any code.
- **Never push to main** — a push IS a production deploy to 12 leaguemates. Local
  commits only; deploy timing is Dylan's call.
- **Never edit `claude.md` §THE RULESET** — code conforms to it, never the reverse.
- **Never let a second profile write to the men's-WC DB paths** (step 5 gate).
- Never "tidy" `mensWorldCupRuleset` values, band order, or lockNeeds — array order
  is behavior. Never add a build step or framework.
- Never touch poller credentials, GH Secrets, or Firebase console settings.
