// =============================================================================
// poller.test.js — unit tests for the poller's pure planning functions.
// Run: `node poller.test.js`. No network, no DB — planCycle is pure by design.
// =============================================================================

import {
  mapStatus, teamIdFromApi, extractResult, orient, buildFixtureMap, planCycle,
} from './scripts/poller.mjs';
import { seed } from './data.js';

// --- tiny assertion framework (same shape as engine.test.js) ----------------
let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (x) => JSON.parse(JSON.stringify(x));

// --- builders ----------------------------------------------------------------
// API match in football-data.org v4 shape. Defaults: R16 match 89 (PAR–FRA
// with France at home, i.e. FLIPPED vs our teamA=PAR), scheduled, no score.
function api(over = {}) {
  return {
    id: 419001, stage: 'LAST_16', utcDate: '2026-07-04T21:00:00Z',
    status: 'TIMED',
    homeTeam: { tla: 'FRA', name: 'France' }, awayTeam: { tla: 'PAR', name: 'Paraguay' },
    score: { winner: null, duration: 'REGULAR', fullTime: { home: null, away: null } },
    ...over,
  };
}
function freshState() { return clone(seed); }
const NOW = Date.parse('2026-07-04T22:00:00Z'); // mid-match for game 89

// --- mapStatus ---------------------------------------------------------------
check('TIMED → scheduled', mapStatus('TIMED') === 'scheduled');
check('IN_PLAY → in_progress', mapStatus('IN_PLAY') === 'in_progress');
check('PAUSED → in_progress', mapStatus('PAUSED') === 'in_progress');
check('FINISHED → final', mapStatus('FINISHED') === 'final');
check('POSTPONED → null (never written)', mapStatus('POSTPONED') === null);

// --- teamIdFromApi -------------------------------------------------------------
check('TLA direct hit', teamIdFromApi({ tla: 'FRA', name: 'France' }) === 'FRA');
check('name fallback when TLA drifts', teamIdFromApi({ tla: 'XXX', name: 'Switzerland' }) === 'SUI');
check('United States alias', teamIdFromApi({ tla: 'ZZZ', name: 'United States' }) === 'USA');
check('TBD placeholder → null', teamIdFromApi({ tla: null, name: 'Winner Match 89' }) === null);

// --- extractResult -------------------------------------------------------------
{
  const r = extractResult(api({ status: 'FINISHED', score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 2, away: 0 } } }));
  check('regular final extracts score', r.home === 2 && r.away === 0 && !r.pens && r.problems.length === 0);
}
{
  const r = extractResult(api({ status: 'IN_PLAY', score: { winner: null, duration: 'REGULAR', fullTime: { home: 1, away: 0 } } }));
  check('live score extracts', r.home === 1 && r.away === 0 && r.status === 'in_progress');
}
{
  const r = extractResult(api({ status: 'IN_PLAY', score: { winner: null, duration: 'REGULAR', fullTime: { home: null, away: null } } }));
  check('live without score yet → nulls, no problem', r.home === null && r.problems.length === 0);
}
{ // clean pens shape: fullTime is the ET draw, penalties separate
  const r = extractResult(api({ status: 'FINISHED', score: { winner: 'AWAY_TEAM', duration: 'PENALTY_SHOOTOUT', fullTime: { home: 1, away: 1 }, penalties: { home: 2, away: 4 } } }));
  check('pens: draw + AWAY side', r.home === 1 && r.away === 1 && r.pens && r.penSide === 'AWAY' && r.problems.length === 0);
}
{ // quirk shape A: fullTime includes shootout goals; regular+extra present
  const r = extractResult(api({ status: 'FINISHED', score: { winner: 'HOME_TEAM', duration: 'PENALTY_SHOOTOUT', fullTime: { home: 5, away: 3 }, regularTime: { home: 1, away: 1 }, extraTime: { home: 0, away: 0 }, penalties: { home: 4, away: 2 } } }));
  check('pens quirk: derive draw from regular+extra', r.home === 1 && r.away === 1 && r.problems.length === 0);
}
{ // quirk shape B: only fullTime (incl. pens) + penalties → subtract
  const r = extractResult(api({ status: 'FINISHED', score: { winner: 'HOME_TEAM', duration: 'PENALTY_SHOOTOUT', fullTime: { home: 5, away: 3 }, penalties: { home: 4, away: 2 } } }));
  check('pens quirk: derive draw by subtracting penalties', r.home === 1 && r.away === 1 && r.problems.length === 0);
}
{ // underivable pens → problem, no score (never write a non-draw with pens)
  const r = extractResult(api({ status: 'FINISHED', score: { winner: 'HOME_TEAM', duration: 'PENALTY_SHOOTOUT', fullTime: { home: 2, away: 1 } } }));
  check('pens underivable → problem + null score', r.home === null && r.problems.length > 0);
}

