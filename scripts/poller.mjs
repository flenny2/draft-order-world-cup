// =============================================================================
// poller.mjs — the ONLY component that talks to football APIs. Design: AUTOMATION.md.
// =============================================================================
// Runs in GitHub Actions (Node 22, zero dependencies). Fetches World Cup scores
// from football-data.org v4 and PATCHes targeted paths in the RTDB — never
// whole-state writes, so it cannot clobber a concurrent admin edit (store.js
// writes all of /state; worst case the poller re-converges next cycle).
//
// Every trigger runs the same script; it decides for itself whether to loop
// (a match is live or imminent → poll every 60s) or do one pass and exit.
//
// Safety model:
//   - DRY_RUN (default ON — only DRY_RUN=0 writes): logs every intended write,
//     touches nothing, needs no Firebase credential.
//   - Kill switch: live mode requires /automation/enabled === true (admin-only
//     writable) and exits immediately when it isn't.
//   - A match already status='final' in the DB is NEVER touched — admin wins.
//   - Auto-final double-check: FINISHED must be seen twice (≥1 cycle apart)
//     with the identical result before status flips to 'final'.
//   - Winner propagation reuses the app's own resolveBracket (engine.js) — the
//     same code path store.js runs, so no drift.
//
// Env: FOOTBALL_DATA_KEY (required) · POLLER_EMAIL/POLLER_PASSWORD (writes only)
//      DRY_RUN=0 to enable writes · MAX_MINUTES (loop cap, default 240)
//      FIXTURE_FILE=path (test seam: read API payload from a file, no network)
// =============================================================================

import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { resolveBracket } from '../engine.js';
import { bracketTopology, teams } from '../data.js';

const DB_URL = 'https://draft-order-world-cup-26-default-rtdb.firebaseio.com';
const API_URL = 'https://api.football-data.org/v4/competitions/WC/matches';
// Public web API key from store.js firebaseConfig — NOT a secret (protection is
// the database rules); needed here to exchange the poller's email/password for
// an ID token via the Identity Toolkit REST API.
const FIREBASE_WEB_KEY = 'AIzaSyCU231lzJjoqcUo4r8Isxw8AHT-InlieqQ';

const STAGE_BY_ROUND = {
  R16: 'LAST_16', QF: 'QUARTER_FINALS', SF: 'SEMI_FINALS',
  '3rd': 'THIRD_PLACE', Final: 'FINAL',
};
const STATUS_RANK = { scheduled: 0, in_progress: 1, final: 2 };
const POLL_SECONDS = 60;
const IMMINENT_MIN = 15;  // start looping this many minutes before kickoff
const WINDOW_MIN = 210;   // ...and keep the window open this long after (ET + pens)

// --- pure helpers (exported for poller.test.js) -----------------------------

export function mapStatus(apiStatus) {
  if (apiStatus === 'SCHEDULED' || apiStatus === 'TIMED') return 'scheduled';
  if (apiStatus === 'IN_PLAY' || apiStatus === 'PAUSED') return 'in_progress';
  if (apiStatus === 'FINISHED' || apiStatus === 'AWARDED') return 'final';
  return null; // POSTPONED / SUSPENDED / CANCELLED — never write these blind
}

// API team → our team id. TLAs are FIFA codes for all 16 teams, so a direct id
// match should always hit; name matching is the fallback for TLA drift.
const NAME_TO_ID = new Map(teams.map((t) => [t.name.toLowerCase(), t.id]));
NAME_TO_ID.set('united states', 'USA');
NAME_TO_ID.set('united states of america', 'USA');
export function teamIdFromApi(apiTeam) {
  if (!apiTeam) return null;
  if (apiTeam.tla && teams.some((t) => t.id === apiTeam.tla)) return apiTeam.tla;
  return NAME_TO_ID.get(String(apiTeam.name || '').toLowerCase()) ?? null;
}

