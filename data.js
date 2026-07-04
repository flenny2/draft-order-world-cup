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
  // The confirmed 16 Round-of-16 teams, entered draw night (2026-07-04) from the
  // official R16 schedule. `id` is stable and is what matches/members reference.
  // A team is "unassigned" (out of play) iff no member holds its id — that's
  // derived, not stored (see getUnassignedTeams in engine.js). Presentation shows
  // a circular SVG flag derived from flagEmoji (app.js flag()), so the emoji must
  // be the correct nation (England uses the tag-sequence flag).
  { id: 'ARG', code: 'ARG', name: 'Argentina',   flagEmoji: '🇦🇷' },
  { id: 'BEL', code: 'BEL', name: 'Belgium',     flagEmoji: '🇧🇪' },
  { id: 'BRA', code: 'BRA', name: 'Brazil',      flagEmoji: '🇧🇷' },
  { id: 'CAN', code: 'CAN', name: 'Canada',      flagEmoji: '🇨🇦' },
  { id: 'COL', code: 'COL', name: 'Colombia',    flagEmoji: '🇨🇴' },
  { id: 'EGY', code: 'EGY', name: 'Egypt',       flagEmoji: '🇪🇬' },
  { id: 'ENG', code: 'ENG', name: 'England',     flagEmoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { id: 'FRA', code: 'FRA', name: 'France',      flagEmoji: '🇫🇷' },
  { id: 'MEX', code: 'MEX', name: 'Mexico',      flagEmoji: '🇲🇽' },
  { id: 'MAR', code: 'MAR', name: 'Morocco',     flagEmoji: '🇲🇦' },
  { id: 'NOR', code: 'NOR', name: 'Norway',      flagEmoji: '🇳🇴' },
  { id: 'PAR', code: 'PAR', name: 'Paraguay',    flagEmoji: '🇵🇾' },
  { id: 'POR', code: 'POR', name: 'Portugal',    flagEmoji: '🇵🇹' },
  { id: 'ESP', code: 'ESP', name: 'Spain',       flagEmoji: '🇪🇸' },
  { id: 'SUI', code: 'SUI', name: 'Switzerland', flagEmoji: '🇨🇭' },
  { id: 'USA', code: 'USA', name: 'USA',         flagEmoji: '🇺🇸' },
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
  // Confirmed fixtures from the official R16 schedule (entered 2026-07-04). Times
  // are the ET broadcast time encoded at the EDT offset (-04:00) — an unambiguous
  // absolute instant; the app renders each in the VIEWER's local zone, and `venue`
  // is display-only. Match ids 89–96 are the FIFA numbers and feed the QFs via
  // bracketTopology below, so they must not be renumbered.
  { id: '89', round: 'R16', slot: 'R16-89', teamA: 'PAR', teamB: 'FRA', datetimeISO: '2026-07-04T17:00:00-04:00', venue: 'Philadelphia',   ...blankResult },
  { id: '90', round: 'R16', slot: 'R16-90', teamA: 'CAN', teamB: 'MAR', datetimeISO: '2026-07-04T13:00:00-04:00', venue: 'Houston',        ...blankResult },
  { id: '91', round: 'R16', slot: 'R16-91', teamA: 'BRA', teamB: 'NOR', datetimeISO: '2026-07-05T16:00:00-04:00', venue: 'East Rutherford', ...blankResult },
  { id: '92', round: 'R16', slot: 'R16-92', teamA: 'MEX', teamB: 'ENG', datetimeISO: '2026-07-05T20:00:00-04:00', venue: 'Mexico City',     ...blankResult },
  { id: '93', round: 'R16', slot: 'R16-93', teamA: 'ESP', teamB: 'POR', datetimeISO: '2026-07-06T15:00:00-04:00', venue: 'Arlington',       ...blankResult },
  { id: '94', round: 'R16', slot: 'R16-94', teamA: 'BEL', teamB: 'USA', datetimeISO: '2026-07-06T20:00:00-04:00', venue: 'Seattle',         ...blankResult },
  { id: '95', round: 'R16', slot: 'R16-95', teamA: 'EGY', teamB: 'ARG', datetimeISO: '2026-07-07T12:00:00-04:00', venue: 'Atlanta',         ...blankResult },
  { id: '96', round: 'R16', slot: 'R16-96', teamA: 'SUI', teamB: 'COL', datetimeISO: '2026-07-07T16:00:00-04:00', venue: 'Vancouver',       ...blankResult },
  // Quarterfinals ----------------------------------------------------------
  // QF/SF/3rd/Final kickoffs verified 2026-07-04 against the official schedule
  // (Wikipedia knockout-stage page, corroborated by ESPN/CBS Boston). The old
  // researched values assumed US primetime; official times target European
  // evening TV (~3–4 PM ET). Venue-local offsets, per the convention above.
  { id: '97',  round: 'QF', slot: 'QF-97',  teamA: null, teamB: null, datetimeISO: '2026-07-09T16:00:00-04:00', venue: 'Foxborough',    ...blankResult },
  { id: '98',  round: 'QF', slot: 'QF-98',  teamA: null, teamB: null, datetimeISO: '2026-07-10T12:00:00-07:00', venue: 'Inglewood',     ...blankResult },
  { id: '99',  round: 'QF', slot: 'QF-99',  teamA: null, teamB: null, datetimeISO: '2026-07-11T17:00:00-04:00', venue: 'Miami Gardens', ...blankResult },
  { id: '100', round: 'QF', slot: 'QF-100', teamA: null, teamB: null, datetimeISO: '2026-07-11T20:00:00-05:00', venue: 'Kansas City',   ...blankResult },
  // Semifinals -------------------------------------------------------------
  { id: '101', round: 'SF', slot: 'SF-101', teamA: null, teamB: null, datetimeISO: '2026-07-14T14:00:00-05:00', venue: 'Arlington',     ...blankResult },
  { id: '102', round: 'SF', slot: 'SF-102', teamA: null, teamB: null, datetimeISO: '2026-07-15T15:00:00-04:00', venue: 'Atlanta',       ...blankResult },
  // Third-place & Final ----------------------------------------------------
  { id: '3rd',   round: '3rd',   slot: '3rd',   teamA: null, teamB: null, datetimeISO: '2026-07-18T17:00:00-04:00', venue: 'Miami Gardens',  ...blankResult },
  { id: 'final', round: 'Final', slot: 'Final', teamA: null, teamB: null, datetimeISO: '2026-07-19T15:00:00-04:00', venue: 'East Rutherford', ...blankResult },
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