// --- orient --------------------------------------------------------------------
{
  const our = { teamA: 'PAR', teamB: 'FRA' };
  const o = orient(api(), our); // api has FRA at home
  check('flipped orientation detected', o.flipped === true && !o.conflict);
}
{
  const o = orient(api({ homeTeam: { tla: 'PAR', name: 'Paraguay' }, awayTeam: { tla: 'FRA', name: 'France' } }), { teamA: 'PAR', teamB: 'FRA' });
  check('straight orientation detected', o.flipped === false && !o.conflict);
}
{
  const o = orient(api({ homeTeam: { tla: 'BRA', name: 'Brazil' }, awayTeam: { tla: 'NOR', name: 'Norway' } }), { teamA: 'PAR', teamB: 'FRA' });
  check('wrong teams → conflict', o.conflict === true);
}
{
  const o = orient(api({ homeTeam: { tla: null, name: 'Winner Match 89' }, awayTeam: { tla: null, name: 'Winner Match 90' } }), {});
  check('TBD teams → inert', o.inert === true && !o.conflict);
}

// --- buildFixtureMap -------------------------------------------------------------
{
  const ours = freshState().matches;
  const apis = [
    api({ id: 111 }), // matches 89 by kickoff+stage
    api({ id: 222, utcDate: '2026-07-04T17:00:00Z', homeTeam: { tla: 'CAN', name: 'Canada' }, awayTeam: { tla: 'MAR', name: 'Morocco' } }), // matches 90
    api({ id: 333, stage: 'QUARTER_FINALS', utcDate: '2026-07-09T20:00:00Z', homeTeam: { tla: null, name: 'TBD' }, awayTeam: { tla: null, name: 'TBD' } }), // matches 97
  ];
  const { map, problems, added } = buildFixtureMap(ours, apis, {});
  check('joins on kickoff+stage', map['89'] === 111 && map['90'] === 222 && map['97'] === 333);
  check('unjoined matches reported, not guessed', problems.length === ours.length - added);
  const again = buildFixtureMap(ours, [], map);
  check('existing entries preserved without API data', again.map['89'] === 111 && again.added === 0);
}
{ // kickoff matches but teams disagree → refuse the mapping
  const ours = freshState().matches;
  const apis = [api({ id: 999, homeTeam: { tla: 'BRA', name: 'Brazil' }, awayTeam: { tla: 'NOR', name: 'Norway' } })];
  const { map, problems } = buildFixtureMap(ours, apis, {});
  check('team-conflicted join refused', map['89'] == null && problems.some((p) => p.startsWith('89:')));
}

// --- planCycle -------------------------------------------------------------------
const FMAP = { 89: 111 };

