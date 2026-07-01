// =============================================================================
// schedule.js — PURE presentation-support: time/scheduling logic.
// =============================================================================
// Kept OUT of engine.js because these are clock-relative: the engine must stay
// deterministic (no Date.now). Every function here takes `now` (ms) explicitly,
// so it's pure and unit-testable; only app.js supplies the real Date.now() and
// runs the ticking countdown. No DOM, no ruleset logic.
// =============================================================================

// Absolute instant of a kickoff in ms, or null if the match has no datetime.
// The ISO string carries the venue's UTC offset, so this is unambiguous.
export function kickoffMs(match) {
  if (!match.datetimeISO) return null;
  const t = Date.parse(match.datetimeISO);
  return Number.isNaN(t) ? null : t;
}

// The match to feature as "next up":
//  1. any match currently in progress (live), else
//  2. the soonest non-final match whose kickoff is still in the future, else
//  3. the soonest non-final match overall (admin hasn't entered a late result), else
//  4. any non-final match without a time, else null (everything is final).
export function nextMatch(matches, nowMs) {
  const live = matches.find((m) => m.status === 'in_progress');
  if (live) return live;

  const pending = matches.filter((m) => m.status !== 'final');
  if (pending.length === 0) return null;

  const timed = pending
    .map((m) => ({ m, t: kickoffMs(m) }))
    .filter((x) => x.t != null)
    .sort((a, b) => a.t - b.t);

  const future = timed.filter((x) => x.t >= nowMs);
  if (future.length) return future[0].m;
  if (timed.length) return timed[0].m;
  return pending[0].m; // untimed fallback
}

// Break a remaining interval into d/h/m/s. `past` true once the target has passed.
export function countdown(targetMs, nowMs) {
  const diff = targetMs - nowMs;
  const total = Math.max(0, Math.floor(diff / 1000));
  return {
    past: diff <= 0,
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    mins: Math.floor((total % 3600) / 60),
    secs: total % 60,
  };
}

// Chronological grouping for the schedule list. Returns timed matches bucketed by
// calendar day (in the VIEWER's local zone, matching how kickoffs are displayed),
// plus any untimed matches in a trailing bucket. Each group's `day` is a Date.
export function groupByDay(matches) {
  const timed = matches
    .filter((m) => kickoffMs(m) != null)
    .sort((a, b) => kickoffMs(a) - kickoffMs(b));

  const groups = [];
  const byKey = new Map();
  for (const m of timed) {
    const day = new Date(kickoffMs(m));
    const key = day.toDateString();
    if (!byKey.has(key)) {
      const g = { key, day, items: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    byKey.get(key).items.push(m);
  }
  return { groups, undated: matches.filter((m) => kickoffMs(m) == null) };
}
