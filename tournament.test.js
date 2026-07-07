// =============================================================================
// tournament.test.js — profile characterization + swap proof.
// Run: `node tournament.test.js` (or `npm test`). Exits non-zero on any failure.
// =============================================================================
// Two jobs:
//  1. CHARACTERIZATION — the men's-WC profile (the DEFAULT) reproduces the exact
//     structure the engine used to hard-code. This locks the extraction: if a
//     value drifts, this fails before engine.test.js even runs.
//  2. SWAP PROOF — a structurally different tournament (demo4: 4 teams, no
//     R16/QF, no GD tiebreak, tiebreakMax 4) runs through the SAME engine
//     functions with zero engine edits. Passing `ruleset` is the only difference.
// =============================================================================

import { computeDraftOrder, validate, BAND_RANK } from './engine.js';
import { mensWorldCup2026, demo4, activeProfile, defaultRuleset } from './tournament.js';

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ' — ' + detail : ''}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- 1. Characterization: the default profile == the old hard-coded structure
// The band ranking the engine exported before the refactor, verbatim. If the
// profile's band ORDER changes, ranks change, and every comparison shifts.
const HISTORIC_BAND_RANK = {
  ALIVE: 0, CHAMPION: 1, RUNNER_UP: 2, SF_LOSER: 3, THIRD: 4, FOURTH: 5, QF_LOSERS: 6, R16_LOSERS: 7,
};
check('char: BAND_RANK derived from default profile matches the old hard-coded object',
  eq(BAND_RANK, HISTORIC_BAND_RANK), JSON.stringify(BAND_RANK));
check('char: default ruleset is the active profile (men\'s WC)', defaultRuleset === activeProfile.ruleset);
check('char: men\'s WC rounds are exactly R16/QF/SF/3rd/Final',
  eq(Object.keys(defaultRuleset.rounds).sort(), ['3rd', 'Final', 'QF', 'R16', 'SF']));
check('char: men\'s WC tiebreak bands are the two loser bands',
  eq([...defaultRuleset.tiebreakBands].sort(), ['QF_LOSERS', 'R16_LOSERS']));
check('char: men\'s WC tiebreak range is 1..12', defaultRuleset.tiebreakMax === 12);
// The provisional flag (SF loser plays again) is what stops the 3rd-place upgrade
// being clobbered — a load-bearing structural fact, not cosmetic.
check('char: SF is the one provisional round', defaultRuleset.rounds.SF.provisional === true
  && !defaultRuleset.rounds.Final.provisional && !defaultRuleset.rounds['3rd'].provisional);

// --- 2. Swap proof: demo4 through the same engine ---------------------------
// A finished 4-team tournament (see tournament.js): A champ, C runner-up, B 3rd,
// D 4th. Same computeDraftOrder() call as the real app — only `ruleset` differs.
const d4 = computeDraftOrder({
  teams: demo4.seed.teams,
  members: demo4.seed.members,
  matches: demo4.seed.matches,
  ruleset: demo4.ruleset,
});
check('swap: demo4 draft order is A > C > B > D',
  eq(d4.picks.map((p) => p.team.id), ['A', 'C', 'B', 'D']), d4.picks.map((p) => p.team.id).join(','));
check('swap: demo4 bands are CHAMPION > RUNNER_UP > THIRD > FOURTH',
  eq(d4.picks.map((p) => p.band), ['CHAMPION', 'RUNNER_UP', 'THIRD', 'FOURTH']), d4.picks.map((p) => p.band).join(','));
check('swap: demo4 pick numbers are a gapless 1..4', eq(d4.picks.map((p) => p.pickNumber), [1, 2, 3, 4]));
// The whole demo4 tournament is final, so every pick must be locked — proving
// the profile's lockNeeds (SF+Final / SF+3rd) drives locking, not baked-in rounds.
check('swap: demo4 fully-played tournament locks all four picks',
  d4.picks.every((p) => p.locked), d4.picks.map((p) => `${p.team.id}:${p.locked}`).join(','));

// The band SET itself comes from the profile: demo4 has NO loser bands at all.
const demo4Bands = new Set(demo4.ruleset.bands);
check('swap: demo4 has no R16/QF loser bands (structure is profile-driven)',
  !demo4Bands.has('R16_LOSERS') && !demo4Bands.has('QF_LOSERS') && demo4.ruleset.tiebreakBands.length === 0);

// validate's range check follows the profile's tiebreakMax, not a constant 12.
const tooHighForDemo4 = { members: [{ id: 'x', name: 'X', teamId: 'A', tiebreakNumber: 5 }], matches: [] };
check('swap: tiebreak number 5 is out of range under demo4 (max 4)',
  validate({ ...tooHighForDemo4, ruleset: demo4.ruleset }).some((i) => /range 1–4/.test(i.msg)));
check('swap: the same number 5 is fine under the men\'s WC default (max 12)',
  !validate(tooHighForDemo4).some((i) => /range/.test(i.msg)));

// --- report ----------------------------------------------------------------
if (failures.length) {
  console.error(`\n✗ tournament.test.js: ${failures.length} failure(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`✓ tournament.test.js: ${passed} checks passed (profiles: ${mensWorldCup2026.id}, ${demo4.id}).`);