{ // no news → no writes
  const plan = planCycle({ state: freshState(), apiMatches: [api({ id: 111 })], fixtureMap: FMAP, pending: {}, nowMs: NOW });
  check('scheduled + no score → no writes', plan.writes.length === 0);
  check('in kickoff window → active (keep polling)', plan.active === true);
}
{ // live score arrives (API home = our teamB, so 1-0 home → scoreA 0, scoreB 1)
  const plan = planCycle({
    state: freshState(),
    apiMatches: [api({ id: 111, status: 'IN_PLAY', score: { winner: null, duration: 'REGULAR', fullTime: { home: 1, away: 0 } } })],
    fixtureMap: FMAP, pending: {}, nowMs: NOW,
  });
  check('live update is one targeted patch', plan.writes.length === 1 && plan.writes[0].path === 'state/matches/0');
  check('score oriented through the flip', eq(plan.writes[0].data, { scoreA: 0, scoreB: 1, status: 'in_progress' }));
}
{ // FINISHED, first sighting → pending marker, NOT final
  const plan = planCycle({
    state: freshState(),
    apiMatches: [api({ id: 111, status: 'FINISHED', score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 2, away: 0 } } })],
    fixtureMap: FMAP, pending: {}, nowMs: NOW,
  });
  check('first FINISHED → not final yet', plan.writes.every((w) => w.data.status !== 'final'));
  check('first FINISHED → pending marker set', eq(plan.newPending['89']?.result, { scoreA: 0, scoreB: 2, pens: false, penWinner: null }));
  check('pending keeps the loop active', plan.active === true);
}
{ // FINISHED, second sighting with same result → final + bracket propagation
  const pending = { 89: { seenAt: 'x', result: { scoreA: 0, scoreB: 2, pens: false, penWinner: null } } };
  const plan = planCycle({
    state: freshState(),
    apiMatches: [api({ id: 111, status: 'FINISHED', score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 2, away: 0 } } })],
    fixtureMap: FMAP, pending, nowMs: NOW,
  });
  const matchWrite = plan.writes.find((w) => w.path === 'state/matches/0');
  check('second FINISHED → final', matchWrite?.data.status === 'final');
  check('pending cleared after confirm', !('89' in plan.newPending));
  const qfWrite = plan.writes.find((w) => w.path === 'state/matches/8'); // match 97 = index 8
  check('QF teamA propagated via resolveBracket', qfWrite?.data.teamA === 'FRA');
}
{ // second sighting with a DIFFERENT result → re-arm, don't finalize
  const pending = { 89: { seenAt: 'x', result: { scoreA: 0, scoreB: 1, pens: false, penWinner: null } } };
  const plan = planCycle({
    state: freshState(),
    apiMatches: [api({ id: 111, status: 'FINISHED', score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 2, away: 0 } } })],
    fixtureMap: FMAP, pending, nowMs: NOW,
  });
  check('changed result re-arms the check', plan.writes.every((w) => w.data.status !== 'final') && eq(plan.newPending['89'].result.scoreB, 2));
}
{ // DB-final matches are untouchable, even if the API disagrees
  const state = freshState();
  Object.assign(state.matches[0], { status: 'final', scoreA: 1, scoreB: 0 });
  const plan = planCycle({
    state,
    apiMatches: [api({ id: 111, status: 'FINISHED', score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 3, away: 3 } } })],
    fixtureMap: FMAP, pending: {}, nowMs: NOW,
  });
  check('DB-final never touched (admin wins)', plan.writes.every((w) => w.path !== 'state/matches/0' || !('scoreA' in w.data)));
}
{ // status never moves backwards
  const state = freshState();
  Object.assign(state.matches[0], { status: 'in_progress', scoreA: 1, scoreB: 0 });
  const plan = planCycle({
    state, apiMatches: [api({ id: 111, status: 'SCHEDULED' })], fixtureMap: FMAP, pending: {}, nowMs: NOW,
  });
  check('API glitch to SCHEDULED cannot downgrade status', plan.writes.every((w) => !('status' in w.data)));
}
{ // pens final writes the draw + decidedByPens + penWinner (our orientation)
  const pens = { winner: 'HOME_TEAM', duration: 'PENALTY_SHOOTOUT', fullTime: { home: 1, away: 1 }, penalties: { home: 4, away: 2 } };
  const pending = { 89: { seenAt: 'x', result: { scoreA: 1, scoreB: 1, pens: true, penWinner: 'FRA' } } };
  const plan = planCycle({
    state: freshState(), apiMatches: [api({ id: 111, status: 'FINISHED', score: pens })],
    fixtureMap: FMAP, pending, nowMs: NOW,
  });
  const w = plan.writes.find((x) => x.path === 'state/matches/0');
  check('pens final: draw score + penWinner, engine invariant safe',
    w && w.data.scoreA === 1 && w.data.scoreB === 1 && w.data.decidedByPens === true && w.data.penWinner === 'FRA' && w.data.status === 'final');
}
{ // team conflict between API and DB → match skipped, problem logged
  const plan = planCycle({
    state: freshState(),
    apiMatches: [api({ id: 111, status: 'IN_PLAY', homeTeam: { tla: 'BRA', name: 'Brazil' }, awayTeam: { tla: 'NOR', name: 'Norway' }, score: { winner: null, duration: 'REGULAR', fullTime: { home: 1, away: 0 } } })],
    fixtureMap: FMAP, pending: {}, nowMs: NOW,
  });
  check('API/DB team conflict → no writes for that match', plan.writes.length === 0 && plan.problems.length === 1);
}
{ // quiet day → inactive (single pass exits)
  const plan = planCycle({
    state: freshState(), apiMatches: [api({ id: 111 })], fixtureMap: FMAP, pending: {},
    nowMs: Date.parse('2026-07-08T12:00:00Z'), // no match within the window
  });
  check('nothing live or imminent → inactive', plan.active === false);
}

// --- report ------------------------------------------------------------------
if (failures.length) {
  console.error(`\n✗ ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error('  ✗', f);
  process.exit(1);
}
console.log(`✓ poller.test.js — all ${passed} checks passed`);
