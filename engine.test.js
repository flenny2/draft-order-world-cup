// =============================================================================
// engine.test.js — invariant harness. Run: `node engine.test.js` (or `npm test`).
// =============================================================================
// Treats claude.md §COMPUTE INVARIANTS as the test suite. Five invariants:
//   1. No gaps              4. Deterministic
//   2. Band-local tiebreaks 5. Locked stability (seeded fuzz)
//   3. Pens = draw
// Self-contained scenarios (does not depend on data.js) so the engine is tested
// in isolation. Exits non-zero on any failure.
// =============================================================================

import { computeDraftOrder, classifyTeams, getUnassignedTeams, resolveBracket, matchWinnerLoser, validate } from './engine.js';
import { kickoffMs, nextMatch, countdown, groupByDay } from './schedule.js';
import { snapshot, formatUpdate } from './report.js';

// --- tiny assertion framework ---------------------------------------------
let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// --- builders --------------------------------------------------------------
const T = Array.from({ length: 16 }, (_, i) => ({ id: `t${i + 1}`, code: `T${i + 1}`, name: `Team ${i + 1}`, flagEmoji: '⚽' }));

// m('89','R16','t1','t2', {a:2,b:0})           → final 2-0
// m('89','R16','t1','t2', {a:0,b:0,pens:'t1'}) → final, pens, t1 advances (score is the ET draw)
// m('89','R16','t1','t2', {a:1,b:0,inProgress:true}) → live
// m('89','R16','t1','t2', null)                → scheduled (TBD ok with null teams)
function m(id, round, teamA, teamB, res) {
  const base = { id, round, slot: id, teamA, teamB };
  if (!res) return { ...base, status: 'scheduled', scoreA: null, scoreB: null, decidedByPens: false, penWinner: null };
  const status = res.inProgress ? 'in_progress' : 'final';
  return { ...base, status, scoreA: res.a, scoreB: res.b, decidedByPens: !!res.pens, penWinner: res.pens || null };
}

// Build members from [teamId, tiebreakNumber] pairs; unlisted teams are unassigned.
function membersFrom(pairs) {
  return pairs.map(([teamId, tb], i) => ({ id: `mem${i + 1}`, name: `Member ${i + 1}`, teamId, tiebreakNumber: tb }));
}

// A fully-played 16-team tournament (fixed result) used by several invariants.
// Finish: champ t1, RU t5, 3rd t9, 4th t13; QF-losers t7(pens)>t3>t11>t15;
// R16-losers t6(pens)>t12>{t4,t10,t14}>t8>{t2,t16}.
function fullTournament() {
  return [
    m('89', 'R16', 't1', 't2', { a: 2, b: 0 }),
    m('90', 'R16', 't3', 't4', { a: 1, b: 0 }),
    m('91', 'R16', 't5', 't6', { a: 0, b: 0, pens: 't5' }), // pens → t6 GD0
    m('92', 'R16', 't7', 't8', { a: 3, b: 1 }),
    m('93', 'R16', 't9', 't10', { a: 1, b: 0 }),
    m('94', 'R16', 't11', 't12', { a: 2, b: 1 }),
    m('95', 'R16', 't13', 't14', { a: 1, b: 0 }),
    m('96', 'R16', 't15', 't16', { a: 2, b: 0 }),
    m('97', 'QF', 't1', 't3', { a: 2, b: 1 }),
    m('98', 'QF', 't9', 't11', { a: 1, b: 0 }),
    m('99', 'QF', 't5', 't7', { a: 0, b: 0, pens: 't5' }), // pens → t7 GD0 (tops QF band)
    m('100', 'QF', 't13', 't15', { a: 3, b: 0 }),
    m('101', 'SF', 't1', 't9', { a: 2, b: 0 }),
    m('102', 'SF', 't5', 't13', { a: 1, b: 0 }),
    m('final', 'Final', 't1', 't5', { a: 3, b: 1 }),
    m('3rd', '3rd', 't9', 't13', { a: 2, b: 1 }),
  ];
}