// Result in API home/away terms. For shootouts our engine records the
// END-OF-ET DRAW as the score (pens only decide advancement), and v4's score
// object varies in whether fullTime includes shootout goals — so derive the
// draw defensively and refuse to write anything we can't prove is a draw.
export function extractResult(api) {
  const problems = [];
  const status = mapStatus(api.status);
  if (!status) problems.push(`unhandled API status ${api.status}`);
  const s = api.score || {};
  const ft = s.fullTime || {};
  let home = null; let away = null; let pens = false; let penSide = null;
  if (s.duration === 'PENALTY_SHOOTOUT') {
    pens = true;
    const rt = s.regularTime; const et = s.extraTime; const p = s.penalties;
    if (ft.home != null && ft.home === ft.away) { home = ft.home; away = ft.away; }
    else if (rt?.home != null && et?.home != null && rt.home + et.home === rt.away + et.away) {
      home = rt.home + et.home; away = rt.away + et.away;
    } else if (ft.home != null && p?.home != null && ft.home - p.home === ft.away - p.away) {
      home = ft.home - p.home; away = ft.away - p.away; // fullTime included the shootout
    } else problems.push('pens match: cannot derive the end-of-ET draw from the score object');
    if (s.winner === 'HOME_TEAM') penSide = 'HOME';
    else if (s.winner === 'AWAY_TEAM') penSide = 'AWAY';
    else problems.push('pens match without a shootout winner');
  } else if (ft.home != null && ft.away != null) { home = ft.home; away = ft.away; }
  if (status === 'final' && home == null) problems.push('finished but no usable score');
  return { status, home, away, pens, penSide, problems };
}

// Which API side is our teamA? Returns { homeId, awayId, flipped, conflict,
// inert }. inert = API teams still TBD (nothing result-shaped can be written).
export function orient(api, our) {
  const homeId = teamIdFromApi(api.homeTeam);
  const awayId = teamIdFromApi(api.awayTeam);
  if (!homeId || !awayId) return { homeId, awayId, flipped: false, conflict: false, inert: true };
  let flipped = null;
  if (our.teamA === homeId || our.teamB === awayId) flipped = false;
  else if (our.teamA === awayId || our.teamB === homeId) flipped = true;
  else if (!our.teamA && !our.teamB) flipped = false; // adopt API order
  if (flipped === null) return { homeId, awayId, flipped: false, conflict: true, inert: false };
  return { homeId, awayId, flipped, conflict: false, inert: false };
}

// Join our matches to API fixtures on kickoff-UTC + stage (all 16 kickoffs are
// unique). Existing entries are kept — the join runs once per match, ever.
export function buildFixtureMap(ourMatches, apiMatches, existing = {}) {
  const map = { ...existing };
  const problems = [];
  let added = 0;
  for (const m of ourMatches) {
    if (map[m.id] != null) continue;
    const stage = STAGE_BY_ROUND[m.round];
    const ko = Date.parse(m.datetimeISO);
    const cands = apiMatches.filter((a) => a.stage === stage && Date.parse(a.utcDate) === ko);
    if (cands.length !== 1) {
      problems.push(`${m.id}: ${cands.length === 0 ? 'no' : cands.length} API fixture(s) at ${m.datetimeISO} (${stage})`);
      continue;
    }
    const a = cands[0];
    // When both sides know the teams, they must agree (in either order).
    const apiSet = [teamIdFromApi(a.homeTeam), teamIdFromApi(a.awayTeam)];
    if (m.teamA && m.teamB && apiSet[0] && apiSet[1]
        && !(apiSet.includes(m.teamA) && apiSet.includes(m.teamB))) {
      problems.push(`${m.id}: kickoff matches API ${a.id} but teams disagree (${apiSet.join('/')} vs ${m.teamA}/${m.teamB})`);
      continue;
    }
    map[m.id] = a.id;
    added++;
  }
  return { map, problems, added };
}

