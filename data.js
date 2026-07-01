// =============================================================================
// data.js — THE ONE MARKED PLACE for editable data (DATA layer)
// =============================================================================
// Per the spec: ALL editable config lives here. The engine (engine.js) and the
// presentation (app.js) must never hard-code ruleset data; they read from this.
//
// In Phase 2 this same shape is mirrored into the Firebase Realtime Database
// tree, and store.js becomes the live source of truth. For Phase 1 this static
// seed stands in for the database.
//
// HONEST SEED: the tournament is live (R32 in progress as of 2026-06-30), so most
// R16 participants are not yet known. Known slots are filled with real nations;
// unknown slots use "Winner R32-NN" placeholder teams that resolve once R32 ends.
// The admin (Phase 2) edits everything below from the phone.
// =============================================================================

// --- Teams: the 16 that reach the Round of 16 ------------------------------
// `id` is stable and is what matches/members reference. A team is "unassigned"
// (out of play) iff no member holds its id — we derive that, not store a flag,
// so there is a single source of truth (see getUnassignedTeams in engine.js).
export const teams = [
  // Known R16 participants (per the researched fixture skeleton).
  { id: 'CAN', code: 'CAN', name: 'Canada',   flagEmoji: '🇨🇦' },
  { id: 'MAR', code: 'MAR', name: 'Morocco',  flagEmoji: '🇲🇦' },
  { id: 'PAR', code: 'PAR', name: 'Paraguay', flagEmoji: '🇵🇾' },
  { id: 'BRA', code: 'BRA', name: 'Brazil',   flagEmoji: '🇧🇷' },
  // Unknown slots — winners of the listed Round-of-32 matches. Real nation gets
  // patched in by admin once R32 resolves. flagEmoji '🏳️' = TBD.
  { id: 'W77', code: 'W77', name: 'Winner R32-77', flagEmoji: '🏳️' },
  { id: 'W78', code: 'W78', name: 'Winner R32-78', flagEmoji: '🏳️' },
  { id: 'W79', code: 'W79', name: 'Winner R32-79', flagEmoji: '🏳️' },
  { id: 'W80', code: 'W80', name: 'Winner R32-80', flagEmoji: '🏳️' },
  { id: 'W81', code: 'W81', name: 'Winner R32-81', flagEmoji: '🏳️' },
  { id: 'W82', code: 'W82', name: 'Winner R32-82', flagEmoji: '🏳️' },
  { id: 'W83', code: 'W83', name: 'Winner R32-83', flagEmoji: '🏳️' },
  { id: 'W84', code: 'W84', name: 'Winner R32-84', flagEmoji: '🏳️' },
  { id: 'W85', code: 'W85', name: 'Winner R32-85', flagEmoji: '🏳️' },
  { id: 'W86', code: 'W86', name: 'Winner R32-86', flagEmoji: '🏳️' },
  { id: 'W87', code: 'W87', name: 'Winner R32-87', flagEmoji: '🏳️' },
  { id: 'W88', code: 'W88', name: 'Winner R32-88', flagEmoji: '🏳️' },
];

// --- Members: the 12 league players ---------------------------------------
// List order = last season's final standings — DISPLAY ONLY; it never feeds the
// engine. `teamId` and `tiebreakNumber` stay null until the random.org draw is
// entered in admin (Phase 2). "Commish" = Dylan (admin).
export const members = [
  { id: 'm1',  name: 'Nathan',  teamId: null, tiebreakNumber: null },
  { id: 'm2',  name: 'James',   teamId: null, tiebreakNumber: null },
  { id: 'm3',  name: 'Lance',   teamId: null, tiebreakNumber: null },
  { id: 'm4',  name: 'Volkan',  teamId: null, tiebreakNumber: null },
  { id: 'm5',  name: 'Sally',   teamId: null, tiebreakNumber: null },
  { id: 'm6',  name: 'Jake',    teamId: null, tiebreakNumber: null },
  { id: 'm7',  name: 'Tyler',   teamId: null, tiebreakNumber: null },
  { id: 'm8',  name: 'Andrew',  teamId: null, tiebreakNumber: null },
  { id: 'm9',  name: 'Erik',    teamId: null, tiebreakNumber: null },
  { id: 'm10', name: 'Kyle',    teamId: null, tiebreakNumber: null },
  { id: 'm11', name: 'Josh',    teamId: null, tiebreakNumber: null },
  { id: 'm12', name: 'Commish', teamId: null, tiebreakNumber: null },
];

// --- Matches: the 15 knockout fixtures (R16 → Final) -----------------------
// round ∈ {R16, QF, SF, 3rd, Final}; status ∈ {scheduled, in_progress, final}.
// teamA/teamB are team ids, or null when TBD. scoreA/scoreB are the END-OF-EXTRA-
// TIME score (a shootout is recorded as a draw — see decidedByPens). penWinner is
// the team id that won the shootout (advancement only; does NOT change the score).
// Datetimes are ISO with the venue's UTC offset (EDT -04, CDT -05, PDT -07).
const blankResult = { status: 'scheduled', scoreA: null, scoreB: null, decidedByPens: false, penWinner: null };

