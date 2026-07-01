// =============================================================================
// report.js — PURE: the plain-text league-update generator (iMessage output).
// =============================================================================
// Output is PLAIN TEXT with NO markdown — it gets pasted straight into a group
// chat. Uses the engine for the order; diffs against a caller-supplied baseline
// snapshot to describe "what changed since last update". `now` is passed in so the
// function stays pure/testable. No DOM, no store, no ruleset logic of its own.
// =============================================================================

import { computeDraftOrder } from './engine.js';

// A compact, serializable picture of the current order — this is what gets stored
// as the "last update" baseline and diffed on the next run.
export function snapshot(state) {
  const { picks } = computeDraftOrder({ ...state, includeProvisional: true });
  return picks.map((p) => ({
    memberId: p.member.id,
    name: p.member.name,
    team: p.team ? p.team.name : null,
    pick: p.pickNumber,
    locked: p.locked,
    alive: p.alive,
  }));
}

// Build the plain-text update. `baseline` is a previous snapshot() (or null on the
// first ever update). `url` is the public link. Returns a string ready to copy.
export function formatUpdate({ state, baseline, url, now }) {
  const snap = snapshot(state);
  const date = new Date(now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const L = [];

  L.push(`WORLD CUP DRAFT ORDER — ${date}`);
  L.push('');
  L.push('CURRENT ORDER (if scores hold)');
  for (const p of snap) {
    const tag = p.locked ? ' [LOCKED]' : p.alive ? ' [still alive]' : '';
    L.push(`${p.pick}. ${p.name} - ${p.team ?? 'unassigned'}${tag}`);
  }
  L.push('');

  if (baseline && baseline.length) {
    const prev = new Map(baseline.map((b) => [b.memberId, b]));
    const changes = [];
    for (const p of snap) {
      const b = prev.get(p.memberId);
      if (!b) continue;
      if (b.pick !== p.pick) {
        const dir = p.pick < b.pick ? 'up' : 'down';
        changes.push(`${p.name}: pick ${b.pick} -> ${p.pick} (${dir} ${Math.abs(b.pick - p.pick)})`);
      } else if (!b.locked && p.locked) {
        changes.push(`${p.name}: pick ${p.pick} is now LOCKED`);
      }
    }
    L.push('SINCE LAST UPDATE');
    if (changes.length) changes.forEach((c) => L.push(`- ${c}`));
    else L.push('- No changes.');
    L.push('');
  }

  const open = snap.filter((p) => !p.locked);
  L.push('STILL IN CONTENTION');
  if (open.length) L.push(`- ${open.length} pick${open.length === 1 ? '' : 's'} not locked: ${open.map((p) => p.name).join(', ')}`);
  else L.push('- All 12 picks locked. Final!');
  L.push('');

  if (url) L.push(`Live order: ${url}`);
  return L.join('\n');
}
