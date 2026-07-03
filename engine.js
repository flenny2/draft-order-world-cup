// =============================================================================
// engine.js — PURE LOGIC: ruleset → draft order (the heart of the app)
// =============================================================================
// Data in (teams + members[with assignments & tiebreak numbers] + matches) →
// draft order out. NO DOM. NO Firebase. NO Date.now / Math.random in the compute
// path (determinism — invariant #4). Importable under Node for the test harness.
//
// Presentation reads this output and NEVER re-implements ruleset logic. If a rule
// changes, it changes HERE. The canonical rules live in claude.md §THE RULESET.
// =============================================================================

// Finish bands, BEST → WORST. ALIVE = finish not yet determined; it sorts to the
// TOP because a genuinely alive team can still finish anywhere up to champion.
// SF_LOSER = lost a semifinal: guaranteed 3rd or 4th pending the 3rd-place game,
// so it is NOT alive — it can no longer beat the finalists and must rank below
// them (otherwise a champ/RU pick locked by the Final would be displaced when
// the 3rd-place game resolves).
export const BAND_RANK = {
  ALIVE: 0,
  CHAMPION: 1,
  RUNNER_UP: 2,
  SF_LOSER: 3,
  THIRD: 4,
  FOURTH: 5,
  QF_LOSERS: 6,
  R16_LOSERS: 7,
};

// The two bands where the ruleset tiebreaker (GD → GF → tiebreak number) applies.
// A tiebreak comparison happens ONLY inside one of these, between two assigned
// teams in the SAME band (invariant #2).
const LOSER_BANDS = new Set(['QF_LOSERS', 'R16_LOSERS']);

// Teams with no member holding their id are out of play — derived, not stored,
// so there is a single source of truth for "who's assigned".
export function getUnassignedTeams(teams, members) {
  const held = new Set(members.map((m) => m.teamId).filter(Boolean));
  return teams.filter((t) => !held.has(t.id));
}

// --- Match outcome ---------------------------------------------------------
// Returns { winner, loser, loserGD, loserGF } for a match whose result is usable,
// else null (undetermined — e.g. TBD teams, a tied in-progress match, or a not-yet-
// final match when we only count settled results).
//
// PENS = DRAW (rules 9–10, the most error-prone rule):
//  - When decidedByPens, the recorded scoreA/scoreB is the END-OF-ET draw; the
//    shootout only decides advancement. So winner/loser come from `penWinner`,
//    NEVER from comparing scores, and the loser's match GD is 0 (a draw) — which
//    correctly ranks a pens-loser ABOVE any regulation loser (GD ≤ −1) in its band.
// Decide ONLY who advanced (the pens-aware part), or null if undetermined. Shared
// by both ranking (matchOutcome) and bracket auto-populate (matchWinnerLoser) so
// there is exactly one place that knows "who won", shootouts included.
function decide(match, { includeProvisional }) {
  const usable =
    match.status === 'final' ||
    (includeProvisional && match.status === 'in_progress');
  if (!usable) return null;
  if (match.teamA == null || match.teamB == null) return null; // slot still TBD
  // BOTH branches need the recorded score — the loser's GD/GF come from it — so
  // a match missing a score is still undetermined, even a pens match with the
  // shootout winner already chosen (else GD is computed from null arithmetic).
  if (match.scoreA == null || match.scoreB == null) return null;

  if (match.decidedByPens) {
    if (!match.penWinner) return null; // pens flagged but no winner recorded yet
    const winner = match.penWinner;
    return { winner, loser: winner === match.teamA ? match.teamB : match.teamA };
  }
  if (match.scoreA === match.scoreB) return null; // tied, no shootout → no loser yet
  return match.scoreA > match.scoreB
    ? { winner: match.teamA, loser: match.teamB }
    : { winner: match.teamB, loser: match.teamA };
}

function matchOutcome(match, opts) {
  const d = decide(match, opts);
  if (!d) return null;
  // Loser stats from the RECORDED (end-of-ET) score — 0 GD for a pens defeat.
  const loserIsA = d.loser === match.teamA;
  const loserGoals = loserIsA ? match.scoreA : match.scoreB;
  const winnerGoals = loserIsA ? match.scoreB : match.scoreA;
  return { ...d, loserGD: loserGoals - winnerGoals, loserGF: loserGoals };
}