const eqNull = (a, b) => (a ?? null) === (b ?? null);
const eqJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One poll cycle, as a pure plan: given the DB state, the API payload, and the
// pending-final markers, decide every write. No I/O — fully unit-testable.
export function planCycle({ state, apiMatches, fixtureMap, pending, nowMs }) {
  const matches = state.matches;
  const apiById = new Map(apiMatches.map((a) => [a.id, a]));
  const newPending = { ...pending };
  const writes = [];
  const problems = [];
  const next = matches.map((m) => ({ ...m })); // post-patch view for resolveBracket

  matches.forEach((m, idx) => {
    const a = apiById.get(fixtureMap[m.id]);
    if (!a) return;
    if (m.status === 'final') { delete newPending[m.id]; return; } // admin's domain now
    const r = extractResult(a);
    for (const p of r.problems) problems.push(`${m.id}: ${p}`);
    const o = orient(a, m);
    if (o.conflict) {
      problems.push(`${m.id}: API teams ${o.homeId}/${o.awayId} conflict with DB ${m.teamA}/${m.teamB} — skipped`);
      return;
    }

    const patch = {};
    if (!o.inert) {
      const wantA = o.flipped ? o.awayId : o.homeId;
      const wantB = o.flipped ? o.homeId : o.awayId;
      if (!m.teamA && wantA) patch.teamA = wantA;
      if (!m.teamB && wantB) patch.teamB = wantB;
    }

    let scoreA = null; let scoreB = null; let penWinner = null;
    if (r.home != null && !o.inert) {
      scoreA = o.flipped ? r.away : r.home;
      scoreB = o.flipped ? r.home : r.away;
    }
    if (r.pens && r.penSide && !o.inert) {
      penWinner = r.penSide === 'HOME' ? o.homeId : o.awayId;
    }

    // Auto-final double-check: FINISHED must repeat with the identical result.
    let desired = r.status;
    if (desired === 'final') {
      if (scoreA == null || (r.pens && !penWinner)) {
        desired = 'in_progress'; // incomplete result — never finalize on it
      } else {
        const result = { scoreA, scoreB, pens: r.pens, penWinner };
        const pend = pending[m.id];
        if (pend && eqJson(pend.result, result)) delete newPending[m.id];
        else { newPending[m.id] = { seenAt: new Date(nowMs).toISOString(), result }; desired = 'in_progress'; }
      }
    } else {
      delete newPending[m.id]; // API backed off FINISHED — restart the check
    }

    if (scoreA != null && (!eqNull(m.scoreA, scoreA) || !eqNull(m.scoreB, scoreB))) {
      patch.scoreA = scoreA; patch.scoreB = scoreB;
    }
    if (r.pens && !o.inert) {
      if (!m.decidedByPens) patch.decidedByPens = true;
      if (penWinner && !eqNull(m.penWinner, penWinner)) patch.penWinner = penWinner;
    }
    // Status only moves forward (scheduled → in_progress → final); an API
    // glitch back to SCHEDULED mid-match must not downgrade us.
    if (desired && STATUS_RANK[desired] > STATUS_RANK[m.status]) patch.status = desired;

    if (Object.keys(patch).length) {
      writes.push({
        method: 'PATCH', path: `state/matches/${idx}`, data: patch,
        label: `${m.id} ${m.teamA ?? '?'}–${m.teamB ?? '?'}`,
        prev: Object.fromEntries(Object.keys(patch).map((k) => [k, m[k] ?? null])),
        matchId: m.id,
      });
      Object.assign(next[idx], patch);
    }
  });

  // Feed winners downstream with the app's own engine — same code store.js runs.
  const resolved = resolveBracket(next, bracketTopology);
  resolved.forEach((rm, idx) => {
    const slotPatch = {};
    for (const side of ['teamA', 'teamB']) {
      if (!eqNull(rm[side], next[idx][side])) slotPatch[side] = rm[side] ?? null;
    }
    if (Object.keys(slotPatch).length) {
      writes.push({
        method: 'PATCH', path: `state/matches/${idx}`, data: slotPatch,
        label: `${next[idx].id} bracket slots`, matchId: next[idx].id,
        prev: Object.fromEntries(Object.keys(slotPatch).map((k) => [k, next[idx][k] ?? null])),
      });
    }
  });

  // Keep looping while anything is live, imminent, or awaiting final confirmation.
  const mappedApiIds = new Set(Object.values(fixtureMap));
  const anyLive = apiMatches.some((a) => mappedApiIds.has(a.id) && (a.status === 'IN_PLAY' || a.status === 'PAUSED'));
  const anyWindow = matches.some((m) => {
    if (m.status === 'final') return false;
    const ko = Date.parse(m.datetimeISO);
    return nowMs >= ko - IMMINENT_MIN * 60000 && nowMs <= ko + WINDOW_MIN * 60000;
  });
  const active = anyLive || anyWindow || Object.keys(newPending).length > 0;

  return { writes, newPending, problems, active };
}

// --- I/O ---------------------------------------------------------------------

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, opts = {}, what = url) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
  return res.json();
}

async function fetchApiMatches() {
  if (process.env.FIXTURE_FILE) { // test seam — no network
    const raw = JSON.parse(readFileSync(process.env.FIXTURE_FILE, 'utf8'));
    return raw.matches ?? raw;
  }
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) throw new Error('FOOTBALL_DATA_KEY is not set (GitHub Actions secret missing?)');
  const data = await fetchJson(API_URL, { headers: { 'X-Auth-Token': key } }, 'football-data.org');
  const stages = new Set(Object.values(STAGE_BY_ROUND));
  return (data.matches ?? []).filter((a) => stages.has(a.stage));
}

