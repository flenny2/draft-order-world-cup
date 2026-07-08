// =============================================================================
// tournament-validate.js — profile CONTRACT check (pure)
// =============================================================================
// The engine (engine.js) silently ASSUMES a profile's ruleset is well-formed:
// ALIVE is the first band, every band it names actually exists, a `provisional`
// round's losers get upgraded by a later round, `lockNeeds` only names genuinely-
// earlier rounds, and `tiebreakMax` covers the whole roster. Break one of these
// and the symptom is subtle runtime weirdness — a team stuck in the wrong band,
// picks that never lock, tiebreak numbers that fall out of range — NOT a clear
// error. That is exactly the failure mode a non-expert can't diagnose.
//
// validateProfile turns those assumptions into an explicit, machine-checkable
// contract so "new tournament = add one profile file" (see the new-tournament
// skill) is safe: a malformed profile fails LOUDLY here instead of misbehaving in
// the app.
//
// PURE: no DOM, no clock, no Firebase, no network. Mirrors engine.validate()'s
// shape — returns [{ level, msg }], empty when the profile is well-formed. All
// contract breaks are 'error'; 'warn' flags a probable-but-not-fatal mistake.
//
// HONEST LIMIT: the ruleset carries no bracket TOPOLOGY (that lives in `seed`), so
// the provisional-upgrade check is STRUCTURAL — it relies on `rounds` being written
// in chronological order (as both shipped profiles are) and cannot trace which
// round a given team actually plays next. It catches the profile bug it's meant to
// (a provisional round with nothing after it); it is not a full bracket verifier.
// =============================================================================