// Winner/loser of a FINAL match (or null) — for bracket auto-populate. Only final
// results advance a team into the next slot; in-progress scores never do.
export function matchWinnerLoser(match) {
  return decide(match, { includeProvisional: false });
}

// --- Classify every team into its finish band ------------------------------
// Each team has exactly one terminal result, so these assignments never collide:
//  - Final  → winner CHAMPION, loser RUNNER_UP
//  - 3rd    → winner THIRD,    loser FOURTH
//  - QF     → loser QF_LOSERS  (with match stats)
//  - R16    → loser R16_LOSERS (with match stats)
//  - SF     → loser SF_LOSER: it plays the 3rd-place game, so its exact finish
//             (3rd or 4th) is still open — but it ranks below the finalists
//             already. The 3rd-place result upgrades it to THIRD/FOURTH.
// Anything never recorded as a loser/champion stays ALIVE.
export function classifyTeams(teams, matches, { includeProvisional }) {
  const band = new Map();
  for (const t of teams) band.set(t.id, { band: 'ALIVE', matchGD: null, matchGF: null });

  for (const match of matches) {
    const r = matchOutcome(match, { includeProvisional });
    if (!r) continue;
    switch (match.round) {
      case 'R16':
        band.set(r.loser, { band: 'R16_LOSERS', matchGD: r.loserGD, matchGF: r.loserGF });
        break;
      case 'QF':
        band.set(r.loser, { band: 'QF_LOSERS', matchGD: r.loserGD, matchGF: r.loserGF });
        break;
      case 'SF': {
        // Don't overwrite THIRD/FOURTH if the 3rd-place game was already
        // processed — match array order must not affect the result.
        const cur = band.get(r.loser);
        if (!cur || cur.band === 'ALIVE') band.set(r.loser, { band: 'SF_LOSER', matchGD: null, matchGF: null });
        break;
      }
      case '3rd':
        band.set(r.winner, { band: 'THIRD', matchGD: null, matchGF: null });
        band.set(r.loser, { band: 'FOURTH', matchGD: null, matchGF: null });
        break;
      case 'Final':
        band.set(r.winner, { band: 'CHAMPION', matchGD: null, matchGF: null });
        band.set(r.loser, { band: 'RUNNER_UP', matchGD: null, matchGF: null });
        break;
    }
  }
  return band;
}

// --- Locking ---------------------------------------------------------------
// A band's picks lock once its internal order is fixed AND the count of assigned
// teams above it is frozen. A round counts as DECIDED only when every match in
// it has a settled outcome — status 'final' alone isn't enough (a final with a
// missing score or TBD team determines nothing yet, and must never lock).
function roundDecided(matches, round) {
  const ms = matches.filter((m) => m.round === round);
  return ms.length > 0 && ms.every((m) => matchOutcome(m, { includeProvisional: false }) !== null);
}
// Rounds that must be decided for each band to lock. The band's own round fixes
// its internal order; the EARLIER rounds are required too, because an undecided
// earlier match leaves its teams ranked above the band, and its eventual loser
// drops below — shifting the band's pick numbers. In normal chronology every
// earlier round is already final, so this is exactly the ruleset's four lock
// bullets; the extra requirements only bite on out-of-order data entry.
// Champ/RU do NOT need the 3rd-place game: SF losers rank below RUNNER_UP
// whether banded SF_LOSER or THIRD/FOURTH. A lower band can therefore still
// lock BEFORE a higher one. Locked picks never move (invariant #5).
const LOCK_NEEDS = {
  CHAMPION: ['R16', 'QF', 'SF', 'Final'],
  RUNNER_UP: ['R16', 'QF', 'SF', 'Final'],
  THIRD: ['R16', 'QF', 'SF', '3rd'],
  FOURTH: ['R16', 'QF', 'SF', '3rd'],
  QF_LOSERS: ['R16', 'QF'],
  R16_LOSERS: ['R16'],
};
function isBandLocked(bandName, matches) {
  const needs = LOCK_NEEDS[bandName];
  if (!needs) return false; // ALIVE and SF_LOSER (3rd-vs-4th still open) never lock
  return needs.every((round) => roundDecided(matches, round));
}