// ===========================================================================
// Invariant 1 — NO GAPS (unassigned teams skipped; champion-unassigned → best
// assigned is pick 1; lower bands slide up to fill).
// ===========================================================================
{
  const matches = fullTournament();
  // Leave champion t1, top-QF t7, 3rd-place t9, top-R16 t6 UNASSIGNED.
  const members = membersFrom([
    ['t5', 1], ['t13', 2], ['t3', 3], ['t11', 4], ['t15', 5], ['t2', 6],
    ['t4', 7], ['t8', 8], ['t10', 9], ['t12', 10], ['t14', 11], ['t16', 12],
  ]);
  const { picks } = computeDraftOrder({ teams: T, members, matches });

  check('1.no-gaps: 12 picks', picks.length === 12, `got ${picks.length}`);
  check('1.no-gaps: 1..12 contiguous', eq(picks.map((p) => p.pickNumber), [1,2,3,4,5,6,7,8,9,10,11,12]));
  check('1.no-gaps: champion unassigned → best assigned (RU t5) is pick 1', picks[0].team.id === 't5' && picks[0].band === 'RUNNER_UP', `pick1=${picks[0].team.id}/${picks[0].band}`);
  check('1.no-gaps: 4 teams unassigned', getUnassignedTeams(T, members).length === 4);
  // QF-loser band slides up over the unassigned 3rd-place team: t13(FOURTH) pick2, then t3(QFL).
  check('1.no-gaps: lower bands slide up (t13 FOURTH = pick 2)', picks[1].team.id === 't13' && picks[1].pickNumber === 2);
}

// ===========================================================================
// Invariant 2 — BAND-LOCAL TIEBREAKS ONLY (band rank dominates GD/GF across
// bands; GD→GF→number applies only within the same loser band).
// ===========================================================================
{
  // A QF loser with awful GD (-5) vs an R16 loser with perfect GD (0, pens).
  // Cross-band, GD would flip them; band rank must keep the QF loser ahead.
  const matches = [
    m('89', 'R16', 't1', 't2', { a: 0, b: 0, pens: 't1' }), // t2 R16L GD0 GF0 (great)
    m('90', 'R16', 't3', 't4', { a: 1, b: 0 }),             // t4 R16L GD-1 GF0
    m('91', 'R16', 't5', 't6', { a: 1, b: 0 }),
    m('92', 'R16', 't7', 't8', { a: 1, b: 0 }),
    m('93', 'R16', 't9', 't10', { a: 1, b: 0 }),
    m('94', 'R16', 't11', 't12', { a: 1, b: 0 }),
    m('95', 'R16', 't13', 't14', { a: 1, b: 0 }),
    m('96', 'R16', 't15', 't16', { a: 1, b: 0 }),
    // QF: t1 loses 0-5 → QFL GD-5 GF0 (awful); others normal.
    m('97', 'QF', 't1', 't3', { a: 0, b: 5 }),  // t1 QFL GD-5
    m('98', 'QF', 't9', 't11', { a: 1, b: 0 }), // t11 QFL GD-1 GF0
    m('99', 'QF', 't5', 't7', { a: 2, b: 1 }),  // t7 QFL GD-1 GF1
    m('100', 'QF', 't13', 't15', { a: 1, b: 0 }),// t15 QFL GD-1 GF0
  ];
  const members = membersFrom([
    ['t1', 1], ['t2', 2], ['t7', 3], ['t11', 4], ['t15', 5], ['t4', 6],
  ]);
  const { picks } = computeDraftOrder({ teams: T, members, matches });
  const bandOf = (id) => picks.find((p) => p.team.id === id);

  // t1 (QF loser, GD-5) must still outrank t2 (R16 loser, GD0): band beats GD.
  check('2.band-local: QF loser (GD-5) ranks above R16 loser (GD0)', bandOf('t1').pickNumber < bandOf('t2').pickNumber, `t1=${bandOf('t1').pickNumber} t2=${bandOf('t2').pickNumber}`);
  // Within the QF band, GD→GF→number: t7(GD-1,GF1) > t11(GD-1,GF0,tb4) > t15(GD-1,GF0,tb5) > t1(GD-5).
  const qf = picks.filter((p) => p.band === 'QF_LOSERS').map((p) => p.team.id);
  check('2.band-local: within QF band GD→GF→number', eq(qf, ['t7', 't11', 't15', 't1']), qf.join(','));
}

