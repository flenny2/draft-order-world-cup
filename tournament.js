// =============================================================================
// tournament.js — TOURNAMENT PROFILES (DATA layer)
// =============================================================================
// A "profile" is everything that makes one tournament different from another:
// its knockout STRUCTURE (which rounds exist, how they map to finish bands, when
// picks lock, how many teams), its DISPLAY LABELS, and its SEED data. The pure
// engine (engine.js) reads a profile's `ruleset` and knows nothing tournament-
// specific itself — so supporting the women's World Cup, the Euros, or the
// Champions League is "add a profile here", not "edit the engine".
//
// This lives on the DATA side of the DATA / LOGIC / PRESENTATION split. engine.js
// (LOGIC) consumes `ruleset`; app.js (PRESENTATION) consumes `labels` + `seed`.
//
// The ruleset encodes claude.md §THE RULESET. If a rule's STRUCTURE changes it
// changes here; if the rule's LOGIC changes it changes in engine.js. The men's
// 2026 World Cup profile is the DEFAULT and must stay behaviour-identical to the
// pre-profile engine — the test suite is the safety net.
//
// NOTE: profiles.js (unrelated, despite the near-name) holds sticker-card facts.
// This file is the tournament CONFIG. Keep them separate.
// =============================================================================

import { seed as mensWorldCupSeed } from './data.js';

// --- Men's 2026 World Cup — the DEFAULT profile ------------------------------
// `ruleset` is the exact structure the engine used to hard-code. Do not "tidy"
// these values without re-running the suite: they ARE the current behaviour.
const mensWorldCupRuleset = {
  // Finish bands, BEST → WORST. Array index = rank (ALIVE must be first so a
  // still-alive team sorts to the top — it can still finish anywhere). This
  // replaces the engine's old BAND_RANK object; the engine derives rank from
  // array position. (claude.md rule 5.)
  bands: [
    'ALIVE',
    'CHAMPION',
    'RUNNER_UP',
    'SF_LOSER', // lost a semi: guaranteed 3rd/4th, ranks below the finalists
    'THIRD',
    'FOURTH',
    'QF_LOSERS',
    'R16_LOSERS',
  ],

  // The bands where the ruleset tiebreaker (GD → GF → tiebreak number) applies.
  // A team's elimination-match GD/GF is only tracked for these bands; every other
  // band is decided by a single match and can't tie. (claude.md rules 6–7.)
  tiebreakBands: ['QF_LOSERS', 'R16_LOSERS'],

  // How each knockout round assigns finish bands to its winner / loser.
  //  - `winner` / `loser`: the band that outcome lands in (omit if the round
  //    doesn't terminate that side — R16/QF winners play on, so no `winner`).
  //  - `provisional: true`: the loser plays again (an SF loser contests the
  //    3rd-place game), so only band it while it's still ALIVE — a later round's
  //    THIRD/FOURTH upgrade must never be clobbered by match-array order.
  // Rounds absent here (e.g. a group stage) are ignored by classification.
  rounds: {
    R16: { loser: 'R16_LOSERS' },
    QF: { loser: 'QF_LOSERS' },
    SF: { loser: 'SF_LOSER', provisional: true },
    '3rd': { winner: 'THIRD', loser: 'FOURTH' },
    Final: { winner: 'CHAMPION', loser: 'RUNNER_UP' },
  },

  // Rounds that must ALL be decided for a band's picks to lock. The band's own
  // round fixes its internal order; earlier rounds are required because an
  // undecided earlier match still ranks its teams above the band and its eventual
  // loser drops below, shifting pick numbers. Champ/RU deliberately do NOT need
  // the 3rd-place game (SF losers rank below RUNNER_UP either way). (claude.md
  // §Locking rule.) Bands not listed (ALIVE, SF_LOSER) never lock.
  lockNeeds: {
    CHAMPION: ['R16', 'QF', 'SF', 'Final'],
    RUNNER_UP: ['R16', 'QF', 'SF', 'Final'],
    THIRD: ['R16', 'QF', 'SF', '3rd'],
    FOURTH: ['R16', 'QF', 'SF', '3rd'],
    QF_LOSERS: ['R16', 'QF'],
    R16_LOSERS: ['R16'],
  },

  // The distinct tiebreak numbers span 1..tiebreakMax (one per assigned team).
  // Used by validate() to range-check admin input. (claude.md rule 8.)
  tiebreakMax: 12,
};

