// =============================================================================
// demo.js — a complete, finished sample tournament for testing/teaching.
// =============================================================================
// NOT the real draw. Loadable from #admin ("Load demo") to populate the store so
// you can see a fully locked 1..12 order and the live view end-to-end. Safe to
// delete once the real tournament data is being entered. Crafted to exercise the
// tricky rules: two pens defeats (GD 0, outrank regulation losers), a 3-way R16
// tie broken by tiebreak number, and 4 unassigned teams (lower picks slide up).
// =============================================================================

const teams = [
  { id: 'ARG', code: 'ARG', name: 'Argentina',  flagEmoji: '🇦🇷' },
  { id: 'FRA', code: 'FRA', name: 'France',      flagEmoji: '🇫🇷' },
  { id: 'BRA', code: 'BRA', name: 'Brazil',      flagEmoji: '🇧🇷' },
  { id: 'ENG', code: 'ENG', name: 'England',     flagEmoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { id: 'ESP', code: 'ESP', name: 'Spain',       flagEmoji: '🇪🇸' },
  { id: 'POR', code: 'POR', name: 'Portugal',    flagEmoji: '🇵🇹' },
  { id: 'NED', code: 'NED', name: 'Netherlands', flagEmoji: '🇳🇱' },
  { id: 'GER', code: 'GER', name: 'Germany',     flagEmoji: '🇩🇪' },
  { id: 'CRO', code: 'CRO', name: 'Croatia',     flagEmoji: '🇭🇷' },
  { id: 'MAR', code: 'MAR', name: 'Morocco',     flagEmoji: '🇲🇦' },
  { id: 'JPN', code: 'JPN', name: 'Japan',       flagEmoji: '🇯🇵' },
  { id: 'USA', code: 'USA', name: 'USA',         flagEmoji: '🇺🇸' },
  { id: 'MEX', code: 'MEX', name: 'Mexico',      flagEmoji: '🇲🇽' },
  { id: 'CAN', code: 'CAN', name: 'Canada',      flagEmoji: '🇨🇦' },
  { id: 'SEN', code: 'SEN', name: 'Senegal',     flagEmoji: '🇸🇳' },
  { id: 'URU', code: 'URU', name: 'Uruguay',     flagEmoji: '🇺🇾' },
];

const fin = (id, round, a, b, scoreA, scoreB, pens = null) =>
  ({ id, round, slot: id, teamA: a, teamB: b, datetimeISO: null, venue: '',
     status: 'final', scoreA, scoreB, decidedByPens: !!pens, penWinner: pens });

const matches = [
  fin('89', 'R16', 'ARG', 'URU', 2, 1),
  fin('90', 'R16', 'FRA', 'SEN', 1, 1, 'FRA'),   // pens → SEN GD0
  fin('91', 'R16', 'BRA', 'CAN', 3, 0),
  fin('92', 'R16', 'ENG', 'MEX', 2, 0),
  fin('93', 'R16', 'ESP', 'USA', 1, 0),
  fin('94', 'R16', 'POR', 'JPN', 2, 1),
  fin('95', 'R16', 'NED', 'MAR', 0, 0, 'NED'),   // pens → MAR GD0
  fin('96', 'R16', 'GER', 'CRO', 2, 1),
  fin('97', 'QF', 'ARG', 'FRA', 1, 0),
  fin('98', 'QF', 'ESP', 'POR', 2, 2, 'ESP'),    // pens → POR GD0 (tops QF band)
  fin('99', 'QF', 'BRA', 'ENG', 1, 2),
  fin('100', 'QF', 'NED', 'GER', 3, 1),
  fin('101', 'SF', 'ARG', 'ESP', 2, 1),
  fin('102', 'SF', 'ENG', 'NED', 1, 0),
  fin('final', 'Final', 'ARG', 'ENG', 3, 1),
  fin('3rd', '3rd', 'ESP', 'NED', 2, 0),
];

// 12 assigned; GER/USA/MEX/CAN unassigned. The 3-way GD-1/GF1 R16 tie
// (URU/JPN/CRO) resolves by tiebreak number → Japan(3) < Uruguay(7) < Croatia(11).
const members = [
  { id: 'm1',  name: 'Nathan',  teamId: 'ARG', tiebreakNumber: 1 },
  { id: 'm2',  name: 'James',   teamId: 'ENG', tiebreakNumber: 2 },
  { id: 'm3',  name: 'Lance',   teamId: 'ESP', tiebreakNumber: 4 },
  { id: 'm4',  name: 'Volkan',  teamId: 'NED', tiebreakNumber: 5 },
  { id: 'm5',  name: 'Sally',   teamId: 'POR', tiebreakNumber: 6 },
  { id: 'm6',  name: 'Jake',    teamId: 'BRA', tiebreakNumber: 8 },
  { id: 'm7',  name: 'Tyler',   teamId: 'FRA', tiebreakNumber: 9 },
  { id: 'm8',  name: 'Andrew',  teamId: 'SEN', tiebreakNumber: 10 },
  { id: 'm9',  name: 'Erik',    teamId: 'MAR', tiebreakNumber: 12 },
  { id: 'm10', name: 'Kyle',    teamId: 'JPN', tiebreakNumber: 3 },
  { id: 'm11', name: 'Josh',    teamId: 'URU', tiebreakNumber: 7 },
  { id: 'm12', name: 'Commish', teamId: 'CRO', tiebreakNumber: 11 },
];

export const demoState = {
  teams, members, matches,
  meta: { rulesLockedDate: '2026-06-30', lastUpdated: null },
};