// ===========================================================================
// Invariant 3 — PENS = DRAW (match GD/GF use the end-of-ET score; the shootout
// only decides who advances).
// ===========================================================================
{
  const matches = [
    m('89', 'R16', 't1', 't2', { a: 1, b: 1, pens: 't1' }), // t2 lost on pens → GD0 GF1
    m('90', 'R16', 't3', 't4', { a: 2, b: 1 }),             // t4 lost in regulation → GD-1 GF1
    m('91', 'R16', 't5', 't6', { a: 1, b: 0 }),
    m('92', 'R16', 't7', 't8', { a: 1, b: 0 }),
    m('93', 'R16', 't9', 't10', { a: 1, b: 0 }),
    m('94', 'R16', 't11', 't12', { a: 1, b: 0 }),
    m('95', 'R16', 't13', 't14', { a: 1, b: 0 }),
    m('96', 'R16', 't15', 't16', { a: 1, b: 0 }),
  ];
  const bands = classifyTeams(T, matches, { includeProvisional: false });
  check('3.pens: pens-loser GD = 0 (not from shootout)', bands.get('t2').matchGD === 0 && bands.get('t2').matchGF === 1, JSON.stringify(bands.get('t2')));
  check('3.pens: regulation-loser GD = -1', bands.get('t4').matchGD === -1);
  check('3.pens: pen winner advanced (not in a loser band)', bands.get('t1').band === 'ALIVE');

  const members = membersFrom([['t2', 1], ['t4', 2]]);
  const { picks } = computeDraftOrder({ teams: T, members, matches });
  check('3.pens: pens-loser (GD0) ranks ahead of regulation-loser (GD-1)', picks[0].team.id === 't2', picks.map((p) => p.team.id).join(','));
}

// ===========================================================================
// Invariant 4 — DETERMINISTIC (same inputs, regardless of array order → identical
// output; no hidden randomness).
// ===========================================================================
{
  const matches = fullTournament();
  const members = membersFrom([
    ['t1', 5], ['t5', 11], ['t9', 2], ['t13', 8], ['t7', 1], ['t3', 9],
    ['t11', 4], ['t15', 12], ['t6', 3], ['t12', 7], ['t4', 6], ['t2', 10],
  ]);
  const a = computeDraftOrder({ teams: T, members, matches });
  const b = computeDraftOrder({ teams: T, members, matches });
  const shuffled = computeDraftOrder({
    teams: [...T].reverse(),
    members: [...members].reverse(),
    matches: [...matches].reverse(),
  });
  check('4.deterministic: same inputs → identical', eq(a, b));
  check('4.deterministic: reversed input arrays → identical', eq(a, shuffled));
}

