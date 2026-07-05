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

// Country flag → self-hosted circular SVG (circle-flags, MIT, in /flags). The ISO
// code is derived from the team's flag emoji (which already encodes it), so no
// data change is needed and admin authoring is unchanged. A TBD/placeholder team
// (white-flag emoji) has no country, so it renders a neutral disc. Rendered as an
// <img> from a same-origin file — no third-party request, and any script embedded
// in an SVG can't execute through <img>. Decorative (alt=""): the team name is
// always adjacent, so screen readers must not announce the flag twice.
function isoFromFlag(emoji) {
  if (!emoji) return null;
  const cps = [...emoji].map((c) => c.codePointAt(0));
  // regional-indicator pair → ISO 3166-1 alpha-2 (🇧🇷 → "br")
  if (cps.length >= 2 && cps[0] >= 0x1F1E6 && cps[0] <= 0x1F1FF && cps[1] >= 0x1F1E6 && cps[1] <= 0x1F1FF)
    return String.fromCharCode(cps[0] - 0x1F1E6 + 97, cps[1] - 0x1F1E6 + 97);
  // tag sequence for the UK home nations (England/Scotland/Wales)
  if (cps[0] === 0x1F3F4) {
    const tags = cps.slice(1).filter((c) => c >= 0xE0061 && c <= 0xE007A).map((c) => String.fromCharCode(c - 0xE0061 + 97)).join('');
    return { gbeng: 'gb-eng', gbsct: 'gb-sct', gbwls: 'gb-wls' }[tags] ?? null;
  }
  return null;
}
function flag(team, alt = '') {
  if (!team) return '';
  const iso = isoFromFlag(team.flagEmoji);
  return iso
    ? `<img class="flag" src="flags/${iso}.svg" alt="${esc(alt)}" width="24" height="24" loading="lazy" />`
    : '<span class="flag flag-tbd" aria-hidden="true"></span>';
}
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
let writeStatus = { pending: 0, error: null }; // last write outcome, from store.onWriteStatus
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
function teamLabel(team) { return team ? `${flag(team)} ${esc(team.name)}` : '<span class="tbd">— TBD —</span>'; }