export const matches = [
  // Round of 16 ------------------------------------------------------------
  { id: '89', round: 'R16', slot: 'R16-89', teamA: 'W79', teamB: 'W80', datetimeISO: '2026-07-04T15:00:00-04:00', venue: 'Philadelphia', ...blankResult },
  { id: '90', round: 'R16', slot: 'R16-90', teamA: 'CAN', teamB: 'MAR', datetimeISO: '2026-07-04T18:00:00-05:00', venue: 'Houston',      ...blankResult },
  // NOTE: Mexico City is UTC-6 and does NOT observe DST; source labeled these EDT.
  // Stored as sourced (-04:00) — VERIFY and let admin correct to -06:00 if needed.
  { id: '91', round: 'R16', slot: 'R16-91', teamA: 'W81', teamB: 'W82', datetimeISO: '2026-07-05T15:00:00-04:00', venue: 'Mexico City',  ...blankResult },
  { id: '92', round: 'R16', slot: 'R16-92', teamA: 'W83', teamB: 'W84', datetimeISO: '2026-07-05T18:00:00-04:00', venue: 'Mexico City',  ...blankResult },
  { id: '93', round: 'R16', slot: 'R16-93', teamA: 'W85', teamB: 'W87', datetimeISO: '2026-07-06T15:00:00-05:00', venue: 'Seattle',      ...blankResult },
  { id: '94', round: 'R16', slot: 'R16-94', teamA: 'W86', teamB: 'W88', datetimeISO: '2026-07-06T18:00:00-05:00', venue: 'Arlington',    ...blankResult },
  { id: '95', round: 'R16', slot: 'R16-95', teamA: 'PAR', teamB: 'W77', datetimeISO: '2026-07-07T15:00:00-07:00', venue: 'Vancouver',    ...blankResult },
  { id: '96', round: 'R16', slot: 'R16-96', teamA: 'BRA', teamB: 'W78', datetimeISO: '2026-07-07T18:00:00-07:00', venue: 'Vancouver',    ...blankResult },
  // Quarterfinals ----------------------------------------------------------
  { id: '97',  round: 'QF', slot: 'QF-97',  teamA: null, teamB: null, datetimeISO: '2026-07-09T20:00:00-04:00', venue: 'Foxborough',    ...blankResult },
  { id: '98',  round: 'QF', slot: 'QF-98',  teamA: null, teamB: null, datetimeISO: '2026-07-10T20:00:00-07:00', venue: 'Inglewood',     ...blankResult },
  { id: '99',  round: 'QF', slot: 'QF-99',  teamA: null, teamB: null, datetimeISO: '2026-07-11T15:00:00-04:00', venue: 'Miami Gardens', ...blankResult },
  { id: '100', round: 'QF', slot: 'QF-100', teamA: null, teamB: null, datetimeISO: '2026-07-11T18:00:00-05:00', venue: 'Kansas City',   ...blankResult },
  // Semifinals -------------------------------------------------------------
  { id: '101', round: 'SF', slot: 'SF-101', teamA: null, teamB: null, datetimeISO: '2026-07-14T20:00:00-05:00', venue: 'Arlington',     ...blankResult },
  { id: '102', round: 'SF', slot: 'SF-102', teamA: null, teamB: null, datetimeISO: '2026-07-15T20:00:00-04:00', venue: 'Atlanta',       ...blankResult },
  // Third-place & Final ----------------------------------------------------
  { id: '3rd',   round: '3rd',   slot: '3rd',   teamA: null, teamB: null, datetimeISO: '2026-07-18T15:00:00-04:00', venue: 'Miami Gardens',  ...blankResult },
  { id: 'final', round: 'Final', slot: 'Final', teamA: null, teamB: null, datetimeISO: '2026-07-19T20:00:00-04:00', venue: 'East Rutherford', ...blankResult },
];

// --- Bracket topology: fixed wiring so a final result auto-feeds the next slot.
// Used by admin auto-populate in Phase 2 (engine doesn't need it — it reads the
// actual teamIds on each match). R16 slots are fed by external R32 winners.
// { from: 'winner'|'loser', match: <id> }.
export const bracketTopology = {
  '97':    { teamA: { from: 'winner', match: '89' }, teamB: { from: 'winner', match: '90' } },
  '98':    { teamA: { from: 'winner', match: '93' }, teamB: { from: 'winner', match: '94' } },
  '99':    { teamA: { from: 'winner', match: '91' }, teamB: { from: 'winner', match: '92' } },
  '100':   { teamA: { from: 'winner', match: '95' }, teamB: { from: 'winner', match: '96' } },
  '101':   { teamA: { from: 'winner', match: '97' }, teamB: { from: 'winner', match: '98' } },
  '102':   { teamA: { from: 'winner', match: '99' }, teamB: { from: 'winner', match: '100' } },
  'final': { teamA: { from: 'winner', match: '101' }, teamB: { from: 'winner', match: '102' } },
  '3rd':   { teamA: { from: 'loser',  match: '101' }, teamB: { from: 'loser',  match: '102' } },
};

export const meta = {
  rulesLockedDate: '2026-06-30',
  lastUpdated: null, // set live from the store in Phase 2
};

// Convenience bundle (handy for the store mirror in Phase 2).
export const seed = { teams, members, matches, bracketTopology, meta };
