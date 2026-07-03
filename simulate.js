// =============================================================================
// simulate.js — tournament simulations: tiebreak fairness + process robustness.
// Run: `node simulate.js [seed]` (or `npm run simulate`). Exits non-zero if any
// process-fuzz invariant fails, so it doubles as an extended stress test.
// =============================================================================
// PROBE 1 (fairness): play thousands of complete tournaments with a realistic
// knockout score model, random draws, and random tiebreak numbers. Measures how
// often the tiebreak NUMBER (not GD/GF) decides picks, and the systematic value
// of drawing a low number — the number is drawn once and reused for every tie,
// so #1 wins every tie it is ever in and #12 loses every one.
//
// PROBE 2 (process): fuzz realistic admin entry — matches entered in random
// dependency-respecting order (incl. Final before 3rd-place), random live
// scores shown mid-entry, and same-winner score corrections — asserting after
// every step that locked picks never move and locking is monotone.
//
// Pure Node; imports only the real engine + the real bracket wiring, so what
// is simulated is exactly what production computes.
// =============================================================================

import { computeDraftOrder, resolveBracket, validate } from './engine.js';
import { bracketTopology } from './data.js';

// --- seeded PRNG + helpers (mulberry32, same as the test harness) -----------
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(r, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Pick from [[value, weight], …] (weights sum to ~1).
function weighted(r, table) {
  let x = r();
  for (const [v, w] of table) { x -= w; if (x <= 0) return v; }
  return table[table.length - 1][0];
}

// --- score model (stated assumptions — tweak here) ---------------------------
// Roughly calibrated to modern World Cup knockout rounds: low scores dominate,
// about a quarter of games reach a shootout.
const P_PENS = 0.25;                                            // share of games decided on pens
const PENS_LEVEL = [[0, 0.42], [1, 0.40], [2, 0.14], [3, 0.04]]; // the end-of-ET draw, n–n
const LOSER_GOALS = [[0, 0.55], [1, 0.30], [2, 0.12], [3, 0.03]]; // decisive: loser's goals
const WIN_MARGIN = [[1, 0.58], [2, 0.27], [3, 0.10], [4, 0.05]];  // decisive: winning margin

// --- fixture skeleton (real match ids + real topology from data.js) ---------
const TEAM_IDS = Array.from({ length: 16 }, (_, i) => `t${i + 1}`);
const TEAMS = TEAM_IDS.map((id) => ({ id, code: id, name: id, flagEmoji: '' }));
const BLANK = { status: 'scheduled', scoreA: null, scoreB: null, decidedByPens: false, penWinner: null };
const R16_IDS = ['89', '90', '91', '92', '93', '94', '95', '96'];

function skeleton(r16Teams) { // r16Teams: 16 ids in slot order (teamA, teamB per match)
  const ms = R16_IDS.map((id, i) => ({ id, round: 'R16', teamA: r16Teams[2 * i], teamB: r16Teams[2 * i + 1], ...BLANK }));
  for (const id of ['97', '98', '99', '100']) ms.push({ id, round: 'QF', teamA: null, teamB: null, ...BLANK });
  for (const id of ['101', '102']) ms.push({ id, round: 'SF', teamA: null, teamB: null, ...BLANK });
  ms.push({ id: '3rd', round: '3rd', teamA: null, teamB: null, ...BLANK });
  ms.push({ id: 'final', round: 'Final', teamA: null, teamB: null, ...BLANK });
  return ms;
}

function playResult(r, m) {
  if (r() < P_PENS) {
    const g = weighted(r, PENS_LEVEL);
    return { status: 'final', scoreA: g, scoreB: g, decidedByPens: true, penWinner: r() < 0.5 ? m.teamA : m.teamB };
  }
  const lg = weighted(r, LOSER_GOALS);
  const wg = lg + weighted(r, WIN_MARGIN);
  const aWins = r() < 0.5;
  return { status: 'final', scoreA: aWins ? wg : lg, scoreB: aWins ? lg : wg, decidedByPens: false, penWinner: null };
}

// A complete tournament, advanced round by round through the engine's own
// resolveBracket so the wiring is exactly production's.
function genTournament(r) {
  let ms = skeleton(shuffle(r, TEAM_IDS));
  for (const round of ['R16', 'QF', 'SF']) {
    ms = resolveBracket(ms, bracketTopology);
    ms = ms.map((m) => (m.round === round ? { ...m, ...playResult(r, m) } : m));
  }
  ms = resolveBracket(ms, bracketTopology); // feeds 3rd + Final from the SFs
  return ms.map((m) => (m.round === '3rd' || m.round === 'Final' ? { ...m, ...playResult(r, m) } : m));
}

// Random draw: 12 of the 16 teams assigned, distinct tiebreak numbers 1–12.
function genMembers(r) {
  const teams = shuffle(r, TEAM_IDS).slice(0, 12);
  const nums = shuffle(r, Array.from({ length: 12 }, (_, i) => i + 1));
  return teams.map((teamId, i) => ({ id: `m${String(i + 1).padStart(2, '0')}`, name: `M${i + 1}`, teamId, tiebreakNumber: nums[i] }));
}

// =============================================================================
// PROBE 1 — tiebreak fairness
// =============================================================================
function fairnessProbe(sims, r) {
  const sumPick = Array(13).fill(0);
  const top4 = Array(13).fill(0);
  let tieSims = 0, tiedMembers = 0, pensInvSims = 0;
  const tiedByBand = { QF_LOSERS: 0, R16_LOSERS: 0 };
  let maxTie = { size: 0, band: '', gd: 0, gf: 0 };

  for (let s = 0; s < sims; s++) {
    const { picks } = computeDraftOrder({ teams: TEAMS, members: genMembers(r), matches: genTournament(r) });
    let simTied = false, simPensInv = false;
    for (const band of ['QF_LOSERS', 'R16_LOSERS']) {
      const inBand = picks.filter((p) => p.band === band);
      const groups = new Map(); // same GD+GF ⇒ exact picks decided by the number
      for (const p of inBand) {
        const k = `${p.matchGD}|${p.matchGF}`;
        groups.set(k, (groups.get(k) ?? 0) + 1);
      }
      for (const [k, n] of groups) {
        if (n < 2) continue;
        simTied = true;
        tiedMembers += n;
        tiedByBand[band] += n;
        if (n > maxTie.size) { const [gd, gf] = k.split('|').map(Number); maxTie = { size: n, band, gd, gf }; }
      }
      // A shootout loser (GD 0) outranking a regulation loser who scored 2+ —
      // correct per the ruleset, but the kind of ordering people question.
      if (inBand.some((p) => p.matchGD === 0) && inBand.some((p) => p.matchGD < 0 && p.matchGF >= 2)) simPensInv = true;
    }
    if (simTied) tieSims++;
    if (simPensInv) pensInvSims++;
    for (const p of picks) { sumPick[p.tiebreakNumber] += p.pickNumber; if (p.pickNumber <= 4) top4[p.tiebreakNumber]++; }
  }
  return { sims, sumPick, top4, tieSims, tiedMembers, tiedByBand, maxTie, pensInvSims };
}

// =============================================================================
// PROBE 2 — process fuzz
// =============================================================================
const FEEDERS = {}; // matchId → the matches that must be final before it can be entered
for (const [id, wiring] of Object.entries(bracketTopology))
  FEEDERS[id] = [wiring.teamA?.match, wiring.teamB?.match].filter(Boolean);

function lockedMap(matches, members) {
  const { picks } = computeDraftOrder({ teams: TEAMS, members, matches });
  const map = new Map();
  for (const p of picks) if (p.locked) map.set(p.member.id, p.pickNumber);
  return map;
}

// Enter one full tournament in a random dependency-respecting order (a match is
// enterable once its feeder matches are final — matching what the admin UI can
// actually produce, including Final-before-3rd). Randomly show matches live
// with junk provisional scores first. Assert after EVERY step: a pick locked
// earlier is still locked at the same number.
function forwardRun(r, run, failures) {
  const truth = genTournament(r);
  const members = genMembers(r);
  const truthById = new Map(truth.map((m) => [m.id, m]));
  let cur = skeleton(truth.filter((m) => m.round === 'R16').flatMap((m) => [m.teamA, m.teamB]));
  let prevLocked = new Map();

  const assertStable = (label, matches) => {
    const now = lockedMap(matches, members);
    for (const [mid, pick] of prevLocked) {
      if (!now.has(mid)) failures.push(`forward#${run} after ${label}: ${mid} lost its lock`);
      else if (now.get(mid) !== pick) failures.push(`forward#${run} after ${label}: locked ${mid} moved ${pick} -> ${now.get(mid)}`);
    }
    return now;
  };

  while (cur.some((m) => m.status !== 'final')) {
    const isFinal = (id) => cur.find((m) => m.id === id).status === 'final';
    const enterable = cur.filter((m) => m.status !== 'final' && (FEEDERS[m.id] ?? []).every(isFinal));
    const M = enterable[Math.floor(r() * enterable.length)];
    if (r() < 0.35) { // show it live first — provisional scores must never move a lock
      const live = cur.map((m) => (m.id === M.id
        ? { ...m, status: 'in_progress', scoreA: Math.floor(r() * 4), scoreB: Math.floor(r() * 4) } : m));
      assertStable(`live ${M.id}`, resolveBracket(live, bracketTopology));
    }
    const t = truthById.get(M.id);
    cur = cur.map((m) => (m.id === M.id
      ? { ...m, status: 'final', scoreA: t.scoreA, scoreB: t.scoreB, decidedByPens: t.decidedByPens, penWinner: t.penWinner } : m));
    cur = resolveBracket(cur, bracketTopology); // exactly what store.setMatch does
    prevLocked = assertStable(`final ${M.id}`, cur);
  }
  if (prevLocked.size !== 12) failures.push(`forward#${run}: expected 12 locked picks at the end, got ${prevLocked.size}`);
}

// A same-winner score correction (the typo case: 2–1 was really 2–0) may only
// move picks inside the corrected match's loser band — every other pick,
// including everything below that band, must stay put.
function correctionRun(r, run, failures) {
  const truth = genTournament(r);
  const members = genMembers(r);
  const before = computeDraftOrder({ teams: TEAMS, members, matches: truth }).picks;

  const idx = Math.floor(r() * truth.length);
  const M = truth[idx];
  let fixed;
  if (M.decidedByPens) {
    const g = (M.scoreA + 1 + Math.floor(r() * 3)) % 4; // a different ET level, still a draw
    fixed = { ...M, scoreA: g, scoreB: g };
  } else {
    const aWon = M.scoreA > M.scoreB;
    const lg = Math.floor(r() * 3), wg = lg + 1 + Math.floor(r() * 3);
    fixed = { ...M, scoreA: aWon ? wg : lg, scoreB: aWon ? lg : wg };
  }
  const after = computeDraftOrder({ teams: TEAMS, members, matches: truth.map((m, i) => (i === idx ? fixed : m)) }).picks;

  const loserBand = M.round === 'R16' ? 'R16_LOSERS' : M.round === 'QF' ? 'QF_LOSERS' : null; // SF/3rd/Final: stats unused → nothing may move
  const beforeBy = new Map(before.map((p) => [p.member.id, p]));
  for (const p of after) {
    const b = beforeBy.get(p.member.id);
    if (b.pickNumber === p.pickNumber) continue;
    if (!(loserBand && b.band === loserBand && p.band === loserBand))
      failures.push(`correction#${run}: ${M.round} #${M.id} same-winner fix moved ${p.member.id} (${b.band} ${b.pickNumber} -> ${p.pickNumber})`);
  }
}

// validate() must flag every known bad-data pattern the admin could produce.
function validateProbe(failures) {
  const mk = (over) => ({ id: 'x', round: 'R16', teamA: 't1', teamB: 't2', status: 'final', scoreA: 1, scoreB: 0, decidedByPens: false, penWinner: null, ...over });
  const cases = [
    ['pens with a non-draw score', { matches: [mk({ decidedByPens: true, scoreA: 2, scoreB: 1, penWinner: 't1' })], members: [] }, 'error'],
    ['pens missing a score', { matches: [mk({ decidedByPens: true, scoreB: null, penWinner: 't2' })], members: [] }, 'error'],
    ['final tied without pens', { matches: [mk({ scoreA: 1, scoreB: 1 })], members: [] }, 'warn'],
    ['pens without a shootout winner', { matches: [mk({ decidedByPens: true, scoreA: 0, scoreB: 0 })], members: [] }, 'warn'],
    ['duplicate tiebreak numbers', { matches: [], members: [{ id: 'a', teamId: 't1', tiebreakNumber: 3 }, { id: 'b', teamId: 't2', tiebreakNumber: 3 }] }, 'error'],
    ['same team assigned twice', { matches: [], members: [{ id: 'a', teamId: 't1', tiebreakNumber: 1 }, { id: 'b', teamId: 't1', tiebreakNumber: 2 }] }, 'error'],
  ];
  for (const [name, input, level] of cases)
    if (!validate(input).some((i) => i.level === level)) failures.push(`validate: "${name}" not flagged as ${level}`);
}

// =============================================================================
// run + report
// =============================================================================
const seedArg = Number(process.argv[2]);
const SEED = Number.isFinite(seedArg) ? seedArg : 20260702;
const FAIRNESS_SIMS = 10000, FORWARD_RUNS = 1000, CORRECTION_RUNS = 500;

const r = rng(SEED);
const pct = (n, d) => `${(100 * n / d).toFixed(1)}%`;
const f = fairnessProbe(FAIRNESS_SIMS, r);

const failures = [];
for (let i = 0; i < FORWARD_RUNS && failures.length < 20; i++) forwardRun(r, i, failures);
for (let i = 0; i < CORRECTION_RUNS && failures.length < 20; i++) correctionRun(r, i, failures);
validateProbe(failures);

const meanPick = (tb) => f.sumPick[tb] / f.sims;
console.log('='.repeat(64));
console.log(`DRAFT-ORDER SIMULATION — seed ${SEED}`);
console.log(`${FAIRNESS_SIMS} tournaments · model: ${Math.round(P_PENS * 100)}% pens, low-scoring knockouts`);
console.log('='.repeat(64));
console.log('\nTIEBREAK-NUMBER IMPACT');
console.log(`  tournaments where the number decides >=1 pick:  ${pct(f.tieSims, f.sims)}`);
console.log(`  members in a number-decided tie, avg/tournament: ${(f.tiedMembers / f.sims).toFixed(2)}`);
console.log(`    R16-loser band: ${(f.tiedByBand.R16_LOSERS / f.sims).toFixed(2)}   QF-loser band: ${(f.tiedByBand.QF_LOSERS / f.sims).toFixed(2)}`);
console.log(`  largest tie seen: ${f.maxTie.size} teams (${f.maxTie.band}, GD ${f.maxTie.gd}, GF ${f.maxTie.gf})`);
console.log('\n  mean final pick by tiebreak number (lower = better):');
const row = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `#${from + i}: ${meanPick(from + i).toFixed(2)}`).join('  ');
console.log(`    ${row(1, 6)}`);
console.log(`    ${row(7, 12)}`);
console.log(`  expected cost of drawing #12 instead of #1: ${(meanPick(12) - meanPick(1)).toFixed(2)} pick positions`);
console.log(`  P(top-4 pick):  #1 ${pct(f.top4[1], f.sims)}   #12 ${pct(f.top4[12], f.sims)}`);
console.log('\nPENS QUIRK (correct per the ruleset, but worth a FAQ line)');
console.log(`  a shootout loser outranks a regulation loser who scored 2+: ${pct(f.pensInvSims, f.sims)} of tournaments`);
console.log('\nPROCESS FUZZ');
console.log(`  ${FORWARD_RUNS} random entry orders (live overlays incl.): lock stability checked after every step`);
console.log(`  ${CORRECTION_RUNS} same-winner score corrections: movement confined to the corrected band`);
console.log(`  validate(): 6 seeded bad-data patterns must be flagged`);
if (failures.length === 0) {
  console.log('  RESULT: no invariant violations ✅');
} else {
  console.log(`  RESULT: ${failures.length} VIOLATIONS ❌`);
  for (const x of failures.slice(0, 10)) console.log(`    - ${x}`);
}
console.log('='.repeat(64));
process.exit(failures.length === 0 ? 0 : 1);