// ===========================================================================
// Invariant 5 — LOCKED STABILITY (fuzz). Lock a band, then replay many random
// completions of the remaining results; every locked pick must keep the same
// (pickNumber → member). Seeded PRNG keeps the test itself deterministic.
// ===========================================================================
{
  // mulberry32 — small seeded PRNG, so fuzz is reproducible.
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

  // Play one knockout match: random decisive score, or a pens draw (~30%).
  function playMatch(id, round, a, b, r) {
    if (r() < 0.3) { const w = r() < 0.5 ? a : b; const g = Math.floor(r() * 3); return m(id, round, a, b, { a: g, b: g, pens: w }); }
    const winnerIsA = r() < 0.5;
    const lg = Math.floor(r() * 2), wg = lg + 1 + Math.floor(r() * 2);
    return winnerIsA ? m(id, round, a, b, { a: wg, b: lg }) : m(id, round, a, b, { a: lg, b: wg });
  }
  const loserOf = (mm) => (mm.decidedByPens ? (mm.penWinner === mm.teamA ? mm.teamB : mm.teamA) : (mm.scoreA > mm.scoreB ? mm.teamB : mm.teamA));
  const winnerOf = (mm) => (mm.decidedByPens ? mm.penWinner : (mm.scoreA > mm.scoreB ? mm.teamA : mm.teamB));

  // Fixed R16 results (all final): winners are the odd-indexed teams.
  function r16() {
    return [
      m('89', 'R16', 't1', 't2', { a: 2, b: 0 }),
      m('90', 'R16', 't3', 't4', { a: 1, b: 0 }),
      m('91', 'R16', 't5', 't6', { a: 0, b: 0, pens: 't5' }),
      m('92', 'R16', 't7', 't8', { a: 3, b: 1 }),
      m('93', 'R16', 't9', 't10', { a: 1, b: 0 }),
      m('94', 'R16', 't11', 't12', { a: 2, b: 1 }),
      m('95', 'R16', 't13', 't14', { a: 1, b: 0 }),
      m('96', 'R16', 't15', 't16', { a: 2, b: 0 }),
    ];
  }
  // Random completion of QF→Final from a given (final) QF or R16 base, honoring topology.
  function randomComplete(base, r) {
    const byId = (id) => base.find((x) => x.id === id);
    const w = (id) => winnerOf(byId(id));
    const out = [...base];
    function ensureQF() {
      if (byId('97')) return; // QF already present
      out.push(playMatch('97', 'QF', w('89'), w('90'), r));
      out.push(playMatch('98', 'QF', w('93'), w('94'), r));
      out.push(playMatch('99', 'QF', w('91'), w('92'), r));
      out.push(playMatch('100', 'QF', w('95'), w('96'), r));
    }
    ensureQF();
    const q = (id) => out.find((x) => x.id === id);
    out.push(playMatch('101', 'SF', winnerOf(q('97')), winnerOf(q('98')), r));
    out.push(playMatch('102', 'SF', winnerOf(q('99')), winnerOf(q('100')), r));
    const sf1 = out.find((x) => x.id === '101'), sf2 = out.find((x) => x.id === '102');
    out.push(playMatch('final', 'Final', winnerOf(sf1), winnerOf(sf2), r));
    out.push(playMatch('3rd', '3rd', loserOf(sf1), loserOf(sf2), r));
    return out;
  }

  // Assignment used throughout the fuzz (all 16 teams to keep bands full of members).
  const members16 = membersFrom(T.map((t, i) => [t.id, i + 1]));
  // Snapshot only the LOCKED picks as memberId→pickNumber.
  function lockedMap(matches) {
    const { picks } = computeDraftOrder({ teams: T, members: members16, matches });
    const map = {};
    for (const p of picks) if (p.locked) map[p.member.id] = p.pickNumber;
    return map;
  }

  const r = rng(20260630);

  // (a) R16 fully final → R16-loser band must be locked and immovable.
  const baseR16 = r16();
  const lockedR16 = lockedMap(baseR16);
  check('5.locked: R16 band locks once all R16 final (8 locked picks)', Object.keys(lockedR16).length === 8, `got ${Object.keys(lockedR16).length}`);
  let stableA = true, movedA = '';
  for (let i = 0; i < 400; i++) {
    const after = lockedMap(randomComplete(r16(), r));
    for (const id of Object.keys(lockedR16)) if (after[id] !== lockedR16[id]) { stableA = false; movedA = `${id}: ${lockedR16[id]}→${after[id]}`; }
  }
  check('5.locked: R16-loser picks stable under 400 random completions', stableA, movedA);

  // (b) R16 + QF final → QF-loser band also locks; stable under SF/3rd/Final fuzz.
  // Build one fixed QF-complete base, then fuzz only SF onward.
  const baseQF = (() => {
    const b = r16();
    const w = (id) => winnerOf(b.find((x) => x.id === id));
    b.push(m('97', 'QF', w('89'), w('90'), { a: 2, b: 1 }));
    b.push(m('98', 'QF', w('93'), w('94'), { a: 1, b: 0 }));
    b.push(m('99', 'QF', w('91'), w('92'), { a: 0, b: 0, pens: w('91') }));
    b.push(m('100', 'QF', w('95'), w('96'), { a: 3, b: 0 }));
    return b;
  })();
  const lockedQF = lockedMap(baseQF);
  check('5.locked: R16+QF final → 12 locked picks (8 R16 + 4 QF)', Object.keys(lockedQF).length === 12, `got ${Object.keys(lockedQF).length}`);
  let stableB = true, movedB = '';
  for (let i = 0; i < 400; i++) {
    const after = lockedMap(randomComplete(baseQF, r));
    for (const id of Object.keys(lockedQF)) if (after[id] !== lockedQF[id]) { stableB = false; movedB = `${id}: ${lockedQF[id]}→${after[id]}`; }
  }
  check('5.locked: QF-loser picks stable under 400 random SF/3rd/Final completions', stableB, movedB);

  // (c) Locked picks must also survive an IN-PROGRESS (projected) future, not just finals.
  let stableC = true;
  for (let i = 0; i < 100; i++) {
    const completed = randomComplete(r16(), r);
    const liveQF = completed.map((mm) => (mm.round === 'QF' ? { ...mm, status: 'in_progress' } : mm));
    const after = lockedMap(liveQF);
    for (const id of Object.keys(lockedR16)) if (after[id] !== lockedR16[id]) stableC = false;
  }
  check('5.locked: R16-loser picks stable even with QF shown in-progress (projected)', stableC);
}

