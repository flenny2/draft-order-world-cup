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

// Finish bands, BEST → WORST. ALIVE = finish not yet determined (still advancing,
// or an SF loser awaiting the 3rd-place game). ALIVE sorts to the TOP because an
// alive team can still finish anywhere up to champion.
export const BAND_RANK = {
  ALIVE: 0,
  CHAMPION: 1,
  RUNNER_UP: 2,
  THIRD: 3,
  FOURTH: 4,
  QF_LOSERS: 5,
  R16_LOSERS: 6,
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

  if (match.decidedByPens) {
    if (!match.penWinner) return null; // pens flagged but no winner recorded yet
    const winner = match.penWinner;
    return { winner, loser: winner === match.teamA ? match.teamB : match.teamA };
  }
  if (match.scoreA == null || match.scoreB == null) return null;
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
//  - SF     → not banded here: the SF loser plays the 3rd-place game, so it stays
//             ALIVE (3rd or 4th undetermined) until that game resolves.
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
      case 'SF':
        break; // intentionally not banded — see note above
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
// teams above it is frozen. Both conditions reduce to "a whole round is final":
//   R16-losers  ← all 8 R16 final  (the 8 advancing teams above are then fixed)
//   QF-losers   ← all 4 QF final   (the 4 QF winners finish 1st–4th regardless of SF/Final)
//   3rd / 4th   ← 3rd-place final  (implies SFs final, so the 2 finalists' count is frozen)
//   champ / RU  ← Final final
// A lower band can therefore lock BEFORE a higher one. Locked picks never move
// under any remaining or in-progress result (invariant #5).
function roundAllFinal(matches, round) {
  const ms = matches.filter((m) => m.round === round);
  return ms.length > 0 && ms.every((m) => m.status === 'final');
}
function isBandLocked(bandName, matches) {
  switch (bandName) {
    case 'CHAMPION':
    case 'RUNNER_UP':
      return roundAllFinal(matches, 'Final');
    case 'THIRD':
    case 'FOURTH':
      return roundAllFinal(matches, '3rd');
    case 'QF_LOSERS':
      return roundAllFinal(matches, 'QF');
    case 'R16_LOSERS':
      return roundAllFinal(matches, 'R16');
    default:
      return false; // ALIVE never locks
  }
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
    return (a.tiebreakNumber ?? Infinity) - (b.tiebreakNumber ?? Infinity); // lower number = better pick
  }
  return (a.tiebreakNumber ?? Infinity) - (b.tiebreakNumber ?? Infinity);
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

  // Pens ⇒ the recorded score is a draw (rules 9–10); a non-pens knockout can't tie.
  for (const m of matches) {
    if (m.status !== 'final') continue;
    if (m.decidedByPens && m.scoreA != null && m.scoreB != null && m.scoreA !== m.scoreB)
      issues.push({ level: 'error', msg: `Match ${m.id}: pens means the recorded score is the end-of-ET draw — scores must be equal.` });
    if (m.decidedByPens && !m.penWinner)
      issues.push({ level: 'warn', msg: `Match ${m.id}: marked pens but no shootout winner chosen.` });
    if (!m.decidedByPens && m.scoreA != null && m.scoreA === m.scoreB)
      issues.push({ level: 'warn', msg: `Match ${m.id}: a knockout can't end level — set a winner or mark pens.` });
  }
  return issues;
}
