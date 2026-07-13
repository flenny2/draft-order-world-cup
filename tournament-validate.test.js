// =============================================================================
// tournament-validate.test.js — profile CONTRACT checks.
// Run: `node tournament-validate.test.js`. Exits non-zero on any failure.
// =============================================================================
// Two jobs, mirroring tournament.test.js:
//  1. Both SHIPPED profiles (men's-WC-2026 and demo4) are well-formed — validateProfile
//     returns no issues. This is a regression guard: if a real profile drifts out of
//     contract, this fails.
//  2. A batch of deliberately MALFORMED profiles each trips the specific contract check
//     it violates — so the validator actually protects the engine's silent assumptions,
//     not just the happy path.
// =============================================================================

import { validateProfile } from './tournament-validate.js';
import { mensWorldCup2026, demo4 } from './tournament.js';

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ' — ' + detail : ''}`);
}
const errorsOf = (p) => validateProfile(p).filter((i) => i.level === 'error');
const flags = (p, re) => errorsOf(p).some((i) => re.test(i.msg));

// --- 1. Both shipped profiles are well-formed -------------------------------
for (const p of [mensWorldCup2026, demo4]) {
  const issues = validateProfile(p);
  check(`shipped: ${p.id} passes validateProfile with no issues`,
    issues.length === 0, JSON.stringify(issues));
}

// --- 2. Malformed profiles: each contract break is flagged ------------------
// Deep-clone a shipped profile so each mutation is isolated. structuredClone is
// built into Node; the profiles are plain data (no functions), so it's safe.
const clone = (p) => structuredClone(p);

// (a) ALIVE not first — the load-bearing band-order literal.
const noAliveFirst = clone(demo4);
noAliveFirst.ruleset.bands = ['CHAMPION', 'ALIVE', 'RUNNER_UP', 'SF_LOSER', 'THIRD', 'FOURTH'];
check('malformed: ALIVE not first is flagged',
  flags(noAliveFirst, /First band must be 'ALIVE'/), JSON.stringify(errorsOf(noAliveFirst)));

// (b) A round references a band that isn't in `bands`.
const missingBand = clone(demo4);
missingBand.ruleset.rounds.Final.winner = 'GRAND_CHAMPION'; // not in bands
check('malformed: round names a band absent from `bands` is flagged',
  flags(missingBand, /Round 'Final' winner band 'GRAND_CHAMPION' is not in `bands`/),
  JSON.stringify(errorsOf(missingBand)));

// (c) lockNeeds names a round that is NOT earlier than the band's own round.
// FOURTH is decided at '3rd'; making it wait on 'Final' (later) means it never locks.
const lockNeedsLater = clone(demo4);
lockNeedsLater.ruleset.lockNeeds.FOURTH = ['SF', '3rd', 'Final'];
check('malformed: lockNeeds naming a LATER round than the band is flagged',
  flags(lockNeedsLater, /lockNeeds\['FOURTH'\] names round 'Final', which is LATER/),
  JSON.stringify(errorsOf(lockNeedsLater)));

// (d) A provisional round with NO later round to upgrade its losers.
const orphanProvisional = {
  id: 'bad-prov',
  ruleset: {
    bands: ['ALIVE', 'SF_LOSER'],
    tiebreakBands: [],
    rounds: { SF: { loser: 'SF_LOSER', provisional: true } }, // nothing after it
    lockNeeds: {},
    tiebreakMax: 4,
  },
  seed: { members: [] },
};
check('malformed: provisional round with no upgrading later round is flagged',
  flags(orphanProvisional, /Round 'SF' is provisional .* no later round upgrades/),
  JSON.stringify(errorsOf(orphanProvisional)));

// (e) tiebreakMax smaller than the roster — some members can't get a distinct number.
const tiebreakTooSmall = clone(demo4); // 4-member roster
tiebreakTooSmall.ruleset.tiebreakMax = 3;
check('malformed: tiebreakMax below the roster size is flagged',
  flags(tiebreakTooSmall, /tiebreakMax \(3\) is smaller than the 4-member roster/),
  JSON.stringify(errorsOf(tiebreakTooSmall)));

// (f) Bonus sixth: tiebreakBand not in `bands` (the same "referenced band exists"
// contract, but on the tiebreakBands list rather than a round).
const badTiebreakBand = clone(demo4);
badTiebreakBand.ruleset.tiebreakBands = ['NOT_A_BAND'];
check('malformed: tiebreakBand absent from `bands` is flagged',
  flags(badTiebreakBand, /tiebreakBand 'NOT_A_BAND' is not in `bands`/),
  JSON.stringify(errorsOf(badTiebreakBand)));

// --- report -----------------------------------------------------------------
if (failures.length) {
  console.error(`\n✗ tournament-validate.test.js: ${failures.length} failure(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`✓ tournament-validate.test.js: ${passed} checks passed (shipped profiles well-formed; 6 malformed profiles flagged).`);
