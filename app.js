// =============================================================================
// app.js — PRESENTATION. Renders engine output from the live store. Re-implements
// ZERO ruleset logic (engine.js) and ZERO time logic (schedule.js).
// =============================================================================
// Routes via the URL hash:
//   #          draft order (locked ⇄ projected toggle)
//   #schedule  chronological schedule + live countdown to the next match
//   #bracket   the knockout tree, round by round, with results
//   #admin     result-entry editor (mock-auth gated)
// "Find my team" is a per-DEVICE preference in localStorage (not the shared store).
// =============================================================================

import * as store from './store.js';
import { computeDraftOrder, getUnassignedTeams, validate, matchWinnerLoser, resolveBracket } from './engine.js';
import { bracketTopology } from './data.js';
import { kickoffMs, nextMatch, countdown, groupByDay } from './schedule.js';
import { snapshot, formatUpdate } from './report.js';

const BAND_LABEL = {
  ALIVE: 'Still alive', CHAMPION: 'Champion', RUNNER_UP: 'Runner-up', SF_LOSER: '3rd or 4th',
  THIRD: '3rd place', FOURTH: '4th place', QF_LOSERS: 'QF exit', R16_LOSERS: 'R16 exit',
};
const ROUND_LABEL = { R16: 'Round of 16', QF: 'Quarterfinal', SF: 'Semifinal', '3rd': '3rd-place game', Final: 'Final' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ME_KEY = 'wcdraft.me.v1';
const getMe = () => { try { return localStorage.getItem(ME_KEY); } catch { return null; } };
const setMe = (id) => { try { id ? localStorage.setItem(ME_KEY, id) : localStorage.removeItem(ME_KEY); } catch {} };

// Baseline for the "what changed" diff in the iMessage generator (admin device).
const BASELINE_KEY = 'wcdraft.updateBaseline.v1';
const getBaseline = () => { try { return JSON.parse(localStorage.getItem(BASELINE_KEY)); } catch { return null; } };
const setBaseline = (snap) => { try { localStorage.setItem(BASELINE_KEY, JSON.stringify(snap)); } catch {} };
const publicUrl = () => location.href.split('#')[0];

// Theme: 'day' (light — Dylan's design kit, the default) ⇄ 'night' (dark). Per device.
const THEME_KEY = 'wcdraft.theme.v1';
const getTheme = () => { try { return localStorage.getItem(THEME_KEY) || 'day'; } catch { return 'day'; } };
const setTheme = (t) => { try { localStorage.setItem(THEME_KEY, t); } catch {} };
const applyTheme = (t) => { document.documentElement.dataset.theme = t; };
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// --- module state (presentation only) --------------------------------------
let appState = store.getState();
let admin = store.isAdmin();
let viewMode = 'projected'; // 'projected' | 'locked'
let meId = getMe();
let theme = getTheme();
let tickTimer = null;
let predictions = {}; // what-if explorer sandbox: matchId -> { winner } (never written to store)
let prevLocked = new Set(); // member ids locked at last order render → drives the just-locked pulse
let celebrated = false; // fire the final-locks celebration only once per completion

const view = () => document.getElementById('view');

// lookups rebuilt per render
const teamMap = (state) => new Map(state.teams.map((t) => [t.id, t]));
const memberByTeam = (state) => { const m = new Map(); for (const x of state.members) if (x.teamId) m.set(x.teamId, x); return m; };
const myTeamId = (state) => { const m = state.members.find((x) => x.id === meId); return m ? m.teamId : null; };

// ===========================================================================
// Shared renderers
// ===========================================================================
function teamLabel(team) { return team ? `${team.flagEmoji} ${esc(team.name)}` : '<span class="tbd">— TBD —</span>'; }

function pickRow(p, { hideLock, newlyLocked } = {}) {
  const top1 = p.pickNumber === 1 ? ' top1' : '';
  const aliveCls = p.alive ? ' alive' : '';
  const mineCls = p.member.id === meId ? ' mine' : '';
  const bandCls = ` band-${p.band.toLowerCase()}`; // colours the rung on the ladder
  const pulse = !hideLock && newlyLocked && newlyLocked.has(p.member.id) ? ' just-locked' : '';
  // Tiebreak number is public (a trust feature) — show it wherever a team is drawn.
  const tb = p.tiebreakNumber != null ? `<span class="tb" title="tiebreak number (lower = better)">#${p.tiebreakNumber}</span>` : '';
  const bandTag = `<span class="band-tag${p.band === 'CHAMPION' ? ' gold' : ''}">${BAND_LABEL[p.band]}</span>`;
  const statLine = p.matchGD !== null ? `<div class="stat">elim GD ${p.matchGD >= 0 ? '+' : ''}${p.matchGD} · GF ${p.matchGF}</div>` : '';
  // In the what-if explorer, lock flags are meaningless (spec mode 3) — hide them.
  const status = hideLock ? (p.alive ? '<span class="badge-alive">Alive</span>' : '')
    : p.locked ? '<span class="badge-locked">Locked</span>'
    : p.alive ? '<span class="badge-alive">Alive</span>'
    : '<span class="badge-prov">If it stands</span>';
  return `
    <div class="pick${top1}${aliveCls}${mineCls}${pulse}${bandCls}">
      <div class="pick-num">${p.pickNumber}</div>
      <div class="pick-main">
        <div class="pick-member">${esc(p.member.name)}${mineCls ? ' <span class="you">you</span>' : ''} ${tb}</div>
        <div class="pick-team"><span class="flag">${p.team ? p.team.flagEmoji : ''}</span>${p.team ? esc(p.team.name) : 'unassigned'}</div>
      </div>
      <div class="pick-meta">${bandTag}${statLine}${status}</div>
    </div>`;
}

function orderBlock(state, mode) {
  const { picks } = computeDraftOrder({ ...state, includeProvisional: mode === 'projected' });
  if (picks.length === 0) {
    return `<div class="empty">The draw hasn't been entered yet. Once the 12 teams are assigned in
      <a href="#admin">admin</a>, the order appears here and updates live as results come in.</div>`;
  }
  return `<div class="picks">${picks.map(pickRow).join('')}</div>`;
}

// One match, shared by schedule + bracket. Bold the winner; tag whose pick each
// team is; highlight if it's the viewer's team.
function matchLine(m, state, { showTime } = {}) {
  const tm = teamMap(state);
  const mbt = memberByTeam(state);
  const wl = matchWinnerLoser(m); // final only
  const mineSet = new Set([myTeamId(state)].filter(Boolean));
  const mineCls = (mineSet.has(m.teamA) || mineSet.has(m.teamB)) ? ' mine' : '';

  const side = (teamId, score) => {
    const t = tm.get(teamId);
    const owner = mbt.get(teamId);
    const win = wl && wl.winner === teamId;
    const lose = wl && wl.loser === teamId;
    const scoreTxt = (m.status === 'final' || m.status === 'in_progress') && score != null ? `<span class="ml-score">${score}</span>` : '';
    return `<div class="ml-side${win ? ' win' : ''}${lose ? ' lose' : ''}${owner && owner.id === meId ? ' mine' : ''}">
      <span class="ml-team">${teamLabel(t)}${win ? ' <span class="adv">✓</span>' : ''}</span>
      ${owner ? `<span class="ml-owner">${esc(owner.name)}</span>` : ''}
      ${scoreTxt}
    </div>`;
  };

  const pens = m.decidedByPens && m.status === 'final' ? `<span class="ml-pens">pens: ${esc(tm.get(m.penWinner)?.name ?? '?')}</span>` : '';
  const k = kickoffMs(m);
  const timeTxt = showTime && k != null
    ? `<span class="ml-time">${new Date(k).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>`
    : '';
  const statusBadge = m.status === 'in_progress' ? '<span class="ml-live">LIVE</span>'
    : m.status === 'final' ? '<span class="ml-final">FT</span>' : '';

  return `<div class="match-line${mineCls}">
    <div class="ml-head">${ROUND_LABEL[m.round]} · #${m.id}${m.venue ? ' · ' + esc(m.venue) : ''} ${statusBadge} ${pens} ${timeTxt}</div>
    ${side(m.teamA, m.scoreA)}${side(m.teamB, m.scoreB)}
  </div>`;
}

// ===========================================================================
// Nav + "find my team" bar
// ===========================================================================
function nav() {
  const h = location.hash;
  const link = (href, label) => `<a href="${href}" class="${h === href || (href === '#' && h === '') ? 'active' : ''}">${label}</a>`;
  return `<nav class="nav">
    <div class="nav-links">${link('#', 'Order')}${link('#schedule', 'Schedule')}${link('#bracket', 'Bracket')}${link('#whatif', 'What-if')}${link('#help', 'Help')}${link('#admin', 'Admin')}</div>
    <div class="nav-actions">
      <button data-act="theme" class="icon-btn" title="Switch to ${theme === 'day' ? 'night' : 'day'} theme" aria-label="Switch theme">◐</button>
      ${admin ? '<button data-act="signout" class="link-btn">sign out</button>' : ''}
    </div>
  </nav>`;
}

// The home adapts to the tournament phase (claude.md).
const PHASE = {
  predraw: { label: 'Pre-draw', cls: '' },
  draw: { label: 'Draw set', cls: '' },
  live: { label: 'Live', cls: 'live' },
  final: { label: 'Final', cls: 'gold' },
};
function phaseOf(state, picks) {
  if (state.members.filter((m) => m.teamId).length === 0) return 'predraw';
  if (picks.length === 12 && picks.every((p) => p.locked)) return 'final';
  if (state.matches.some((m) => m.status === 'final')) return 'live';
  return 'draw';
}
function trustStamps(state) {
  return `<div class="trust">
    <span class="stamp">random.org draw</span>
    <span class="stamp">rules locked ${esc(state.meta?.rulesLockedDate ?? '—')}</span>
    <span class="stamp">tiebreak numbers public</span>
  </div>`;
}
// One-time confetti when the whole order locks. Self-contained (no library),
// cleans itself up, and respects reduced-motion.
function celebrate() {
  if (reducedMotion()) return;
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  const colors = ['#FACC15', '#6D28D9', '#C81E1E', '#FFFFFF']; // kit: yellow, violet, crimson
  for (let i = 0; i < 64; i++) {
    const s = document.createElement('span');
    s.className = 'confetti';
    s.style.left = Math.random() * 100 + '%';
    s.style.background = colors[i % colors.length];
    s.style.animationDelay = Math.random() * 0.7 + 's';
    s.style.animationDuration = 2.2 + Math.random() * 1.2 + 's';
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3600);
}

function meBar(state) {
  const me = state.members.find((x) => x.id === meId);
  if (!me) {
    return `<div class="me-bar">
      <span>Find your pick:</span>
      <select data-act="setme">
        <option value="">choose your name…</option>
        ${state.members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}
      </select>
    </div>`;
  }
  const team = state.teams.find((t) => t.id === me.teamId);
  const { picks } = computeDraftOrder({ ...state, includeProvisional: true });
  const mine = picks.find((p) => p.member.id === me.id);
  const standing = !team ? 'not assigned yet'
    : !mine ? `${team.flagEmoji} ${esc(team.name)}`
    : `${team.flagEmoji} ${esc(team.name)} · currently pick ${mine.pickNumber} ${mine.locked ? '(locked)' : mine.alive ? '(still alive)' : '(if it stands)'}`;
  return `<div class="me-bar mine">
    <span>You're <strong>${esc(me.name)}</strong> — ${standing}</span>
    <button data-act="clearme" class="link-btn">change</button>
  </div>`;
}

// ===========================================================================
// PUBLIC: draft order
// ===========================================================================
function renderOrder(state) {
  const { picks } = computeDraftOrder({ ...state, includeProvisional: viewMode === 'projected' });
  const lockedCount = picks.filter((p) => p.locked).length;
  const unassigned = getUnassignedTeams(state.teams, state.members);
  const phase = phaseOf(state, picks);

  // Just-locked diff: which picks became locked since the last order render?
  const nowLocked = new Set(picks.filter((p) => p.locked).map((p) => p.member.id));
  const newlyLocked = new Set([...nowLocked].filter((id) => !prevLocked.has(id)));

  const controls = picks.length ? `
    <div class="toggle">
      <button data-act="mode" data-mode="projected" class="${viewMode === 'projected' ? 'on' : ''}">Projected</button>
      <button data-act="mode" data-mode="locked" class="${viewMode === 'locked' ? 'on' : ''}">Locked only</button>
    </div>
    <div class="mode-banner">
      ${phase === 'final' ? '<span><strong>The order is final.</strong> Every pick is locked.</span>'
        : viewMode === 'projected' ? `<span><strong>If scores hold.</strong> ${lockedCount}/12 picks are locked; the rest can still move.</span>`
        : `<span><strong>Locked order.</strong> ${lockedCount}/12 picks can no longer change.</span>`}
    </div>` : '';

  const body = picks.length
    ? `<div class="picks ladder">${picks.map((p) => pickRow(p, { newlyLocked })).join('')}</div>`
    : `<div class="empty">The draw hasn't been entered yet. Once the 12 teams are assigned in
        <a href="#admin">admin</a>, the order appears here and updates live as results come in.</div>`;

  view().innerHTML = `
    ${nav()}${meBar(state)}
    <div class="statusline">
      <span class="phase-pill ${PHASE[phase].cls}">${PHASE[phase].label}</span>
      ${picks.length ? `<span class="lock-tally">${lockedCount}/12 locked</span>` : ''}
    </div>
    ${controls}
    ${body}
    <h2 class="section-title">Out of play — ${unassigned.length} unassigned</h2>
    <div class="unassigned">
      ${unassigned.map((t) => `<span class="chip">${t.flagEmoji} ${esc(t.name)}</span>`).join('') || '<span class="chip">—</span>'}
    </div>
    ${trustStamps(state)}`;

  prevLocked = nowLocked;
  if (phase === 'final' && !celebrated) { celebrated = true; celebrate(); }
  if (phase !== 'final') celebrated = false;
}

// ===========================================================================
// SCHEDULE + countdown
// ===========================================================================
function featuredNext(state) {
  const now = Date.now();
  const next = nextMatch(state.matches, now);
  if (!next) return `<div class="featured done">Tournament complete — the order is final.</div>`;

  const tm = teamMap(state);
  const teams = `${teamLabel(tm.get(next.teamA))} <span class="vs">v</span> ${teamLabel(tm.get(next.teamB))}`;
  const k = kickoffMs(next);
  if (next.status === 'in_progress') {
    return `<div class="featured live">
      <div class="featured-tag is-live">LIVE NOW</div>
      <div class="featured-teams">${teams}</div>
      <div class="featured-score">${next.scoreA ?? 0} – ${next.scoreB ?? 0}</div>
      <div class="featured-sub">${ROUND_LABEL[next.round]}${next.venue ? ' · ' + esc(next.venue) : ''}</div>
    </div>`;
  }
  return `<div class="featured">
    <div class="featured-tag">Next up</div>
    <div class="featured-teams">${teams}</div>
    <div class="featured-count" ${k != null ? `data-countdown="${k}"` : ''}>${k != null ? '…' : 'time TBD'}</div>
    <div class="featured-sub">${ROUND_LABEL[next.round]}${next.venue ? ' · ' + esc(next.venue) : ''}${k != null ? ' · ' + new Date(k).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</div>
  </div>`;
}

function renderSchedule(state) {
  const { groups, undated } = groupByDay(state.matches);
  const dayBlock = (g) => `
    <h2 class="section-title">${g.day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
    <div class="match-list">${g.items.map((m) => matchLine(m, state, { showTime: true })).join('')}</div>`;

  view().innerHTML = `
    ${nav()}${meBar(state)}
    ${featuredNext(state)}
    <p class="tz-note">Kickoff times shown in your local timezone.</p>
    ${groups.map(dayBlock).join('')}
    ${undated.length ? `<h2 class="section-title">Times TBD</h2><div class="match-list">${undated.map((m) => matchLine(m, state, { showTime: false })).join('')}</div>` : ''}`;
  startTick();
}

// ===========================================================================
// BRACKET (round by round, mobile-first)
// ===========================================================================
function renderBracket(state) {
  const rounds = [['R16', 'Round of 16'], ['QF', 'Quarterfinals'], ['SF', 'Semifinals'], ['Final', 'Final'], ['3rd', '3rd-place game']];
  const block = ([round, label]) => {
    const ms = state.matches.filter((m) => m.round === round);
    if (!ms.length) return '';
    return `<h2 class="section-title">${label}</h2>
      <div class="match-list bracket-round">${ms.map((m) => matchLine(m, state, { showTime: false })).join('')}</div>`;
  };
  const myTid = myTeamId(state);
  const hint = myTid ? `<p class="tz-note">Your team's matches are highlighted.</p>` : '';
  view().innerHTML = `${nav()}${meBar(state)}${hint}${rounds.map(block).join('')}`;
}

// ===========================================================================
// ADMIN
// ===========================================================================
function teamOptions(teams, selected) {
  return `<option value="">— TBD —</option>` +
    teams.map((t) => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${t.flagEmoji} ${esc(t.name)}</option>`).join('');
}
function assignmentRow(member, teams) {
  const tbOpts = `<option value="">tb#</option>` +
    Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${member.tiebreakNumber === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('');
  return `<div class="assign-row" data-assign-row="${member.id}">
    <span class="assign-name">${esc(member.name)}</span>
    <select data-act="assign" data-field="teamId">${teamOptions(teams, member.teamId)}</select>
    <select data-act="assign" data-field="tiebreak" title="tiebreak number (1=best)">${tbOpts}</select>
  </div>`;
}
function matchCard(m, teams) {
  const isR16 = m.round === 'R16';
  const nameOf = (id) => { const t = teams.find((x) => x.id === id); return t ? `${t.flagEmoji} ${t.name}` : '— TBD —'; };
  const teamCell = isR16
    ? `<select data-act="match" data-field="teamA">${teamOptions(teams, m.teamA)}</select>
       <span class="vs">v</span>
       <select data-act="match" data-field="teamB">${teamOptions(teams, m.teamB)}</select>`
    : `<span class="auto-team">${esc(nameOf(m.teamA))}</span><span class="vs">v</span><span class="auto-team">${esc(nameOf(m.teamB))}</span>`;
  const opt = (v, label, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  return `<div class="match-card" data-match-card="${m.id}">
    <div class="match-head"><strong>${ROUND_LABEL[m.round]}</strong> · #${m.id}${m.venue ? ' · ' + esc(m.venue) : ''}</div>
    <div class="match-teams">${teamCell}</div>
    <div class="match-result">
      <input type="number" min="0" data-act="match" data-field="scoreA" value="${m.scoreA ?? ''}" placeholder="–" />
      <span class="dash">–</span>
      <input type="number" min="0" data-act="match" data-field="scoreB" value="${m.scoreB ?? ''}" placeholder="–" />
      <select data-act="match" data-field="status">
        ${opt('scheduled', 'scheduled', m.status)}${opt('in_progress', 'live', m.status)}${opt('final', 'final', m.status)}
      </select>
    </div>
    <label class="pens"><input type="checkbox" data-act="match" data-field="pens" ${m.decidedByPens ? 'checked' : ''}/> pens (score = end of ET)</label>
    ${m.decidedByPens ? `<select data-act="match" data-field="penWinner" title="who won the shootout">
        <option value="">shootout winner…</option>
        <option value="${m.teamA ?? ''}" ${m.penWinner === m.teamA ? 'selected' : ''}>${esc(nameOf(m.teamA))}</option>
        <option value="${m.teamB ?? ''}" ${m.penWinner === m.teamB ? 'selected' : ''}>${esc(nameOf(m.teamB))}</option>
      </select>` : ''}
  </div>`;
}
function issuesBlock(state) {
  const issues = validate(state);
  if (issues.length === 0) return '';
  return `<div class="issues">${issues.map((i) => `<div class="issue ${i.level}">${i.level === 'error' ? '⛔' : '⚠️'} ${esc(i.msg)}</div>`).join('')}</div>`;
}
function renderAdmin(state) {
  if (!admin) {
    view().innerHTML = `${nav()}
      <form class="signin" data-signin>
        <h2>Admin sign in</h2>
        <p class="hint">Mock auth for now — any email + password works. Firebase will replace this with the real admin login in Phase&nbsp;2b.</p>
        <input type="email" data-field="email" placeholder="email" autocomplete="username" />
        <input type="password" data-field="password" placeholder="password" autocomplete="current-password" />
        <button type="button" data-act="signin">Sign in</button>
        <div class="signin-err" id="signin-err"></div>
      </form>`;
    return;
  }
  view().innerHTML = `
    ${nav()}
    ${issuesBlock(state)}
    <div class="admin-actions">
      <button data-act="load-demo" class="btn-secondary">Load demo tournament</button>
      <button data-act="reset" class="btn-danger">Reset to blank seed</button>
    </div>
    <h2 class="section-title">The draw — assignments &amp; tiebreak numbers</h2>
    <div class="assign-list">${state.members.map((m) => assignmentRow(m, state.teams)).join('')}</div>
    <h2 class="section-title">Results</h2>
    <div class="match-list">${state.matches.map((m) => matchCard(m, state.teams)).join('')}</div>
    <h2 class="section-title">League update (paste into the group chat)</h2>
    <div class="update-box">
      <textarea id="update-text" class="update-text" readonly rows="14">${esc(formatUpdate({ state, baseline: getBaseline(), url: publicUrl(), now: Date.now() }))}</textarea>
      <div class="admin-actions">
        <button data-act="copy-update" class="btn-secondary">Copy</button>
        <button data-act="mark-sent" class="btn-secondary">Mark as sent (reset "since last update")</button>
      </div>
      <p class="hint">Plain text, no formatting — ready to paste. "Mark as sent" snapshots the current order so the next update only lists what changed after it.</p>
    </div>
    <h2 class="section-title">Live preview (what the public sees)</h2>
    ${orderBlock(state, 'projected')}`;
}

// ===========================================================================
// WHAT-IF EXPLORER (engine hypothetical mode; never writes to the store)
// ===========================================================================
// Overlay the user's imagined winners onto the live matches (undecided ones only;
// real finals always win), advancing the bracket round by round so downstream
// matchups populate. Each imagined game defaults to 1–0 for the chosen winner.
function effectiveMatches(state, preds) {
  let ms = state.matches.map((m) => ({ ...m }));
  for (const round of ['R16', 'QF', 'SF', '3rd', 'Final']) {
    ms = resolveBracket(ms, bracketTopology); // populate this round's teams from earlier results
    ms = ms.map((m) => {
      if (m.round !== round || m.status === 'final') return m; // real results are untouchable
      const p = preds[m.id];
      if (!p || (p.winner !== m.teamA && p.winner !== m.teamB)) return m;
      const aWins = p.winner === m.teamA;
      return { ...m, status: 'final', scoreA: aWins ? 1 : 0, scoreB: aWins ? 0 : 1, decidedByPens: false, penWinner: null };
    });
  }
  return resolveBracket(ms, bracketTopology);
}
const orderFor = (state, preds) => computeDraftOrder({ ...state, matches: effectiveMatches(state, preds), includeProvisional: false }).picks;
const pickOf = (picks, memberId) => { const p = picks.find((x) => x.member.id === memberId); return p ? p.pickNumber : null; };

// "If X wins → owner to pick N" — the spec's per-match insight, two engine runs.
function matchInsight(state, preds, m) {
  const mbt = memberByTeam(state);
  const tm = teamMap(state);
  const owners = [m.teamA, m.teamB].map((id) => mbt.get(id)).filter(Boolean);
  if (!owners.length) return '';
  const orderA = orderFor(state, { ...preds, [m.id]: { winner: m.teamA } });
  const orderB = orderFor(state, { ...preds, [m.id]: { winner: m.teamB } });
  const fa = tm.get(m.teamA)?.flagEmoji ?? '';
  const fb = tm.get(m.teamB)?.flagEmoji ?? '';
  return owners.map((o) => `<div class="insight">${esc(o.name)}: pick ${pickOf(orderA, o.id) ?? '–'} if ${fa}, pick ${pickOf(orderB, o.id) ?? '–'} if ${fb}</div>`).join('');
}

function explorerMatchCard(m, state, preds) {
  const tm = teamMap(state);
  const mbt = memberByTeam(state);
  const chosen = preds[m.id]?.winner;
  const btn = (teamId) => {
    const t = tm.get(teamId);
    const owner = mbt.get(teamId);
    return `<button class="pred-btn${chosen === teamId ? ' on' : ''}" data-act="predict" data-match="${m.id}" data-team="${teamId}">
      ${teamLabel(t)}${owner ? `<span class="ml-owner"> ${esc(owner.name)}</span>` : ''}</button>`;
  };
  return `<div class="pred-card">
    <div class="ml-head">${ROUND_LABEL[m.round]} · #${m.id}</div>
    <div class="pred-choices">${btn(m.teamA)}${btn(m.teamB)}</div>
    ${matchInsight(state, preds, m)}
  </div>`;
}

function renderWhatIf(state) {
  const eff = effectiveMatches(state, predictions);
  const picks = computeDraftOrder({ ...state, matches: eff, includeProvisional: false }).picks;
  // Editable matches: teams known, not a real final. (Predicted ones show as final in eff.)
  const editable = eff.filter((m) => m.teamA && m.teamB && !(state.matches.find((o) => o.id === m.id).status === 'final'));
  const remaining = state.matches.filter((m) => m.status !== 'final').length;
  const predicted = Object.keys(predictions).length;

  view().innerHTML = `
    ${nav()}${meBar(state)}
    <div class="mode-banner"><span><strong>What-if explorer.</strong>
      Click who you think advances — the order updates below. Nothing here is saved or shared.
      Imagined games count as 1–0 (so same-band ties fall to tiebreak number).</span></div>
    <div class="admin-actions">
      <span class="hint">Predicted ${predicted} of ${remaining} remaining matches.</span>
      <button data-act="reset-preds" class="btn-secondary">Reset predictions</button>
    </div>
    ${editable.length ? `<div class="pred-list">${editable.map((m) => explorerMatchCard(m, state, predictions)).join('')}</div>`
      : `<div class="empty">Every match is final — there's nothing left to imagine.</div>`}
    <h2 class="section-title">Projected order in this scenario</h2>
    ${picks.length ? `<div class="picks">${picks.map((p) => pickRow(p, { hideLock: true })).join('')}</div>`
      : `<div class="empty">Assign the draw in admin to explore scenarios.</div>`}`;
}

// ===========================================================================
// HELP / education
// ===========================================================================
function renderHelp(state) {
  const ladder = [
    ['band-champion', 'Champion', '1 pick'],
    ['band-runner_up', 'Runner-up', '1 pick'],
    ['band-third', '3rd place', '1 pick'],
    ['band-fourth', '4th place', '1 pick'],
    ['band-qf_losers', 'QF losers', '4 picks — tiebreak within the band'],
    ['band-r16_losers', 'R16 losers', '8 picks — tiebreak within the band'],
  ];
  view().innerHTML = `
    ${nav()}
    <h2 class="section-title">How the draft order works</h2>
    <p class="prose">Each of the 12 members is randomly assigned one Round-of-16 team. Your draft pick is
      <strong>how far your team goes</strong> — the further, the earlier you pick. Best finish = pick 1.</p>
    <div class="finish-ladder">
      <div class="ladder-cap">← better pick</div>
      ${ladder.map(([cls, n, d]) => `<div class="ladder-row ${cls}"><span class="lad-swatch"></span><span class="lad-n">${n}</span><span class="lad-d">${d}</span></div>`).join('')}
      <div class="ladder-cap">worse pick →</div>
    </div>
    <p class="prose">The top four finishes are each settled by one match (the Final and the 3rd-place game),
      so they can never tie. The two <em>loser bands</em> can have ties — that's where tiebreakers come in.
      Only the 12 drawn teams are ranked; the 4 unassigned teams are skipped, and everyone below slides up
      (no gaps in 1–12).</p>

    <h2 class="section-title">Tiebreakers (within a band only)</h2>
    <p class="prose">Two teams in the same band are ordered by, in order:
      <strong>1)</strong> goal difference in their elimination match, <strong>2)</strong> goals scored in it,
      <strong>3)</strong> their tiebreak number (a distinct 1–12 drawn for everyone, lower = better).</p>
    <div class="worked">
      <div class="worked-title">Worked example — the penalty wrinkle</div>
      <p>Both teams lost in the Round of 16:</p>
      <ul>
        <li><strong>Team A</strong> lost 1–2 in normal time → match GD <strong>−1</strong>.</li>
        <li><strong>Team B</strong> drew 0–0 and lost the <em>shootout</em>. A shootout counts as a draw,
            so the recorded score is 0–0 → match GD <strong>0</strong>.</li>
      </ul>
      <p>Higher GD gets the better pick, so <strong>Team B picks ahead of Team A</strong> — even though it
        "lost" its shootout. If two teams tie on GD <em>and</em> goals scored, the lower tiebreak number wins.</p>
    </div>

    <h2 class="section-title">Trust</h2>
    <p class="prose">Rules were locked on <strong>${esc(state.meta?.rulesLockedDate ?? '—')}</strong>, before the draw.
      The draw is done on random.org, and every team's tiebreak number is public. Same results always produce
      the same order — the compute is deterministic and verified against an invariant test suite.</p>`;
}

// ===========================================================================
// countdown ticking (presentation only)
// ===========================================================================
function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }
function updateCountdowns() {
  const els = document.querySelectorAll('[data-countdown]');
  if (!els.length) { stopTick(); return; }
  for (const el of els) {
    const { past, days, hours, mins, secs } = countdown(Number(el.dataset.countdown), Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    el.textContent = past ? 'starting soon…' : `${days ? days + 'd ' : ''}${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  }
}
function startTick() { stopTick(); updateCountdowns(); tickTimer = setInterval(updateCountdowns, 1000); }

// ===========================================================================
// render dispatch
// ===========================================================================
function render() {
  stopTick();
  meId = getMe();
  switch (location.hash) {
    case '#admin': renderAdmin(appState); break;
    case '#schedule': renderSchedule(appState); break;
    case '#bracket': renderBracket(appState); break;
    case '#whatif': renderWhatIf(appState); break;
    case '#help': renderHelp(appState); break;
    default: renderOrder(appState);
  }
  const ts = appState.meta?.lastUpdated;
  document.getElementById('last-updated').textContent = ts ? 'Last updated: ' + new Date(ts).toLocaleString() : '';
}

// ===========================================================================
// event delegation (bound once; survives re-renders)
// ===========================================================================
function readAssignment(memberId) {
  const row = document.querySelector(`[data-assign-row="${memberId}"]`);
  const teamId = row.querySelector('[data-field="teamId"]').value || null;
  const tb = row.querySelector('[data-field="tiebreak"]').value;
  store.setAssignment(memberId, { teamId, tiebreakNumber: tb ? Number(tb) : null });
}
function readMatch(matchId) {
  const card = document.querySelector(`[data-match-card="${matchId}"]`);
  const get = (f) => card.querySelector(`[data-field="${f}"]`);
  const num = (el) => (el && el.value !== '' ? Number(el.value) : null);
  const patch = {
    status: get('status').value,
    scoreA: num(get('scoreA')),
    scoreB: num(get('scoreB')),
    decidedByPens: get('pens').checked,
    penWinner: get('pens').checked ? (get('penWinner')?.value || null) : null,
  };
  if (get('teamA')) patch.teamA = get('teamA').value || null;
  if (get('teamB')) patch.teamB = get('teamB').value || null;
  store.setMatch(matchId, patch);
}

document.addEventListener('change', (e) => {
  const act = e.target.dataset.act;
  if (act === 'assign') readAssignment(e.target.closest('[data-assign-row]').dataset.assignRow);
  else if (act === 'match') readMatch(e.target.closest('[data-match-card]').dataset.matchCard);
  else if (act === 'setme') { setMe(e.target.value || null); render(); }
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  const act = btn ? btn.dataset.act : null;
  if (!act) return;
  if (act === 'mode') { viewMode = btn.dataset.mode; render(); }
  else if (act === 'theme') { theme = theme === 'day' ? 'night' : 'day'; setTheme(theme); applyTheme(theme); render(); }
  else if (act === 'clearme') { setMe(null); render(); }
  else if (act === 'predict') {
    const { match, team } = btn.dataset;
    // click the chosen winner again to un-predict
    predictions = { ...predictions };
    if (predictions[match]?.winner === team) delete predictions[match];
    else predictions[match] = { winner: team };
    renderWhatIf(appState);
  }
  else if (act === 'reset-preds') { predictions = {}; renderWhatIf(appState); }
  else if (act === 'copy-update') {
    const ta = document.getElementById('update-text');
    navigator.clipboard?.writeText(ta.value).then(() => { btn.textContent = 'Copied ✓'; setTimeout(() => (btn.textContent = 'Copy'), 1500); })
      .catch(() => { ta.select(); document.execCommand?.('copy'); });
  }
  else if (act === 'mark-sent') { setBaseline(snapshot(appState)); render(); }
  else if (act === 'signout') store.signOut();
  else if (act === 'load-demo') store.loadDemo();
  else if (act === 'reset') { if (confirm('Reset all data to the blank seed?')) store.resetAll(); }
  else if (act === 'signin') {
    const form = e.target.closest('[data-signin]');
    const email = form.querySelector('[data-field="email"]').value;
    const pw = form.querySelector('[data-field="password"]').value;
    store.signIn(email, pw).catch((err) => { document.getElementById('signin-err').textContent = err.message; });
  }
});

window.addEventListener('hashchange', render);

// ===========================================================================
// wire to the store — re-render on any data or auth change (incl. cross-tab)
// ===========================================================================
applyTheme(theme);
store.subscribe((s) => { appState = s; render(); });
store.onAuthChanged((isAdmin) => { admin = isAdmin; render(); });