// Display labels for PRESENTATION. Keyed by the same round ids the ruleset uses.
const mensWorldCupLabels = {
  roundLabel: { R16: 'Round of 16', QF: 'Quarterfinal', SF: 'Semifinal', '3rd': '3rd-place game', Final: 'Final' },
  roundMark: { R16: 'R16', QF: 'QF', SF: 'SF', '3rd': '3rd', Final: 'F' },
};

export const mensWorldCup2026 = {
  id: 'wc-men-2026',
  name: '2026 World Cup',
  ruleset: mensWorldCupRuleset,
  labels: mensWorldCupLabels,
  seed: mensWorldCupSeed,
};

// --- demo4 — a minimal second profile that proves the swap -------------------
// A 4-team, single-elimination-with-3rd-place tournament: two semis feed the
// Final and the 3rd-place game. It exists ONLY to prove the engine is truly
// profile-driven — a DIFFERENT round set (no R16/QF), DIFFERENT bands (no loser
// bands, so no GD tiebreak at all), and a DIFFERENT team count run through the
// exact same engine with zero engine edits. See tournament.test.js.
const demo4Teams = [
  { id: 'A', code: 'A', name: 'Team A', flagEmoji: '🅰️' },
  { id: 'B', code: 'B', name: 'Team B', flagEmoji: '🅱️' },
  { id: 'C', code: 'C', name: 'Team C', flagEmoji: '🇨' },
  { id: 'D', code: 'D', name: 'Team D', flagEmoji: '🇩' },
];

const fin = (id, round, teamA, teamB, scoreA, scoreB) => ({
  id, round, slot: id, teamA, teamB, datetimeISO: null, venue: '',
  status: 'final', scoreA, scoreB, decidedByPens: false, penWinner: null,
});

const demo4Matches = [
  fin('sf1', 'SF', 'A', 'B', 2, 1),    // A beats B
  fin('sf2', 'SF', 'C', 'D', 1, 0),    // C beats D
  fin('final', 'Final', 'A', 'C', 1, 0), // A champion, C runner-up
  fin('3rd', '3rd', 'B', 'D', 2, 0),   // B third, D fourth
];

const demo4Members = [
  { id: 'p1', name: 'Player 1', teamId: 'A', tiebreakNumber: 1 },
  { id: 'p2', name: 'Player 2', teamId: 'B', tiebreakNumber: 2 },
  { id: 'p3', name: 'Player 3', teamId: 'C', tiebreakNumber: 3 },
  { id: 'p4', name: 'Player 4', teamId: 'D', tiebreakNumber: 4 },
];

export const demo4 = {
  id: 'demo-4team',
  name: 'Demo (4 teams)',
  ruleset: {
    bands: ['ALIVE', 'CHAMPION', 'RUNNER_UP', 'SF_LOSER', 'THIRD', 'FOURTH'],
    tiebreakBands: [], // no multi-team loser bands → the GD/GF tiebreak never fires
    rounds: {
      SF: { loser: 'SF_LOSER', provisional: true },
      '3rd': { winner: 'THIRD', loser: 'FOURTH' },
      Final: { winner: 'CHAMPION', loser: 'RUNNER_UP' },
    },
    lockNeeds: {
      CHAMPION: ['SF', 'Final'],
      RUNNER_UP: ['SF', 'Final'],
      THIRD: ['SF', '3rd'],
      FOURTH: ['SF', '3rd'],
    },
    tiebreakMax: 4,
  },
  labels: {
    roundLabel: { SF: 'Semifinal', '3rd': '3rd-place game', Final: 'Final' },
    roundMark: { SF: 'SF', '3rd': '3rd', Final: 'F' },
  },
  seed: {
    teams: demo4Teams,
    members: demo4Members,
    matches: demo4Matches,
    bracketTopology: {
      final: { teamA: { from: 'winner', match: 'sf1' }, teamB: { from: 'winner', match: 'sf2' } },
      '3rd': { teamA: { from: 'loser', match: 'sf1' }, teamB: { from: 'loser', match: 'sf2' } },
    },
    meta: { rulesLockedDate: '2026-06-30', lastUpdated: null },
  },
};

// The active tournament. Change THIS one line to swap the whole app to another
// profile — the engine, store, and views all read structure/labels from here.
export const activeProfile = mensWorldCup2026;

// The engine's default when a caller passes no `ruleset` (keeps every existing
// call site — tests, simulate, report, app — on the men's WC behaviour).
export const defaultRuleset = activeProfile.ruleset;
