// =============================================================================
// profiles.js — sticker-card data (DATA layer, static facts only)
// =============================================================================
// Authored 2026-07-05. Facts are static by design; the card SHOWS the 2026
// story instead of telling it — the full group table (groups below), each
// team's R32 result, and the knockout run rendered live from state.matches.
// The only prose is an optional "2026 so far" summary saved from #admin to
// /state/summaries/<teamId>, plus each team's evergreen `note`.
//
// Sources & verification (raw wikitext fetched directly, never summarized):
// - 2026 group finishes/records: Wikipedia group-tables template, corroborated
//   field-by-field against ESPN's standings API — all 16 matched exactly.
// - All-time stats: Wikipedia "National team appearances in the FIFA World Cup"
//   (updated 2026-07-03), cross-checked against the per-tournament results grid
//   on the same page. Appearance counts INCLUDE 2026; a "titles" year list is
//   the championship years.
// - Key players: verified present on the official 26-man squad list (Wikipedia
//   "2026 FIFA World Cup squads"); "(c)" = tournament captain.
// Text only — no player images, no external requests (site rule).
// =============================================================================

export const teamProfiles = {
  ARG: {
    group: 'J', r32: { iso: 'cv', name: 'Cape Verde', score: '3–2' },
    appearances: 19, debut: 1930, titles: 3,
    bestFinish: 'Champions — 1978 · 1986 · 2022',
    keyPlayers: ['Lionel Messi (c)', 'Julián Alvarez', 'Enzo Fernández'],
    note: 'Defending champions.',
  },
  BEL: {
    group: 'G', r32: { iso: 'sn', name: 'Senegal', score: '3–2' },
    appearances: 15, debut: 1930, titles: 0,
    bestFinish: 'Third place — 2018',
    keyPlayers: ['Kevin De Bruyne', 'Jérémy Doku', 'Romelu Lukaku'],
  },
  BRA: {
    group: 'C', r32: { iso: 'jp', name: 'Japan', score: '2–1' },
    appearances: 23, debut: 1930, titles: 5,
    bestFinish: 'Champions — 1958 · 1962 · 1970 · 1994 · 2002',
    keyPlayers: ['Vinícius Júnior', 'Raphinha', 'Neymar'],
    note: 'The only nation to appear at all 23 World Cups.',
  },
  CAN: {
    group: 'B', r32: { iso: 'za', name: 'South Africa', score: '1–0' },
    appearances: 3, debut: 1986, titles: 0,
    bestFinish: 'Round of 16 — 2026',
    keyPlayers: ['Alphonso Davies (c)', 'Jonathan David', 'Tajon Buchanan'],
    note: 'Co-host — and this run is already Canada’s best World Cup ever.',
  },
  COL: {
    group: 'K', r32: { iso: 'gh', name: 'Ghana', score: '1–0' },
    appearances: 7, debut: 1962, titles: 0,
    bestFinish: 'Quarter-finals — 2014',
    keyPlayers: ['Luis Díaz', 'James Rodríguez (c)', 'Richard Ríos'],
  },
  EGY: {
    group: 'G', r32: { iso: 'au', name: 'Australia', score: '1–1', pens: true },
    appearances: 4, debut: 1934, titles: 0,
    bestFinish: 'Round of 16 — 2026',
    keyPlayers: ['Mohamed Salah (c)', 'Omar Marmoush', 'Emam Ashour'],
    note: 'This is the first knockout stage in Egypt’s World Cup history.',
  },
  ENG: {
    group: 'L', r32: { iso: 'cd', name: 'DR Congo', score: '2–1' },
    appearances: 17, debut: 1950, titles: 1,
    bestFinish: 'Champions — 1966',
    keyPlayers: ['Harry Kane (c)', 'Jude Bellingham', 'Bukayo Saka'],
  },
  FRA: {
    group: 'I', r32: { iso: 'se', name: 'Sweden', score: '3–0' },
    appearances: 17, debut: 1930, titles: 2,
    bestFinish: 'Champions — 1998 · 2018',
    keyPlayers: ['Kylian Mbappé (c)', 'Ousmane Dembélé', 'Michael Olise'],
  },
  MEX: {
    group: 'A', r32: { iso: 'ec', name: 'Ecuador', score: '2–0' },
    appearances: 18, debut: 1930, titles: 0,
    bestFinish: 'Quarter-finals — 1970 · 1986',
    keyPlayers: ['Edson Álvarez (c)', 'Santiago Giménez', 'Raúl Jiménez'],
    note: 'Co-host. Both quarter-final runs also came on home soil.',
  },
  MAR: {
    group: 'C', r32: { iso: 'nl', name: 'Netherlands', score: '1–1', pens: true },
    appearances: 7, debut: 1970, titles: 0,
    bestFinish: 'Fourth place — 2022',
    keyPlayers: ['Achraf Hakimi (c)', 'Brahim Díaz', 'Yassine Bounou'],
    note: 'First African team ever to reach a World Cup semi-final (2022).',
  },
  NOR: {
    group: 'I', r32: { iso: 'ci', name: 'Ivory Coast', score: '2–1' },
    appearances: 4, debut: 1938, titles: 0,
    bestFinish: 'Round of 16 — 1938 · 1998 · 2026',
    keyPlayers: ['Erling Haaland', 'Martin Ødegaard (c)', 'Alexander Sørloth'],
    note: 'First World Cup since 1998.',
  },
  PAR: {
    group: 'D', r32: { iso: 'de', name: 'Germany', score: '1–1', pens: true },
    appearances: 9, debut: 1930, titles: 0,
    bestFinish: 'Quarter-finals — 2010',
    keyPlayers: ['Miguel Almirón', 'Julio Enciso', 'Gustavo Gómez (c)'],
    note: 'The shootout win over Germany was a first knockout win since 2010.',
  },
  POR: {
    group: 'K', r32: { iso: 'hr', name: 'Croatia', score: '2–1' },
    appearances: 9, debut: 1966, titles: 0,
    bestFinish: 'Third place — 1966',
    keyPlayers: ['Cristiano Ronaldo (c)', 'Bruno Fernandes', 'Bernardo Silva'],
  },
  ESP: {
    group: 'H', r32: { iso: 'at', name: 'Austria', score: '3–0' },
    appearances: 17, debut: 1934, titles: 1,
    bestFinish: 'Champions — 2010',
    keyPlayers: ['Lamine Yamal', 'Pedri', 'Rodri (c)'],
  },
  SUI: {
    group: 'B', r32: { iso: 'dz', name: 'Algeria', score: '2–0' },
    appearances: 13, debut: 1934, titles: 0,
    bestFinish: 'Quarter-finals — 1934 · 1938 · 1954',
    keyPlayers: ['Granit Xhaka (c)', 'Manuel Akanji', 'Breel Embolo'],
  },
  USA: {
    group: 'D', r32: { iso: 'ba', name: 'Bosnia and Herzegovina', score: '2–0' },
    appearances: 12, debut: 1930, titles: 0,
    bestFinish: 'Third place — 1930',
    keyPlayers: ['Christian Pulisic', 'Weston McKennie', 'Folarin Balogun'],
    note: 'Co-host of this World Cup.',
  },
};