// --- Ranking comparator ----------------------------------------------------
// Different bands → band rank decides (band ALWAYS dominates GD/GF; tiebreaks
// never cross bands). Same loser band → ruleset tiebreak GD↓ GF↓ number↑. Other
// same-band cases (ALIVE, or the single-team top bands) are ordered by tiebreak
// number purely for a DETERMINISTIC, stable display — not a ruleset tiebreak.
function compareEntries(a, b) {
  if (BAND_RANK[a.band] !== BAND_RANK[b.band]) return BAND_RANK[a.band] - BAND_RANK[b.band];
  if (LOSER_BANDS.has(a.band)) {
    if (a.matchGD !== b.matchGD) return b.matchGD - a.matchGD; // higher (less negative) GD = better pick
    if (a.matchGF !== b.matchGF) return b.matchGF - a.matchGF; // more goals scored = better pick
  }
  const tbA = a.tiebreakNumber ?? Infinity, tbB = b.tiebreakNumber ?? Infinity; // lower number = better pick
  if (tbA !== tbB) return tbA - tbB;
  // Total-order fallback for two missing numbers (a mid-draw-entry state that
  // validate warns about): Infinity − Infinity is NaN, which sort treats as
  // "equal", so without this the order would depend on the members-array order.
  return a.member.id < b.member.id ? -1 : a.member.id > b.member.id ? 1 : 0;
}

// --- The one public entry point --------------------------------------------
// Returns { mode, picks } where picks is the 1..12 draft order (no gaps —
// unassigned teams are simply absent, lower bands slide up).
//
// MODES (one function):
//  • includeProvisional:true  → PROJECTED "if scores hold" order (settled + in-progress).
//  • includeProvisional:false → LOCKED order (final results only).
//  • HYPOTHETICAL              → just pass a what-if `matches` array (all final);
//                                read `picks`, ignore `locked`. No store access here.
// `locked` per pick is ALWAYS derived from SETTLED (final) results, so it means
// "this exact pick can't change", independent of the provisional display.
export function computeDraftOrder({ teams, members, matches, includeProvisional = true }) {
  const settledBands = classifyTeams(teams, matches, { includeProvisional: false });
  const displayBands = includeProvisional
    ? classifyTeams(teams, matches, { includeProvisional: true })
    : settledBands;

  const teamById = new Map(teams.map((t) => [t.id, t]));

  // Only the assigned teams are ever ranked (rule 3).
  const entries = members
    .filter((m) => m.teamId != null)
    .map((m) => {
      const d = displayBands.get(m.teamId) ?? { band: 'ALIVE', matchGD: null, matchGF: null };
      return {
        member: m,
        team: teamById.get(m.teamId) ?? null,
        band: d.band,
        matchGD: d.matchGD,
        matchGF: d.matchGF,
        tiebreakNumber: m.tiebreakNumber,
      };
    });

  entries.sort(compareEntries);

  const picks = entries.map((e, i) => {
    // Lock is keyed off the SETTLED band: a team only locks via a final result,
    // and when its band is locked its pick NUMBER is frozen too (count above is
    // frozen), so the projected position equals the settled position.
    const settledBand = settledBands.get(e.member.teamId)?.band ?? 'ALIVE';
    return {
      pickNumber: i + 1,
      member: { id: e.member.id, name: e.member.name },
      team: e.team,
      band: e.band,
      matchGD: e.matchGD,
      matchGF: e.matchGF,
      tiebreakNumber: e.tiebreakNumber,
      alive: e.band === 'ALIVE',
      locked: isBandLocked(settledBand, matches),
    };
  });

  return { mode: includeProvisional ? 'projected' : 'locked', picks };
}