// Validate a whole PROFILE ({ ruleset, seed, ... }) against the contract the engine
// assumes. Returns [{ level, msg }] (empty = well-formed). Pure — safe to call from
// anywhere, including a test harness or the admin UI.
export function validateProfile(profile) {
  const issues = [];
  const err = (msg) => issues.push({ level: 'error', msg });

  const ruleset = profile?.ruleset;
  if (!ruleset || typeof ruleset !== 'object') {
    err('Profile has no `ruleset` object.');
    return issues; // nothing else is checkable without it
  }
  const { bands, rounds, lockNeeds, tiebreakBands, tiebreakMax } = ruleset;

  // --- shape guards -----------------------------------------------------------
  // Bail on anything not the right TYPE first, so every contract check below can
  // assume well-typed collections and never trips over undefined/null.
  if (!Array.isArray(bands) || bands.length === 0) { err('`bands` must be a non-empty array (best → worst).'); return issues; }
  if (!rounds || typeof rounds !== 'object') { err('`rounds` must be an object keyed by round id.'); return issues; }
  if (!lockNeeds || typeof lockNeeds !== 'object') { err('`lockNeeds` must be an object keyed by band.'); return issues; }
  if (!Array.isArray(tiebreakBands)) { err('`tiebreakBands` must be an array of band names.'); return issues; }

  const bandSet = new Set(bands);
  const roundKeys = Object.keys(rounds);
  // Insertion order of `rounds` IS chronological order by convention (both shipped
  // profiles write R16 → QF → SF → 3rd → Final). Checks 3 and 4 lean on this.
  const roundIndex = new Map(roundKeys.map((r, i) => [r, i]));

  // 1. ALIVE must be the FIRST band. The engine seeds every team 'ALIVE' and
  //    derives band RANK from array position; a still-alive team must sort to the
  //    very top because it can still finish anywhere up to champion. Load-bearing
  //    literal (engine.js) — protect it explicitly.
  if (bands[0] !== 'ALIVE') err(`First band must be 'ALIVE' (a still-alive team must sort to the top); got '${bands[0]}'.`);
  if (bandSet.size !== bands.length) err('`bands` has a duplicate — each finish band must be listed exactly once.');

  // 2. Every band NAMED anywhere must exist in `bands`. The engine looks up rank
  //    by band name; a name absent from `bands` has rank `undefined`, which makes
  //    the ranking comparator produce NaN and silently mis-order picks.
  for (const [r, cfg] of Object.entries(rounds)) {
    for (const side of ['winner', 'loser']) {
      const b = cfg?.[side];
      if (b != null && !bandSet.has(b)) err(`Round '${r}' ${side} band '${b}' is not in \`bands\`.`);
    }
  }
  for (const b of tiebreakBands) if (!bandSet.has(b)) err(`tiebreakBand '${b}' is not in \`bands\`.`);
  for (const b of Object.keys(lockNeeds)) if (!bandSet.has(b)) err(`lockNeeds band '${b}' is not in \`bands\`.`);

  // Every ROUND named inside lockNeeds must be a real round too (a typo'd round id
  // would just never be "decided", so the band would never lock).
  for (const [b, needs] of Object.entries(lockNeeds)) {
    if (!Array.isArray(needs)) { err(`lockNeeds['${b}'] must be an array of round ids.`); continue; }
    for (const r of needs) if (!roundIndex.has(r)) err(`lockNeeds['${b}'] names round '${r}', which is not in \`rounds\`.`);
  }

  // Reverse map: which round DECIDES each finish band (as its winner or loser).
  // Used by checks 3 and 4. In a bracket a band is decided by one round, so first
  // writer wins if a profile mistakenly assigns the same band twice.
  const assigningRound = new Map();
  for (const [r, cfg] of Object.entries(rounds)) {
    for (const side of ['winner', 'loser']) {
      const b = cfg?.[side];
      if (b != null && !assigningRound.has(b)) assigningRound.set(b, r);
    }
  }

  // 3. A `provisional` round's loser plays AGAIN (e.g. an SF loser contests the
  //    3rd-place game), so a LATER round must give those losers their real finish.
  //    The engine's provisional guard (don't clobber a THIRD/FOURTH already set)
  //    only means anything if such a later round exists. Structural heuristic (no
  //    topology in the ruleset): a provisional round must not be the last round.
  //    A tournament with no 3rd-place game (e.g. the Euros) should simply leave its
  //    SF NON-provisional — then this check doesn't apply.
  for (const [r, cfg] of Object.entries(rounds)) {
    if (!cfg?.provisional) continue;
    if (cfg.loser == null) { err(`Round '${r}' is provisional but assigns no \`loser\` band — provisional applies to the loser.`); continue; }
    const idx = roundIndex.get(r);
    const hasLater = roundKeys.some((k) => roundIndex.get(k) > idx);
    if (!hasLater) err(`Round '${r}' is provisional (its loser plays again) but no later round upgrades those losers.`);
  }

  // 4. lockNeeds must list only genuinely-EARLIER rounds (plus the band's own).
  //    A band decided at round R can't wait on a round LATER than R to lock — that
  //    later round would never be a prerequisite, so listing it means the band
  //    never locks. Allow the band's own round (index ≤ own); flag anything after.
  for (const [b, needs] of Object.entries(lockNeeds)) {
    if (!Array.isArray(needs)) continue; // already flagged in check 2
    const own = assigningRound.get(b);
    if (own == null) continue; // band decided by no round — its absence is caught in check 2
    const ownIdx = roundIndex.get(own);
    for (const r of needs) {
      const ri = roundIndex.get(r);
      if (ri != null && ri > ownIdx) err(`lockNeeds['${b}'] names round '${r}', which is LATER than the round ('${own}') that decides '${b}' — it would never lock.`);
    }
  }

  // 5. tiebreakMax must cover the whole ROSTER, not just currently-assigned members.
  //    Numbers span a distinct 1..tiebreakMax, one per team; once the draw runs every
  //    member is assigned, so tiebreakMax below the roster size guarantees out-of-
  //    range numbers. (The shipped men's-WC seed has 12 members still `teamId: null`
  //    pre-draw, so we size against the roster count, not the assigned count.)
  if (typeof tiebreakMax !== 'number' || tiebreakMax < 1) {
    err('`tiebreakMax` must be a positive number.');
  } else if (Array.isArray(profile?.seed?.members)) {
    const roster = profile.seed.members.length;
    if (roster > tiebreakMax) err(`tiebreakMax (${tiebreakMax}) is smaller than the ${roster}-member roster — some members can't get a distinct 1..${tiebreakMax} number.`);
  }

  return issues;
}