// --- Final 2026 group tables (the groups our 16 came from; none came from E
// or F). Row: [circle-flags iso, name, W, D, L, GF, GA, advancedToKnockouts].
// Rows are in final standing order; Pts is derived (3W + 1D) at render time.
// Same two-source verification as above (Wikipedia template vs ESPN API).
export const groups = {
  A: [['mx', 'Mexico', 3, 0, 0, 6, 0, 1], ['za', 'South Africa', 1, 1, 1, 2, 3, 1], ['kr', 'South Korea', 1, 0, 2, 2, 3, 0], ['cz', 'Czech Republic', 0, 1, 2, 2, 6, 0]],
  B: [['ch', 'Switzerland', 2, 1, 0, 7, 3, 1], ['ca', 'Canada', 1, 1, 1, 8, 3, 1], ['ba', 'Bosnia and Herz.', 1, 1, 1, 5, 6, 1], ['qa', 'Qatar', 0, 1, 2, 2, 10, 0]],
  C: [['br', 'Brazil', 2, 1, 0, 7, 1, 1], ['ma', 'Morocco', 2, 1, 0, 6, 3, 1], ['gb-sct', 'Scotland', 1, 0, 2, 1, 4, 0], ['ht', 'Haiti', 0, 0, 3, 2, 8, 0]],
  D: [['us', 'USA', 2, 0, 1, 8, 4, 1], ['au', 'Australia', 1, 1, 1, 2, 2, 1], ['py', 'Paraguay', 1, 1, 1, 2, 4, 1], ['tr', 'Turkey', 1, 0, 2, 3, 5, 0]],
  G: [['be', 'Belgium', 1, 2, 0, 6, 2, 1], ['eg', 'Egypt', 1, 2, 0, 5, 3, 1], ['ir', 'Iran', 0, 3, 0, 3, 3, 0], ['nz', 'New Zealand', 0, 1, 2, 4, 10, 0]],
  H: [['es', 'Spain', 2, 1, 0, 5, 0, 1], ['cv', 'Cape Verde', 0, 3, 0, 2, 2, 1], ['uy', 'Uruguay', 0, 2, 1, 3, 4, 0], ['sa', 'Saudi Arabia', 0, 2, 1, 1, 5, 0]],
  I: [['fr', 'France', 3, 0, 0, 10, 2, 1], ['no', 'Norway', 2, 0, 1, 8, 7, 1], ['sn', 'Senegal', 1, 0, 2, 8, 6, 1], ['iq', 'Iraq', 0, 0, 3, 1, 12, 0]],
  J: [['ar', 'Argentina', 3, 0, 0, 8, 1, 1], ['at', 'Austria', 1, 1, 1, 6, 6, 1], ['dz', 'Algeria', 1, 1, 1, 5, 7, 1], ['jo', 'Jordan', 0, 0, 3, 3, 8, 0]],
  K: [['co', 'Colombia', 2, 1, 0, 4, 1, 1], ['pt', 'Portugal', 1, 2, 0, 6, 1, 1], ['cd', 'DR Congo', 1, 1, 1, 4, 3, 1], ['uz', 'Uzbekistan', 0, 0, 3, 2, 11, 0]],
  L: [['gb-eng', 'England', 2, 1, 0, 6, 2, 1], ['hr', 'Croatia', 2, 0, 1, 5, 5, 1], ['gh', 'Ghana', 1, 1, 1, 2, 2, 1], ['pa', 'Panama', 0, 0, 3, 0, 4, 0]],
};

