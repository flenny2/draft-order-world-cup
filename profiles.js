// =============================================================================
// profiles.js — sticker-card data (DATA layer, static facts only)
// =============================================================================
// Authored 2026-07-05. Facts are static by design; the one thing that changes
// during the tournament — each team's "2026 so far" summary — lives in the DB
// at /state/summaries/<teamId> and is edited from #admin (see store.js).
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
    groupFinish: 'Won Group J', groupRecord: 'W3 D0 L0 · 8–1',
    appearances: 19, debut: 1930, titles: 3,
    bestFinish: 'Champions — 1978 · 1986 · 2022',
    keyPlayers: ['Lionel Messi (c)', 'Julián Alvarez', 'Enzo Fernández'],
    note: 'Defending champions.',
  },
  BEL: {
    groupFinish: 'Won Group G', groupRecord: 'W1 D2 L0 · 6–2',
    appearances: 15, debut: 1930, titles: 0,
    bestFinish: 'Third place — 2018',
    keyPlayers: ['Kevin De Bruyne', 'Jérémy Doku', 'Romelu Lukaku'],
  },
  BRA: {
    groupFinish: 'Won Group C', groupRecord: 'W2 D1 L0 · 7–1',
    appearances: 23, debut: 1930, titles: 5,
    bestFinish: 'Champions — 1958 · 1962 · 1970 · 1994 · 2002',
    keyPlayers: ['Vinícius Júnior', 'Raphinha', 'Neymar'],
    note: 'The only nation to appear at all 23 World Cups.',
  },
  CAN: {
    groupFinish: '2nd in Group B', groupRecord: 'W1 D1 L1 · 8–3',
    appearances: 3, debut: 1986, titles: 0,
    bestFinish: 'Round of 16 — 2026',
    keyPlayers: ['Alphonso Davies (c)', 'Jonathan David', 'Tajon Buchanan'],
    note: 'Co-host — and this run is already Canada’s best World Cup ever.',
  },
  COL: {
    groupFinish: 'Won Group K', groupRecord: 'W2 D1 L0 · 4–1',
    appearances: 7, debut: 1962, titles: 0,
    bestFinish: 'Quarter-finals — 2014',
    keyPlayers: ['Luis Díaz', 'James Rodríguez (c)', 'Richard Ríos'],
  },
  EGY: {
    groupFinish: '2nd in Group G', groupRecord: 'W1 D2 L0 · 5–3',
    appearances: 4, debut: 1934, titles: 0,
    bestFinish: 'Round of 16 — 2026',
    keyPlayers: ['Mohamed Salah (c)', 'Omar Marmoush', 'Emam Ashour'],
    note: 'First-ever knockout stage — beat Australia on penalties to get here.',
  },
  ENG: {
    groupFinish: 'Won Group L', groupRecord: 'W2 D1 L0 · 6–2',
    appearances: 17, debut: 1950, titles: 1,
    bestFinish: 'Champions — 1966',
    keyPlayers: ['Harry Kane (c)', 'Jude Bellingham', 'Bukayo Saka'],
  },
  FRA: {
    groupFinish: 'Won Group I', groupRecord: 'W3 D0 L0 · 10–2',
    appearances: 17, debut: 1930, titles: 2,
    bestFinish: 'Champions — 1998 · 2018',
    keyPlayers: ['Kylian Mbappé (c)', 'Ousmane Dembélé', 'Michael Olise'],
  },
  MEX: {
    groupFinish: 'Won Group A', groupRecord: 'W3 D0 L0 · 6–0',
    appearances: 18, debut: 1930, titles: 0,
    bestFinish: 'Quarter-finals — 1970 · 1986',
    keyPlayers: ['Edson Álvarez (c)', 'Santiago Giménez', 'Raúl Jiménez'],
    note: 'Co-host. Both quarter-final runs also came on home soil.',
  },
  MAR: {
    groupFinish: '2nd in Group C', groupRecord: 'W2 D1 L0 · 6–3',
    appearances: 7, debut: 1970, titles: 0,
    bestFinish: 'Fourth place — 2022',
    keyPlayers: ['Achraf Hakimi (c)', 'Brahim Díaz', 'Yassine Bounou'],
    note: 'First African team ever to reach a World Cup semi-final (2022).',
  },
  NOR: {
    groupFinish: '2nd in Group I', groupRecord: 'W2 D0 L1 · 8–7',
    appearances: 4, debut: 1938, titles: 0,
    bestFinish: 'Round of 16 — 1938 · 1998 · 2026',
    keyPlayers: ['Erling Haaland', 'Martin Ødegaard (c)', 'Alexander Sørloth'],
    note: 'First World Cup since 1998.',
  },
  PAR: {
    groupFinish: '3rd in Group D — through as a best third place', groupRecord: 'W1 D1 L1 · 2–4',
    appearances: 9, debut: 1930, titles: 0,
    bestFinish: 'Quarter-finals — 2010',
    keyPlayers: ['Miguel Almirón', 'Julio Enciso', 'Gustavo Gómez (c)'],
    note: 'Knocked out Germany on penalties in the Round of 32.',
  },
  POR: {
    groupFinish: '2nd in Group K', groupRecord: 'W1 D2 L0 · 6–1',
    appearances: 9, debut: 1966, titles: 0,
    bestFinish: 'Third place — 1966',
    keyPlayers: ['Cristiano Ronaldo (c)', 'Bruno Fernandes', 'Bernardo Silva'],
  },
  ESP: {
    groupFinish: 'Won Group H', groupRecord: 'W2 D1 L0 · 5–0',
    appearances: 17, debut: 1934, titles: 1,
    bestFinish: 'Champions — 2010',
    keyPlayers: ['Lamine Yamal', 'Pedri', 'Rodri (c)'],
  },
  SUI: {
    groupFinish: 'Won Group B', groupRecord: 'W2 D1 L0 · 7–3',
    appearances: 13, debut: 1934, titles: 0,
    bestFinish: 'Quarter-finals — 1934 · 1938 · 1954',
    keyPlayers: ['Granit Xhaka (c)', 'Manuel Akanji', 'Breel Embolo'],
  },
  USA: {
    groupFinish: 'Won Group D', groupRecord: 'W2 D0 L1 · 8–4',
    appearances: 12, debut: 1930, titles: 0,
    bestFinish: 'Third place — 1930',
    keyPlayers: ['Christian Pulisic', 'Weston McKennie', 'Folarin Balogun'],
    note: 'Co-host of this World Cup.',
  },
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