// ===========================================================================
// Regressions — 2026-07-01 audit.
// R1: an SF loser is guaranteed 3rd or 4th, so it must rank BELOW the finalists
//     (not float ALIVE at the top) — otherwise a champ/RU pick "locked" by the
//     Final gets displaced when the 3rd-place game is entered later. Locking
//     must also require the EARLIER rounds to be decided (out-of-order entry).
// R3: a pens match without both end-of-ET scores is undetermined — the old code
//     computed the loser's GD from null arithmetic (GD +1 topped the band).
// ===========================================================================
{
  const members = membersFrom(T.map((t, i) => [t.id, i + 1]));
  const at = (result, id) => result.picks.find((p) => p.team.id === id);

  // Final entered, 3rd-place game NOT yet played (admin backfills it later).
  const pre3rd = fullTournament().map((x) => (x.id === '3rd' ? m('3rd', '3rd', 't9', 't13', null) : x));
  const before = computeDraftOrder({ teams: T, members, matches: pre3rd });
  check('R1.SF losers rank below the finalists (champion = pick 1)',
    at(before, 't1').pickNumber === 1 && at(before, 't5').pickNumber === 2,
    `t1=${at(before, 't1').pickNumber} t5=${at(before, 't5').pickNumber}`);
  check('R1.champ/RU locked once the Final (and earlier rounds) are decided',
    at(before, 't1').locked && at(before, 't5').locked);
  check('R1.SF losers banded SF_LOSER at picks 3-4, never locked',
    at(before, 't9').band === 'SF_LOSER' && at(before, 't9').pickNumber === 3
    && at(before, 't13').pickNumber === 4 && !at(before, 't9').locked && !at(before, 't13').locked,
    `t9=${at(before, 't9').band}/${at(before, 't9').pickNumber}`);
  // Backfill the 3rd-place game: every pick that was locked must stay put.
  const after = computeDraftOrder({ teams: T, members, matches: fullTournament() });
  const moved = before.picks.filter((p) => p.locked)
    .filter((p) => after.picks.find((q) => q.member.id === p.member.id).pickNumber !== p.pickNumber);
  check('R1.locked picks unmoved by the late 3rd-place result', moved.length === 0,
    moved.map((p) => `${p.member.id}@${p.pickNumber}`).join(','));

  // Out-of-order entry: Final decided while a QF is missing → champ can't lock
  // (the undecided QF's teams still rank above it and will drop below on resolve).
  const holed = fullTournament().map((x) => (x.id === '98' ? m('98', 'QF', 't9', 't11', null) : x));
  const h = computeDraftOrder({ teams: T, members, matches: holed });
  check('R1.champ not locked while an earlier round is undecided', !at(h, 't1').locked);
  check('R1.R16-loser band still locks independently of the hole', at(h, 't2').locked);
}
{
  const half = [
    m('89', 'R16', 't1', 't2', { a: 1, b: null, pens: 't2' }), // scoreB forgotten
    m('90', 'R16', 't3', 't4', { a: 0, b: 0, pens: 't3' }),    // legit pens loser t4, GD 0
    m('91', 'R16', 't5', 't6', { a: 1, b: 0 }),
    m('92', 'R16', 't7', 't8', { a: 1, b: 0 }),
    m('93', 'R16', 't9', 't10', { a: 1, b: 0 }),
    m('94', 'R16', 't11', 't12', { a: 1, b: 0 }),
    m('95', 'R16', 't13', 't14', { a: 1, b: 0 }),
    m('96', 'R16', 't15', 't16', { a: 2, b: 0 }),
  ];
  const bands = classifyTeams(T, half, { includeProvisional: false });
  check('R3.pens without both scores decides nothing (teams stay ALIVE)',
    bands.get('t1').band === 'ALIVE' && bands.get('t2').band === 'ALIVE',
    `${bands.get('t1').band}/${bands.get('t2').band}`);
  check('R3.no bracket advancement without the ET score', matchWinnerLoser(half[0]) === null);
  const { picks } = computeDraftOrder({ teams: T, members: membersFrom([['t1', 1], ['t4', 2]]), matches: half });
  check('R3.half-entered pens gets no GD (never outranks a real pens loser)',
    picks.find((p) => p.team.id === 't1').matchGD === null,
    `GD=${picks.find((p) => p.team.id === 't1').matchGD}`);
  check('R3.a round with an undetermined "final" never locks', picks.every((p) => !p.locked));
  check('R3.validate flags the missing pens score as an error',
    validate({ members: [], matches: [half[0]] }).some((i) => i.level === 'error'));
}