// Poller auth: sign in as the dedicated poller user (least privilege — see
// AUTOMATION.md §1). Tokens last 1h; re-auth proactively at 50 min.
let tokenCache = { token: null, at: 0 };
async function ensureToken() {
  if (tokenCache.token && Date.now() - tokenCache.at < 50 * 60000) return tokenCache.token;
  const email = process.env.POLLER_EMAIL; const password = process.env.POLLER_PASSWORD;
  if (!email || !password) throw new Error('POLLER_EMAIL / POLLER_PASSWORD not set — cannot write');
  const data = await fetchJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_WEB_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }) },
    'firebase sign-in',
  );
  tokenCache = { token: data.idToken, at: Date.now() };
  return tokenCache.token;
}

async function dbRead(path) {
  return fetchJson(`${DB_URL}/${path}.json`, {}, `DB read ${path}`);
}

async function dbWrite(method, path, data, dryRun) {
  if (dryRun) { log(`[DRY] ${method} /${path}`, JSON.stringify(data)); return; }
  const token = await ensureToken();
  const res = await fetch(`${DB_URL}/${path}.json?auth=${token}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  if (res.status === 401) { // token rejected mid-flight — one fresh retry
    tokenCache = { token: null, at: 0 };
    return dbWrite(method, path, data, dryRun);
  }
  if (!res.ok) throw new Error(`DB ${method} ${path}: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
  log(`${method} /${path}`, JSON.stringify(data));
}

const asArray = (x) => (Array.isArray(x) ? x : x ? Object.values(x) : []);

async function runCycle(dryRun) {
  const automation = (await dbRead('automation')) ?? {};
  if (!dryRun && automation.enabled !== true) {
    log('kill switch: /automation/enabled !== true — exiting without writes');
    process.exit(0);
  }
  const rawState = await dbRead('state');
  const state = { ...rawState, matches: asArray(rawState?.matches) };
  const apiMatches = await fetchApiMatches();

  const { map, problems: mapProblems, added } =
    buildFixtureMap(state.matches, apiMatches, automation.fixtureMap ?? {});
  for (const p of mapProblems) log('MAP:', p);
  if (added) await dbWrite('PATCH', 'automation/fixtureMap', map, dryRun);

  const pending = automation.pendingFinal ?? {};
  const plan = planCycle({ state, apiMatches, fixtureMap: map, pending, nowMs: Date.now() });
  for (const p of plan.problems) log('PROBLEM:', p);

  for (const w of plan.writes) {
    log(`${dryRun ? '[DRY] would write' : 'writing'}: ${w.label} — ${JSON.stringify(w.data)} (was ${JSON.stringify(w.prev)})`);
    await dbWrite(w.method, w.path, w.data, dryRun);
    await dbWrite('POST', 'automation/log', {
      at: new Date().toISOString(), matchId: w.matchId, path: w.path, patch: w.data, prev: w.prev,
    }, dryRun);
  }
  if (plan.writes.length) {
    await dbWrite('PUT', 'state/meta/lastUpdated', new Date().toISOString(), dryRun);
  }
  if (!eqJson(pending, plan.newPending)) {
    await dbWrite('PUT', 'automation/pendingFinal', plan.newPending, dryRun);
  }
  await dbWrite('PUT', 'automation/lastRun', {
    at: new Date().toISOString(), dryRun, writes: plan.writes.length, problems: plan.problems.length,
  }, dryRun);
  return plan;
}

async function main() {
  const dryRun = process.env.DRY_RUN !== '0'; // writes require an explicit opt-in
  const maxMs = Number(process.env.MAX_MINUTES || 240) * 60000;
  const deadline = Date.now() + maxMs;
  log(`poller start — ${dryRun ? 'DRY RUN (no writes)' : 'LIVE (writes enabled)'}`);

  let failures = 0;
  for (;;) {
    let active = false;
    try {
      const plan = await runCycle(dryRun);
      active = plan.active;
      failures = 0;
      log(`cycle done — ${plan.writes.length} write(s), ${plan.problems.length} problem(s), active=${active}`);
    } catch (e) {
      failures++;
      log(`cycle FAILED (${failures}): ${e.message}`);
      if (failures >= 3) { log('3 consecutive failures — giving up'); process.exit(1); }
      active = true; // retry
    }
    if (!active) { log('nothing live or imminent — single pass complete'); break; }
    if (Date.now() + POLL_SECONDS * 1000 > deadline) { log('MAX_MINUTES reached — stopping'); break; }
    await sleep(POLL_SECONDS * 1000);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