// --- League member history (the card back) ----------------------------------
// Exported from the LPPC history DB (fantasy-football project) 2026-07-05.
// Convention: wins/losses are regular season + playoffs combined; the league
// has never had a tie, so there is no ties field. lastSeasonFinish is the
// final 2025 standing (1 = champion). avgDraftSpot averages the yearly draft
// slot (1–12). `tenure` is display text — Andrew left and returned, so his
// seasons are NOT contiguous; never render tenure as a plain "since <year>".
// Keys MUST match member display names exactly; the card omits the history
// section for any name it can't find (never guess).
export const memberHistory = {
  Nathan:  { seasons: 7, tenure: '2019–2025', wins: 61, losses: 54, lastSeasonFinish: 1,  championships: 1, lastPlaces: 0, avgDraftSpot: 6.6 },
  James:   { seasons: 9, tenure: '2017–2025', wins: 76, losses: 73, lastSeasonFinish: 2,  championships: 0, lastPlaces: 1, avgDraftSpot: 7.8 },
  Lance:   { seasons: 9, tenure: '2017–2025', wins: 81, losses: 65, lastSeasonFinish: 3,  championships: 0, lastPlaces: 1, avgDraftSpot: 7.9 },
  Volkan:  { seasons: 9, tenure: '2017–2025', wins: 84, losses: 62, lastSeasonFinish: 4,  championships: 3, lastPlaces: 0, avgDraftSpot: 6.1 },
  Sally:   { seasons: 7, tenure: '2019–2025', wins: 49, losses: 68, lastSeasonFinish: 5,  championships: 0, lastPlaces: 0, avgDraftSpot: 5.3 },
  Jake:    { seasons: 2, tenure: '2024–2025', wins: 17, losses: 17, lastSeasonFinish: 6,  championships: 0, lastPlaces: 0, avgDraftSpot: 8.0 },
  Tyler:   { seasons: 9, tenure: '2017–2025', wins: 87, losses: 58, lastSeasonFinish: 7,  championships: 3, lastPlaces: 0, avgDraftSpot: 7.2 },
  Andrew:  { seasons: 5, tenure: '2017–18 · 2023–25', wins: 33, losses: 50, lastSeasonFinish: 8,  championships: 0, lastPlaces: 0, avgDraftSpot: 8.6 },
  Erik:    { seasons: 6, tenure: '2020–2025', wins: 54, losses: 47, lastSeasonFinish: 9,  championships: 1, lastPlaces: 1, avgDraftSpot: 7.7 },
  Kyle:    { seasons: 9, tenure: '2017–2025', wins: 63, losses: 85, lastSeasonFinish: 10, championships: 0, lastPlaces: 2, avgDraftSpot: 5.8 },
  Josh:    { seasons: 9, tenure: '2017–2025', wins: 70, losses: 79, lastSeasonFinish: 11, championships: 0, lastPlaces: 0, avgDraftSpot: 5.1 },
  Commish: { seasons: 9, tenure: '2017–2025', wins: 79, losses: 68, lastSeasonFinish: 12, championships: 1, lastPlaces: 1, avgDraftSpot: 4.0 },
};