// ===========================================================================
// Phase-2 helpers — auto-populate (resolveBracket) and validation. These guard
// the admin write path; they don't replace the 5 invariants above.
// ===========================================================================
{
  const topology = {
    '97':    { teamA: { from: 'winner', match: '89' }, teamB: { from: 'winner', match: '90' } },
    '101':   { teamA: { from: 'winner', match: '97' }, teamB: { from: 'winner', match: '98' } },
    'final': { teamA: { from: 'winner', match: '101' }, teamB: { from: 'winner', match: '102' } },
    '3rd':   { teamA: { from: 'loser',  match: '101' }, teamB: { from: 'loser',  match: '102' } },
  };
  // Winner of a pens game advances by penWinner, NOT score (which is the ET draw).
  const ms = [
    m('89', 'R16', 't1', 't2', { a: 0, b: 0, pens: 't2' }), // t2 advances on pens
    m('90', 'R16', 't3', 't4', { a: 2, b: 1 }),             // t3 advances
    m('97', 'QF', null, null, null),                        // empty — should be filled
    m('98', 'QF', 't5', 't6', { a: 1, b: 0 }),              // t5 won (98 not in topology here)
    m('101', 'SF', null, null, null),
    m('102', 'SF', null, null, null),
    m('final', 'Final', null, null, null),
    m('3rd', '3rd', null, null, null),
  ];
  const r = resolveBracket(ms, topology);
  const slot = (id, side) => r.find((x) => x.id === id)[side];
  check('auto: pens winner advances (t2, not the ET score) into QF', slot('97', 'teamA') === 't2', `got ${slot('97', 'teamA')}`);
  check('auto: regulation winner advances (t3) into QF', slot('97', 'teamB') === 't3');
  check('auto: scores are never touched by resolveBracket', r.find((x) => x.id === '89').scoreA === 0 && r.find((x) => x.id === '90').scoreB === 1);
  check('auto: slot stays TBD while its source SF is unplayed', slot('final', 'teamA') === null);
  check('auto: matchWinnerLoser ignores in-progress', matchWinnerLoser(m('x', 'QF', 't1', 't2', { a: 1, b: 0, inProgress: true })) === null);

  // editing an upstream result re-opens everything downstream (QF97 → TBD again)
  const ms2 = ms.map((x) => (x.id === '89' ? m('89', 'R16', 't1', 't2', null) : x));
  const r2 = resolveBracket(ms2, topology);
  check('auto: clearing an upstream result re-opens the downstream slot', r2.find((x) => x.id === '97').teamA === null);
}
{
  const v = (members, matches) => validate({ members, matches }).map((i) => i.level);
  check('validate: duplicate tiebreak numbers → error',
    v(membersFrom([['t1', 3], ['t2', 3]]), []).includes('error'));
  check('validate: pens with a non-draw score → error',
    v([], [m('89', 'R16', 't1', 't2', { a: 2, b: 1, pens: 't1' })]).includes('error'));
  check('validate: clean data → no issues',
    validate({ members: membersFrom([['t1', 1], ['t2', 2]]), matches: [m('89', 'R16', 't1', 't2', { a: 1, b: 0 })] }).length === 0);
}