function pickRow(p, { hideLock, newlyLocked, moved } = {}) {
  const top1 = p.pickNumber === 1 ? ' top1' : '';
  const aliveCls = p.alive ? ' alive' : '';
  const mineCls = p.member.id === meId ? ' mine' : '';
  const bandCls = ` band-${p.band.toLowerCase()}`; // colours the rung on the ladder
  const pulse = !hideLock && newlyLocked && newlyLocked.has(p.member.id) ? ' just-locked' : '';
  const movedCls = moved && moved.has(p.member.id) ? ' order-moved' : ''; // what-if: this plate just re-sorted
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
    <div class="pick${top1}${aliveCls}${mineCls}${pulse}${movedCls}${bandCls}">
      <div class="pick-num">${p.pickNumber}</div>
      <div class="pick-main">
        <div class="pick-member">${esc(p.member.name)}${mineCls ? ' <span class="you">you</span>' : ''} ${tb}</div>
        <div class="pick-team">${flag(p.team)}<span class="team-name">${p.team ? esc(p.team.name) : 'unassigned'}</span></div>
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
// A bracket cell. crown marks the Final winner as champion; tbd renders an
// unfilled wall-chart slot (both teams still awaiting an upstream result).
function matchLine(m, state, { showTime, crown } = {}) {
  const tm = teamMap(state);
  const mbt = memberByTeam(state);
  const wl = matchWinnerLoser(m); // final only
  const mineSet = new Set([myTeamId(state)].filter(Boolean));
  const mineCls = (mineSet.has(m.teamA) || mineSet.has(m.teamB)) ? ' mine' : '';
  const liveCls = m.status === 'in_progress' ? ' live' : '';
  const tbdCls = (m.teamA == null && m.teamB == null) ? ' tbd' : '';

  const side = (teamId, score) => {
    const t = tm.get(teamId);
    const owner = mbt.get(teamId);
    const win = wl && wl.winner === teamId;
    const lose = wl && wl.loser === teamId;
    const scoreTxt = (m.status === 'final' || m.status === 'in_progress') && score != null ? `<span class="ml-score">${score}</span>` : '';
    return `<div class="ml-side${win ? ' win' : ''}${lose ? ' lose' : ''}${owner && owner.id === meId ? ' mine' : ''}">
      <span class="ml-team">${teamLabel(t)}${win ? ' <span class="adv">✓</span>' : ''}</span>
      ${win && crown ? '<span class="champ-tag">Champion</span>' : ''}
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

  return `<div class="match-line${mineCls}${liveCls}${tbdCls}">
    <div class="ml-head">#${esc(m.id)}${m.venue ? ' · ' + esc(m.venue) : ''} ${statusBadge} ${pens} ${timeTxt}</div>
    ${side(m.teamA, m.scoreA)}${side(m.teamB, m.scoreB)}
  </div>`;
}

// ===========================================================================
// Nav + "find my team" bar
// ===========================================================================
// Programme index tabs — one row, the active page raised as a cream tab.
// Admin only appears once signed in (the footer's "Commissioner sign-in" link
// covers getting there on a fresh device); theme toggle lives in the masthead.
function nav() {
  const h = location.hash;
  const link = (href, label) => {
    const on = h === href || (href === '#' && h === '');
    return `<a href="${href}" class="${on ? 'active' : ''}"${on ? ' aria-current="page"' : ''}>${label}</a>`;
  };
  return `<nav class="nav">
    <div class="nav-links">${link('#', 'Order')}${link('#schedule', 'Schedule')}${link('#bracket', 'Bracket')}${link('#whatif', 'What-if')}${link('#help', 'Help')}${admin ? link('#admin', 'Admin') : ''}</div>
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
  layer.setAttribute('aria-hidden', 'true'); // purely decorative — hide from screen readers
  const colors = ['#c6a24c', '#d8452f', '#f3ecd9', '#0e6b52']; // collectible: foil gold, coral, cream, green
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
      <select data-act="setme" aria-label="Find your name">
        <option value="">choose your name…</option>
        ${state.members.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}
      </select>
    </div>`;
  }
  const team = state.teams.find((t) => t.id === me.teamId);
  const { picks } = computeDraftOrder({ ...state, includeProvisional: true });
  const mine = picks.find((p) => p.member.id === me.id);
  const standing = !team ? 'not assigned yet'
    : !mine ? `${flag(team)} ${esc(team.name)}`
    : `${flag(team)} ${esc(team.name)} · currently pick ${mine.pickNumber} ${mine.locked ? '(locked)' : mine.alive ? '(still alive)' : '(if it stands)'}`;
  return `<div class="me-bar mine">
    <span>You're <strong>${esc(me.name)}</strong> — ${standing}</span>
    <button data-act="clearme" class="link-btn">change</button>
  </div>`;
}

// ===========================================================================
// MATCHDAY WIRE — the vidiprinter strip on the Order page. Today's slate +
// what's riding on each game, straight from the engine. All numbers computed
// (two engine runs per open match, like the what-if insights); the banter
// templates key on those facts and never invent anything. Uses
// includeProvisional: true throughout so every pick number agrees with the
// projected ladder rendered right below it (what-if's orderFor does not).
// ===========================================================================
const sameLocalDay = (ms, now) => { const d = new Date(ms); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate(); };

function todaysSlate(state, now) {
  const rank = (m) => (m.status === 'in_progress' ? 0 : m.status === 'final' ? 1 : 2);
  return state.matches
    .filter((m) => m.teamA && m.teamB && (m.status === 'in_progress' || (kickoffMs(m) != null && sameLocalDay(kickoffMs(m), now))))
    .sort((a, b) => rank(a) - rank(b) || (kickoffMs(a) ?? 0) - (kickoffMs(b) ?? 0));
}

function matchdayWire(state) {
  const now = new Date();
  const slate = todaysSlate(state, now);
  if (!slate.length) return '';
  const tm = teamMap(state);
  const mbt = memberByTeam(state);
  const current = computeDraftOrder({ ...state, includeProvisional: true }).picks;

  // "pick N if <winner>": finalize just this match — keep the real score when the
  // winner is already ahead ("if it stands"), else nudge them one goal clear —
  // then advance the bracket and re-run the engine in the ladder's provisional frame.
  const pickIf = (m, winnerId) => {
    const sa = m.scoreA ?? 0, sb = m.scoreB ?? 0;
    const aWins = winnerId === m.teamA;
    const scoreA = aWins ? Math.max(sa, sb + 1) : sa;
    const scoreB = aWins ? sb : Math.max(sb, sa + 1);
    const ms = state.matches.map((x) => x.id === m.id
      ? { ...x, status: 'final', scoreA, scoreB, decidedByPens: false, penWinner: null } : x);
    return computeDraftOrder({ ...state, matches: resolveBracket(ms, bracketTopology), includeProvisional: true }).picks;
  };

  // Open games: two engine runs each, read by both owners.
  const open = slate.filter((m) => m.status !== 'final');
  const rows = new Map(); // match id -> [{ o, team, otherTeam, mine, theirs, pW, pL }]
  for (const m of open) {
    const ordA = pickIf(m, m.teamA), ordB = pickIf(m, m.teamB);
    const r = [];
    for (const t of [m.teamA, m.teamB]) {
      const o = mbt.get(t);
      if (!o) continue;
      const isA = t === m.teamA;
      const pW = pickOf(isA ? ordA : ordB, o.id), pL = pickOf(isA ? ordB : ordA, o.id);
      if (pW == null || pL == null) continue;
      r.push({ o, team: tm.get(t), otherTeam: tm.get(isA ? m.teamB : m.teamA),
        mine: isA ? (m.scoreA ?? 0) : (m.scoreB ?? 0), theirs: isA ? (m.scoreB ?? 0) : (m.scoreA ?? 0), pW, pL });
    }
    rows.set(m.id, r);
  }

  const gdTxt = (gd) => `GD ${gd > 0 ? '+' : gd < 0 ? '−' : ''}${Math.abs(gd)}`;
  // A win only EARNS a pick in the Final and the 3rd-place game (one match =
  // one finish). Everywhere else a win means "still alive" — say that, so
  // leaguemates who skimmed the rules aren't promised a number a win can't
  // guarantee. "for now" flags every number that can still move; "locked in"
  // uses the engine's own lock flag.
  const NEXT_ROUND = { R16: 'the quarterfinals', QF: 'the semifinals', SF: 'the final' };
  const FINISH = { Final: ['champion', 'runner-up'], '3rd': ['third place', 'fourth place'] };
  const stakeLines = (m) => {
    const exact = !!FINISH[m.round];
    const out = [];
    if (m.status === 'final') {
      const wl = matchWinnerLoser(m);
      for (const t of [m.teamA, m.teamB]) {
        const o = mbt.get(t);
        const pk = o ? current.find((x) => x.member.id === o.id) : null;
        if (!wl || !o || !pk) continue;
        const tail = pk.locked ? `pick <strong>${pk.pickNumber}</strong>, locked in` : `pick <strong>${pk.pickNumber}</strong> for now`;
        if (wl.winner === t) {
          const lead = exact ? `${FINISH[m.round][0]} — ` : `through to ${NEXT_ROUND[m.round]} — `;
          out.push(`<div class="wi-line good"><strong>${esc(o.name)}</strong>: ${lead}${tail}</div>`);
        } else if (exact) {
          out.push(`<div class="wi-line bad"><strong>${esc(o.name)}</strong>: ${FINISH[m.round][1]} — ${tail}</div>`);
        } else {
          const gd = t === m.teamA ? (m.scoreA ?? 0) - (m.scoreB ?? 0) : (m.scoreB ?? 0) - (m.scoreA ?? 0);
          out.push(m.decidedByPens
            ? `<div class="wi-line bad"><strong>${esc(o.name)}</strong>: out on pens (counts as a draw, ${gdTxt(gd)}) — ${tail}</div>`
            : `<div class="wi-line bad"><strong>${esc(o.name)}</strong>: out (${gdTxt(gd)}) — ${tail}</div>`);
        }
      }
      return out.join('');
    }
    for (const r of rows.get(m.id) ?? []) {
      let txt;
      if (r.pW === r.pL) txt = `pick <strong>${r.pW}</strong> either way for now`;
      else if (exact) { // Final / 3rd place: this one result IS the finish
        if (m.status !== 'in_progress') txt = `pick <strong>${r.pW}</strong> with a win · pick <strong>${r.pL}</strong> with a loss`;
        else if (r.mine === r.theirs) txt = `level — pick <strong>${r.pW}</strong> if ${esc(r.team.name)} win · pick <strong>${r.pL}</strong> if not`;
        else if (r.mine > r.theirs) txt = `pick <strong>${r.pW}</strong> if this score holds · pick <strong>${r.pL}</strong> if ${esc(r.otherTeam.name)} win`;
        else txt = `pick <strong>${r.pL}</strong> if this score holds · pick <strong>${r.pW}</strong> if ${esc(r.team.name)} win`;
      }
      else if (m.status !== 'in_progress') txt = `still alive with a win (pick <strong>${r.pW}</strong> for now) · out with a loss (pick <strong>${r.pL}</strong>)`;
      else if (r.mine === r.theirs) txt = `level — still alive with a win (pick <strong>${r.pW}</strong> for now), out with a loss (pick <strong>${r.pL}</strong>)`;
      else if (r.mine > r.theirs) txt = `through as it stands — pick <strong>${r.pW}</strong> for now · out if it flips (pick <strong>${r.pL}</strong>)`;
      else txt = `out as it stands (pick <strong>${r.pL}</strong>) · still alive if ${esc(r.team.name)} come back (pick <strong>${r.pW}</strong>)`;
      out.push(`<div class="wi-line"><strong>${esc(r.o.name)}</strong>: ${txt}</div>`);
    }
    return out.join('');
  };

  const scoreRow = (m) => {
    const a = tm.get(m.teamA), b = tm.get(m.teamB);
    const k = kickoffMs(m);
    const badge = m.status === 'in_progress' ? '<span class="wi-live">LIVE</span>'
      : m.status === 'final' ? '<span class="wi-ft">FT</span>'
      : `<span class="wi-ft">${k != null ? esc(new Date(k).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : 'TBD'}</span>`;
    const mid = m.status === 'scheduled' ? '<span class="wi-v">v</span>' : `${m.scoreA ?? 0}–${m.scoreB ?? 0}`;
    const pens = m.decidedByPens && m.status === 'final' ? ` <span class="wi-pens">pens: ${esc(tm.get(m.penWinner)?.name ?? '?')}</span>` : '';
    return `<div class="wi-score">${badge}${flag(a)} ${esc(a.name)} ${mid} ${esc(b.name)} ${flag(b)}${pens}</div>`;
  };

  // Tiebreak in play: same-band neighbours with identical elimination numbers —
  // only the (public) tiebreak number separates them. Shown only when it's real.
  const tb = [];
  for (let i = 0; i + 1 < current.length; i++) {
    const p = current[i], q = current[i + 1];
    if (p.band === q.band && p.matchGD != null && q.matchGD != null && p.matchGD === q.matchGD && p.matchGF === q.matchGF)
      tb.push(`<div class="wi-line"><strong>${esc(p.member.name)}</strong> #${p.tiebreakNumber} ahead of <strong>${esc(q.member.name)}</strong> #${q.tiebreakNumber} — identical results (${gdTxt(p.matchGD)}, ${p.matchGF} scored), so the lower tiebreak number picks first</div>`);
  }
  const tbBlock = tb.length
    ? `<div class="wire-item"><div class="wi-score"><span class="wi-tb">TB</span> Tiebreak in play</div>${tb.join('')}</div>`
    : '';
  const note = `<div class="wire-note">Reminder: your pick = how far your team goes. Numbers keep shifting until results lock them in — <a href="#help">how the order works</a>.</div>`;

  return `<div class="wire">
    <div class="wire-head"><span class="wire-tag">Matchday wire</span><span class="wire-date">${esc(now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))}</span></div>
    ${slate.map((m) => `<div class="wire-item">${scoreRow(m)}${stakeLines(m)}</div>`).join('')}
    ${tbBlock}
    ${note}
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
    ${picks.length ? matchdayWire(state) : ''}
    ${controls}
    ${body}
    <h2 class="section-title">Out of play — ${unassigned.length} unassigned</h2>
    <div class="unassigned">
      ${unassigned.map((t) => `<span class="chip">${flag(t)} ${esc(t.name)}</span>`).join('') || '<span class="chip">—</span>'}
    </div>
    ${trustStamps(state)}`;

  prevLocked = nowLocked;
  if (phase === 'final' && !celebrated) { celebrated = true; celebrate(); }
  if (phase !== 'final') celebrated = false;
}

// ===========================================================================
// SCHEDULE + countdown
// ===========================================================================
// The "hot ticket" marquee: the live match (score) or the next kickoff (countdown).
function featuredNext(state) {
  const next = nextMatch(state.matches, Date.now());
  if (!next) return `<div class="marquee done">Tournament complete — the order is final.</div>`;

  const tm = teamMap(state);
  const teams = `${teamLabel(tm.get(next.teamA))} <span class="mq-v">v</span> ${teamLabel(tm.get(next.teamB))}`;
  const k = kickoffMs(next);
  if (next.status === 'in_progress') {
    return `<div class="marquee live">
      <div class="mq-tag"><span class="livedot"></span> Live now · ${ROUND_LABEL[next.round]}</div>
      <div class="mq-teams">${teams}</div>
      <div class="mq-score">${next.scoreA ?? 0} – ${next.scoreB ?? 0}</div>
      <div class="mq-sub">${next.venue ? esc(next.venue) + ' · ' : ''}picks shift live as it plays</div>
    </div>`;
  }
  const when = k != null ? ' · ' + new Date(k).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  return `<div class="marquee">
    <div class="mq-tag">Next up · ${ROUND_LABEL[next.round]}</div>
    <div class="mq-teams">${teams}</div>
    <div class="mq-count" ${k != null ? `data-countdown="${k}"` : ''}>${k != null ? '…' : 'time TBD'}</div>
    <div class="mq-sub">${next.venue ? esc(next.venue) : ''}${when}</div>
  </div>`;
}

// One fixture as a matchday ticket: a torn stub (kickoff time / LIVE / FT) + the
// two teams. Schedule-only — the bracket keeps matchLine(), so it's unaffected.
function scheduleTicket(m, state) {
  const tm = teamMap(state);
  const mbt = memberByTeam(state);
  const wl = matchWinnerLoser(m); // final only
  const mineTeam = myTeamId(state);
  const mineCls = (mineTeam === m.teamA || mineTeam === m.teamB) ? ' mine' : '';

  let stub;
  const k = kickoffMs(m);
  if (m.status === 'in_progress') stub = `<div class="tk-live"><span class="livedot"></span>Live</div>`;
  else if (m.status === 'final') stub = `<div class="tk-ft">FT</div>`;
  else if (k != null) {
    const [hm, ap] = new Date(k).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).split(' ');
    stub = `<div class="tk-time">${esc(hm)}${ap ? `<span class="tk-ampm">${esc(ap)}</span>` : ''}</div>`;
  } else stub = `<div class="tk-ft">TBD</div>`;

  const side = (id, sc) => {
    const t = tm.get(id);
    const owner = mbt.get(id);
    const win = wl && wl.winner === id;
    const lose = wl && wl.loser === id;
    const scoreTxt = (m.status === 'final' || m.status === 'in_progress') && sc != null ? `<span class="tk-score">${sc}</span>` : '';
    return `<div class="tk-side${win ? ' win' : ''}${lose ? ' lose' : ''}${owner && owner.id === meId ? ' mine' : ''}">
      <span class="tk-team">${teamLabel(t)}${win ? ' <span class="adv">✓</span>' : ''}</span>
      ${owner ? `<span class="tk-owner">${esc(owner.name)}</span>` : ''}${scoreTxt}</div>`;
  };
  const pens = m.decidedByPens && m.status === 'final' ? ` · <span class="ml-pens">pens: ${esc(tm.get(m.penWinner)?.name ?? '?')}</span>` : '';
  return `<article class="ticket${m.status === 'in_progress' ? ' live' : ''}${mineCls}">
    <div class="tk-stub">${stub}</div>
    <div class="tk-body">
      ${side(m.teamA, m.scoreA)}${side(m.teamB, m.scoreB)}
      <div class="tk-foot">${ROUND_LABEL[m.round]} · ${esc(m.venue ?? '—')} · #${esc(m.id)}${pens}</div>
    </div>
  </article>`;
}

function renderSchedule(state) {
  const { groups, undated } = groupByDay(state.matches);
  const band = (label, n) => `<div class="day-band"><span class="db-day">${label}</span><span class="db-rule"></span><span class="db-count">${n} ${n === 1 ? 'match' : 'matches'}</span></div>`;
  const dayBlock = (g) => `
    ${band(esc(g.day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })), g.items.length)}
    <div class="ticket-list">${g.items.map((m) => scheduleTicket(m, state)).join('')}</div>`;

  view().innerHTML = `
    ${nav()}${meBar(state)}
    ${featuredNext(state)}
    <p class="tz-note">Kickoff times shown in your local timezone.</p>
    ${groups.map(dayBlock).join('')}
    ${undated.length ? `${band('Times TBD', undated.length)}<div class="ticket-list">${undated.map((m) => scheduleTicket(m, state)).join('')}</div>` : ''}`;
  startTick();
}

// ===========================================================================
// BRACKET (round by round, mobile-first)
// ===========================================================================
function renderBracket(state) {
  // [round key, chapter name, short mark]. Rails ramp deep-teal -> gold toward the Final.
  const rounds = [['R16', 'Round of 16', 'R16'], ['QF', 'Quarterfinals', 'QF'], ['SF', 'Semifinals', 'SF'], ['Final', 'Final', 'F'], ['3rd', '3rd-place game', '3rd']];
  const block = ([round, label, mark]) => {
    const ms = state.matches.filter((m) => m.round === round);
    if (!ms.length) return '';
    const decided = ms.filter((m) => matchWinnerLoser(m)).length;
    const prog = decided === ms.length ? 'complete' : `${decided} of ${ms.length} in`;
    const cells = ms.map((m) => matchLine(m, state, { showTime: true, crown: round === 'Final' })).join('');
    return `<section class="bx-round r-${round}">
      <div class="rnd-head"><span class="rnd-mark">${mark}</span><span class="rnd-name">${label}</span><span class="rnd-rule"></span><span class="rnd-prog">${prog}</span></div>
      <div class="bracket-round">${cells}</div>
    </section>`;
  };
  const myTid = myTeamId(state);
  const hint = myTid ? `<p class="tz-note">Your team's run is highlighted in gold.</p>` : '';
  view().innerHTML = `${nav()}${meBar(state)}${hint}${rounds.map(block).join('')}`;
}

// ===========================================================================
// ADMIN
// ===========================================================================
function teamOptions(teams, selected) {
  return `<option value="">— TBD —</option>` +
    teams.map((t) => `<option value="${esc(t.id)}" ${t.id === selected ? 'selected' : ''}>${esc(t.flagEmoji)} ${esc(t.name)}</option>`).join('');
}
function assignmentRow(member, teams) {
  const tbOpts = `<option value="">tb#</option>` +
    Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${member.tiebreakNumber === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('');
  return `<div class="assign-row" data-assign-row="${esc(member.id)}">
    <span class="assign-name">${esc(member.name)}</span>
    <select data-act="assign" data-field="teamId" aria-label="${esc(member.name)} — assigned team">${teamOptions(teams, member.teamId)}</select>
    <select data-act="assign" data-field="tiebreak" title="tiebreak number (1=best)" aria-label="${esc(member.name)} — tiebreak number">${tbOpts}</select>
  </div>`;
}
// datetime-local <-> ISO-with-offset. The admin edits kickoffs in the DEVICE's
// zone (native picker); we store the instant with the device's UTC offset, which
// preserves it exactly — every page renders times in the viewer's zone anyway.
function toLocalInput(ms) {
  if (ms == null) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function isoWithDeviceOffset(local) { // "YYYY-MM-DDTHH:MM" (device zone) -> full ISO
  const d = new Date(local); // no-offset datetimes parse as device-local time
  if (Number.isNaN(d.getTime())) return null;
  const off = -d.getTimezoneOffset(); // minutes east of UTC, DST-correct for that date
  const p = (n) => String(n).padStart(2, '0');
  return `${local}:00${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
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
  const k = kickoffMs(m);
  const when = k != null ? new Date(k).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  const statusCls = m.status === 'in_progress' ? ' live' : m.status === 'final' ? ' final' : '';
  return `<div class="match-card${statusCls}" data-match-card="${esc(m.id)}">
    <div class="match-head"><strong>${ROUND_LABEL[m.round]}</strong> · #${esc(m.id)}${m.venue ? ' · ' + esc(m.venue) : ''}${when ? `<span class="match-when">${esc(when)}</span>` : ''}</div>
    <div class="match-teams">${teamCell}</div>
    <div class="match-result">
      <input type="number" min="0" data-act="match" data-field="scoreA" value="${m.scoreA ?? ''}" placeholder="–" aria-label="Score — ${esc(nameOf(m.teamA))}" />
      <span class="dash">–</span>
      <input type="number" min="0" data-act="match" data-field="scoreB" value="${m.scoreB ?? ''}" placeholder="–" aria-label="Score — ${esc(nameOf(m.teamB))}" />
      <select data-act="match" data-field="status" aria-label="Match status">
        ${opt('scheduled', 'scheduled', m.status)}${opt('in_progress', 'live', m.status)}${opt('final', 'final', m.status)}
      </select>
    </div>
    <label class="pens"><input type="checkbox" data-act="match" data-field="pens" ${m.decidedByPens ? 'checked' : ''}/> pens (score = end of ET)</label>
    ${m.decidedByPens ? `<select data-act="match" data-field="penWinner" title="who won the shootout" aria-label="Shootout winner">
        <option value="">shootout winner…</option>
        <option value="${esc(m.teamA ?? '')}" ${m.penWinner === m.teamA ? 'selected' : ''}>${esc(nameOf(m.teamA))}</option>
        <option value="${esc(m.teamB ?? '')}" ${m.penWinner === m.teamB ? 'selected' : ''}>${esc(nameOf(m.teamB))}</option>
      </select>` : ''}
    <details class="fixture-edit">
      <summary>Kickoff &amp; venue</summary>
      <div class="fx-fields">
        <input type="datetime-local" data-act="match" data-field="datetime" value="${toLocalInput(k)}" aria-label="Kickoff — your local time" />
        <input type="text" data-act="match" data-field="venue" value="${esc(m.venue ?? '')}" placeholder="venue" maxlength="40" aria-label="Venue" />
      </div>
      <p class="fx-hint">Kickoff is in your local time — leaguemates each see it in theirs.</p>
    </details>
  </div>`;
}
// Save toast: fixed to the bottom so it's visible wherever the admin is
// scrolled. "Saving…" that lingers means the write is queued offline (see
// store.js); an error means the change was NOT saved and must be redone.
function saveStatus() {
  if (writeStatus.error) return `<div class="save-status error" role="alert">Not saved: ${esc(writeStatus.error)}</div>`;
  if (writeStatus.pending > 0) return `<div class="save-status saving" role="status">Saving… (if this lingers, check your connection)</div>`;
  return '';
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
        <p class="hint">Commissioner sign-in for entering results. Everything else on the site is public — leaguemates never need an account.</p>
        <input type="email" data-field="email" placeholder="email" autocomplete="username" />
        <input type="password" data-field="password" placeholder="password" autocomplete="current-password" />
        <button type="button" data-act="signin">Sign in</button>
        <div class="signin-err" id="signin-err"></div>
      </form>`;
    return;
  }
  // Every save re-renders this view; keep any open fixture editors open so a
  // kickoff edit doesn't collapse the panel before the venue edit.
  const openFx = new Set([...document.querySelectorAll('.fixture-edit[open]')]
    .map((d) => d.closest('[data-match-card]')?.dataset.matchCard).filter(Boolean));
  view().innerHTML = `
    ${nav()}
    ${saveStatus()}
    ${issuesBlock(state)}
    <div class="admin-actions">
      <button data-act="load-demo" class="btn-secondary">Load demo tournament</button>
      <button data-act="reset" class="btn-danger">Reset to blank seed</button>
      <button data-act="signout" class="btn-secondary">Sign out</button>
    </div>
    <h2 class="section-title">Results</h2>
    <div class="match-list">${state.matches.map((m) => matchCard(m, state.teams)).join('')}</div>
    <h2 class="section-title">The draw — assignments &amp; tiebreak numbers</h2>
    <div class="assign-list">${state.members.map((m) => assignmentRow(m, state.teams)).join('')}</div>
    <h2 class="section-title">League update (paste into the group chat)</h2>
    <div class="update-box">
      <textarea id="update-text" class="update-text" readonly rows="14" aria-label="League update text">${esc(formatUpdate({ state, baseline: getBaseline(), url: publicUrl(), now: Date.now() }))}</textarea>
      <div class="admin-actions">
        <button data-act="copy-update" class="btn-secondary">Copy</button>
        <button data-act="mark-sent" class="btn-secondary">Mark as sent (reset "since last update")</button>
      </div>
      <p class="hint">Plain text, no formatting — ready to paste. "Mark as sent" snapshots the current order so the next update only lists what changed after it.</p>
    </div>
    <h2 class="section-title">Live preview (what the public sees)</h2>
    ${orderBlock(state, 'projected')}`;
  for (const id of openFx) document.querySelector(`[data-match-card="${id}"] .fixture-edit`)?.setAttribute('open', '');
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
  // The flag IS the content here ("pick 7 if <flag>"), so it carries the name as alt.
  const fa = flag(tm.get(m.teamA), tm.get(m.teamA)?.name ?? '');
  const fb = flag(tm.get(m.teamB), tm.get(m.teamB)?.name ?? '');
  return owners.map((o) => `<div class="insight">${esc(o.name)}: pick ${pickOf(orderA, o.id) ?? '–'} if ${fa}, pick ${pickOf(orderB, o.id) ?? '–'} if ${fb}</div>`).join('');
}

// One coupon fixture: two cells split by a dashed rule; picking a team stamps
// a ✕ in its marking box (pools-coupon style) and takes the gold wash.
function explorerMatchCard(m, state, preds) {
  const tm = teamMap(state);
  const mbt = memberByTeam(state);
  const chosen = preds[m.id]?.winner;
  const cell = (teamId) => {
    const t = tm.get(teamId);
    const owner = mbt.get(teamId);
    const on = chosen === teamId;
    return `<button class="c-cell${on ? ' on' : ''}" data-act="predict" data-match="${esc(m.id)}" data-team="${esc(teamId)}" aria-pressed="${on}">
      ${flag(t)}<span class="c-name">${esc(t?.name ?? '')}${owner ? `<span class="c-owner">${esc(owner.name)}</span>` : ''}</span>
      <span class="markbox" aria-hidden="true"></span></button>`;
  };
  return `<div class="pred-card">
    <div class="ml-head">${ROUND_LABEL[m.round]} · #${esc(m.id)}</div>
    <div class="coupon-row">${cell(m.teamA)}${cell(m.teamB)}</div>
    ${matchInsight(state, preds, m)}
  </div>`;
}

// moved: member ids whose pick number just changed — their plates pulse once.
function renderWhatIf(state, moved) {
  const eff = effectiveMatches(state, predictions);
  const picks = computeDraftOrder({ ...state, matches: eff, includeProvisional: false }).picks;
  // Editable matches: teams known, not a real final. (Predicted ones show as final in eff.)
  // Marking a whole round opens the next one, so the coupon grows as you fill it.
  const editable = eff.filter((m) => m.teamA && m.teamB && !(state.matches.find((o) => o.id === m.id).status === 'final'));
  const marked = editable.filter((m) => predictions[m.id]).length;
  const punches = editable.map((m) => `<span class="punch${predictions[m.id] ? ' hit' : ''}"></span>`).join('');

  view().innerHTML = `
    ${nav()}${meBar(state)}
    ${editable.length ? `<div class="coupon">
      <div class="coupon-head">
        <span class="coupon-no">Coupon</span>
        <span class="punches" aria-hidden="true">${punches}</span>
        <button data-act="reset-preds" class="btn-secondary">Clear coupon</button>
      </div>
      <p class="coupon-note"><strong>Marked ${marked} of ${editable.length}.</strong>
        Tap who you think advances — the order updates below. Nothing here is saved or shared.
        You pick winners, not scores, so if two teams go out in the same round their tiebreak number decides who picks first.</p>
    </div>` : ''}
    ${editable.length ? `<div class="pred-list">${editable.map((m) => explorerMatchCard(m, state, predictions)).join('')}</div>`
      : `<div class="empty">Every match is final — there's nothing left to imagine.</div>`}
    <h2 class="section-title">Projected order in this scenario</h2>
    ${picks.length ? `<div class="picks">${picks.map((p) => pickRow(p, { hideLock: true, moved })).join('')}</div>`
      : `<div class="empty">Assign the draw in admin to explore scenarios.</div>`}`;
}

// ===========================================================================
// HELP / education
// ===========================================================================
function renderHelp(state) {
  // [band colour, picks in the band, finish, how the band self-orders]
  const ladder = [
    ['band-champion', '1', 'Champion', ''],
    ['band-runner_up', '1', 'Runner-up', ''],
    ['band-third', '1', '3rd place', ''],
    ['band-fourth', '1', '4th place', ''],
    ['band-qf_losers', '4', 'QF losers', 'GD, then goals, then tiebreak number'],
    ['band-r16_losers', '8', 'R16 losers', 'GD, then goals, then tiebreak number'],
  ];
  const lockedDate = esc(state.meta?.rulesLockedDate ?? '—');
  view().innerHTML = `
    ${nav()}
    <div class="prog-mast">
      <p class="prog-eyebrow">Official programme</p>
      <h2 class="prog-title">How the draft order works</h2>
      <p class="prog-edition">Rules edition · locked ${lockedDate} — printed before the draw</p>
    </div>

    <h2 class="law-head"><span class="law-no">1</span>The finish ladder</h2>
    <p class="prose">Each of the 12 members is randomly assigned one Round-of-16 team. Your draft pick is
      <strong>how far your team goes</strong> — the further, the earlier you pick. Best finish = pick 1.
      Band colours match the Order page.</p>
    <div class="finish-ladder">
      <div class="ladder-cap">← better pick</div>
      ${ladder.map(([cls, count, n, d]) => `<div class="ladder-row ${cls}">
        <span class="lad-num">${count}<em>${count === '1' ? 'pick' : 'picks'}</em></span>
        <span class="lad-n">${n}</span><span class="lad-d">${d}</span></div>`).join('')}
      <div class="ladder-cap">worse pick →</div>
    </div>
    <p class="prose">The top four finishes are each settled by one match (the Final and the 3rd-place game),
      so they can never tie. The two <em>loser bands</em> can have ties — that's where tiebreakers come in.
      Only the 12 drawn teams are ranked; the 4 unassigned teams are skipped, and everyone below slides up
      (no gaps in 1–12).</p>

    <h2 class="law-head"><span class="law-no">2</span>Tiebreakers — same band only</h2>
    <p class="prose">Two teams in the same band are ordered by, in order:
      <strong>1)</strong> goal difference in their elimination match, <strong>2)</strong> goals scored in it,
      <strong>3)</strong> their tiebreak number (a distinct 1–12 drawn for everyone, lower = better).</p>
    <div class="worked">
      <div class="worked-title">Worked example — the penalty wrinkle</div>
      <p>Both teams lost in the Round of 16. A shootout counts as a draw, so Team B's recorded score is 0–0:</p>
      <div class="wx-row"><span class="wx-team">Team A</span><span class="wx-score">1–2</span><span class="wx-note">lost in normal time</span><span class="wx-gd">GD −1</span></div>
      <div class="wx-row"><span class="wx-team">Team B</span><span class="wx-score">0–0</span><span class="wx-note">lost the shootout</span><span class="wx-gd win">GD 0</span></div>
      <p>Higher GD gets the better pick, so <strong>Team B picks ahead of Team A</strong> — even though it
        "lost" its shootout. If two teams tie on GD <em>and</em> goals scored, the lower tiebreak number wins.</p>
      <p class="wx-freq">Not a rare wrinkle: in a 10,000-tournament simulation, a shootout loser out-picked a
        regulation loser in about half of them. Expect it.</p>
    </div>

    <h2 class="law-head"><span class="law-no">3</span>Trust</h2>
    <div class="trust-card">
      <div class="stamp-row">
        <span class="ink-stamp">Rules locked ${lockedDate}</span>
        <span class="ink-stamp">random.org draw</span>
        <span class="ink-stamp">Same results, same order</span>
      </div>
      <p>Rules were locked on <strong>${lockedDate}</strong>, before the draw.
        The draw is done on random.org, and every team's tiebreak number is public. Same results always produce
        the same order — the compute is deterministic and verified against an invariant test suite.</p>
    </div>`;
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
  navNudge();
}

// The tab row only overflows when Admin's sixth tab is present — make sure the
// active tab is never hidden past the scroll edge (no-op when everything fits).
// Also re-run once the webfonts land: the first render measures fallback-font
// widths, where the row may not overflow yet, clamping the scroll to 0.
function navNudge() {
  const links = document.querySelector('.nav-links');
  const act = links?.querySelector('.active');
  if (links && act) links.scrollLeft = Math.max(0, act.offsetLeft + act.offsetWidth - links.clientWidth + 18);
}
document.fonts?.ready.then(navNudge);

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
  // Fixture fields: an empty/invalid datetime is OMITTED (never wipes a stored
  // kickoff by accident); venue may be cleared to null (display-only).
  const iso = get('datetime')?.value ? isoWithDeviceOffset(get('datetime').value) : null;
  if (iso) patch.datetimeISO = iso;
  if (get('venue')) patch.venue = get('venue').value.trim() || null;
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
    const before = orderFor(appState, predictions);
    predictions = { ...predictions };
    if (predictions[match]?.winner === team) delete predictions[match];
    else predictions[match] = { winner: team };
    // pulse the plates whose pick number this tap changed (two extra engine runs — cheap, it's pure)
    const after = orderFor(appState, predictions);
    const moved = new Set(after.filter((p) => pickOf(before, p.member.id) !== p.pickNumber).map((p) => p.member.id));
    renderWhatIf(appState, moved);
  }
  else if (act === 'reset-preds') { predictions = {}; renderWhatIf(appState); }
  else if (act === 'copy-update') {
    const ta = document.getElementById('update-text');
    navigator.clipboard?.writeText(ta.value).then(() => { btn.textContent = 'Copied ✓'; setTimeout(() => (btn.textContent = 'Copy'), 1500); })
      .catch(() => { ta.select(); document.execCommand?.('copy'); });
  }
  else if (act === 'mark-sent') { setBaseline(snapshot(appState)); render(); }
  else if (act === 'signout') store.signOut();
  else if (act === 'load-demo') { if (confirm('Load the DEMO tournament? This overwrites the live data for everyone.')) store.loadDemo(); }
  else if (act === 'reset') { if (confirm('Reset all data to the blank seed?')) store.resetAll(); }
  else if (act === 'signin') {
    const form = e.target.closest('[data-signin]');
    const email = form.querySelector('[data-field="email"]').value;
    const pw = form.querySelector('[data-field="password"]').value;
    store.signIn(email, pw).catch((err) => { document.getElementById('signin-err').textContent = err.message; });
  }
});

window.addEventListener('hashchange', render);

// Don't let the tab close while a write is still queued (e.g. offline) — the
// RTDB web SDK has no disk persistence, so an unsent write dies with the tab.
window.addEventListener('beforeunload', (e) => {
  if (writeStatus.pending > 0) { e.preventDefault(); e.returnValue = ''; }
});

// ===========================================================================
// wire to the store — re-render on any data or auth change (incl. cross-tab)
// ===========================================================================
applyTheme(theme);
store.subscribe((s) => { appState = s; render(); });
store.onAuthChanged((isAdmin) => { admin = isAdmin; render(); });
// Re-render on write status too: shows/clears the save toast, and after a
// BLOCKED write it snaps the admin controls back to the real (unsaved) state.
store.onWriteStatus((ws) => { writeStatus = ws; render(); });