// --- Bracket auto-populate -------------------------------------------------
// Feed each FINAL result into the slot it determines, per the fixed topology
// (from data.js). Pure: returns a NEW matches array, mutates nothing. Only
// teamA/teamB are touched — scores are never altered. A slot whose source isn't
// final yet is set back to null (TBD), so editing an upstream result correctly
// re-opens everything downstream.
//
// `topology` is keyed by matchId → { teamA?: {from:'winner'|'loser', match}, teamB?: {...} }.
// R16 slots aren't in the topology (fed by external R32 winners), so they're left
// exactly as the admin entered them. Insertion order of the topology is dependency
// order (QF before SF before Final/3rd), so a single pass propagates correctly.
export function resolveBracket(matches, topology) {
  const out = matches.map((m) => ({ ...m }));
  const byId = new Map(out.map((m) => [m.id, m]));

  for (const [matchId, wiring] of Object.entries(topology)) {
    const target = byId.get(matchId);
    if (!target) continue;
    for (const side of ['teamA', 'teamB']) {
      const src = wiring[side];
      if (!src) continue;
      const wl = matchWinnerLoser(byId.get(src.match)); // null until that match is final
      target[side] = wl ? (src.from === 'winner' ? wl.winner : wl.loser) : null;
    }
  }
  return out;
}

// --- Data validation -------------------------------------------------------
// Surfaces ruleset/data problems for the admin UI. Pure; returns [{level, msg}].
// level 'error' = breaks the ruleset; 'warn' = probably a typo worth a look.
export function validate({ members, matches }) {
  const issues = [];
  const assigned = members.filter((m) => m.teamId != null);

  // Tiebreak numbers must be distinct 1..12 among assigned teams (rule 8).
  const nums = assigned.map((m) => m.tiebreakNumber);
  if (nums.some((n) => n == null)) issues.push({ level: 'warn', msg: 'Some assigned members have no tiebreak number yet.' });
  const present = nums.filter((n) => n != null);
  if (new Set(present).size !== present.length) issues.push({ level: 'error', msg: 'Tiebreak numbers must be DISTINCT — there is a duplicate.' });
  if (present.some((n) => n < 1 || n > 12)) issues.push({ level: 'warn', msg: 'Tiebreak numbers should be in the range 1–12.' });

  // One team per member (no two members on the same team).
  const teamIds = assigned.map((m) => m.teamId);
  if (new Set(teamIds).size !== teamIds.length) issues.push({ level: 'error', msg: 'Two members are assigned the same team.' });

  // Team-slot sanity (any status): a team can't play itself, nor appear in two
  // matches of the same round — both reachable through the admin R16 selects.
  const seenByRound = new Map();
  for (const m of matches) {
    if (m.teamA != null && m.teamA === m.teamB) {
      issues.push({ level: 'error', msg: `Match ${m.id}: a team can't play itself.` });
      continue; // don't also count it as a same-round duplicate
    }
    let seen = seenByRound.get(m.round);
    if (!seen) seenByRound.set(m.round, (seen = new Set()));
    for (const t of [m.teamA, m.teamB]) {
      if (t == null) continue;
      if (seen.has(t)) issues.push({ level: 'error', msg: `Match ${m.id}: ${t} appears in two ${m.round} matches.` });
      seen.add(t);
    }
  }

  // Pens ⇒ the recorded score is a draw (rules 9–10); a non-pens knockout can't tie.
  for (const m of matches) {
    if (m.status !== 'final') continue;
    if (m.decidedByPens && m.scoreA != null && m.scoreB != null && m.scoreA !== m.scoreB)
      issues.push({ level: 'error', msg: `Match ${m.id}: pens means the recorded score is the end-of-ET draw — scores must be equal.` });
    if (m.decidedByPens && !m.penWinner)
      issues.push({ level: 'warn', msg: `Match ${m.id}: marked pens but no shootout winner chosen.` });
    if (m.decidedByPens && (m.scoreA == null || m.scoreB == null))
      issues.push({ level: 'error', msg: `Match ${m.id}: pens needs the end-of-extra-time score entered (both sides) — the loser's GD/GF come from it.` });
    if (!m.decidedByPens && m.scoreA != null && m.scoreA === m.scoreB)
      issues.push({ level: 'warn', msg: `Match ${m.id}: a knockout can't end level — set a winner or mark pens.` });
  }
  return issues;
}