// ===========================================================================
// Phase-3 helpers — schedule.js (pure, `now` passed explicitly).
// ===========================================================================
{
  const sched = (id, status, iso) => ({ id, round: 'R16', status, datetimeISO: iso, teamA: 't1', teamB: 't2', scoreA: null, scoreB: null, decidedByPens: false });
  const NOW = Date.parse('2026-07-04T12:00:00-04:00');

  check('sched: kickoffMs parses offset ISO', kickoffMs(sched('a', 'scheduled', '2026-07-04T15:00:00-04:00')) === Date.parse('2026-07-04T15:00:00-04:00'));
  check('sched: kickoffMs null when no time', kickoffMs(sched('a', 'scheduled', null)) === null);

  const list = [
    sched('89', 'final', '2026-07-04T10:00:00-04:00'),
    sched('90', 'scheduled', '2026-07-04T18:00:00-04:00'),
    sched('91', 'scheduled', '2026-07-04T15:00:00-04:00'),
  ];
  check('sched: nextMatch = soonest future non-final', nextMatch(list, NOW).id === '91');
  check('sched: live match wins', nextMatch([...list, sched('92', 'in_progress', null)], NOW).id === '92');
  check('sched: all final → null', nextMatch([sched('89', 'final', '2026-07-04T10:00:00-04:00')], NOW) === null);

  const c = countdown(NOW + (86400 + 3600 + 60 + 1) * 1000, NOW);
  check('sched: countdown splits d/h/m/s', c.days === 1 && c.hours === 1 && c.mins === 1 && c.secs === 1 && !c.past);
  check('sched: countdown past flag', countdown(NOW - 1000, NOW).past === true);

  const { groups } = groupByDay(list);
  check('sched: groupByDay buckets same day & sorts', groups.length === 1 && groups[0].items.map((m) => m.id).join(',') === '89,91,90');
}

// ===========================================================================
// Phase-4 helpers — report.js (plain-text iMessage generator + diff).
// ===========================================================================
{
  const matches = fullTournament(); // fully played → all locked
  const members = membersFrom([
    ['t1', 1], ['t5', 2], ['t9', 3], ['t13', 4], ['t7', 5], ['t3', 6],
    ['t11', 7], ['t15', 8], ['t6', 9], ['t12', 10], ['t4', 11], ['t2', 12],
  ]);
  const state = { teams: T, members, matches };
  const NOW = Date.parse('2026-07-19T22:00:00-04:00');

  const snap = snapshot(state);
  check('report: snapshot has 12 rows with pick numbers', snap.length === 12 && snap[0].pick === 1);

  const txtNoBase = formatUpdate({ state, baseline: null, url: 'https://x.test', now: NOW });
  check('report: plain text (no markdown * or #)', !/[*#]/.test(txtNoBase), txtNoBase.split('\n')[0]);
  check('report: includes current order + link', txtNoBase.includes('CURRENT ORDER') && txtNoBase.includes('https://x.test'));
  check('report: all-final → "All 12 picks locked. Final!"', txtNoBase.includes('All 12 picks locked. Final!'));
  check('report: no diff section without a baseline', !txtNoBase.includes('SINCE LAST UPDATE'));

  // Diff: fabricate a baseline where t1's member was pick 5 → now pick 1 (up 4).
  const baseline = snap.map((s) => (s.memberId === snap[0].memberId ? { ...s, pick: 5, locked: false } : s));
  const txtDiff = formatUpdate({ state, baseline, url: '', now: NOW });
  check('report: diff detects a pick move', /pick 5 -> 1 \(up 4\)/.test(txtDiff), txtDiff);
}

// --- report ----------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log(`✅ ALL INVARIANTS PASS — ${passed} checks`);
  console.log('   1.no-gaps  2.band-local  3.pens=draw  4.deterministic  5.locked-stability');
} else {
  console.log(`❌ ${failures.length} FAILED, ${passed} passed:`);
  for (const f of failures) console.log(`   - ${f}`);
}
console.log('='.repeat(60));
process.exit(failures.length === 0 ? 0 : 1);
