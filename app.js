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
import { teamProfiles, memberHistory, groups } from './profiles.js';

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
// Same medallion straight from a circle-flags iso code — for nations that
// aren't in teams[] (group-table rivals, R32 opponents on the sticker card).
function flagIso(iso, alt = '') {
  return `<img class="flag" src="flags/${esc(iso)}.svg" alt="${esc(alt)}" width="24" height="24" loading="lazy" />`;
}
const ME_KEY = 'wcdraft.me.v1';
const getMe = () => { try { return localStorage.getItem(ME_KEY); } catch { return null; } };
const setMe = (id) => { try { id ? localStorage.setItem(ME_KEY, id) : localStorage.removeItem(ME_KEY); } catch {} };

// Baseline for the "what changed" diff in the iMessage generator (admin device).
const BASELINE_KEY = 'wcdraft.updateBaseline.v1';
const getBaseline = () => { try { return JSON.parse(localStorage.getItem(BASELINE_KEY)); } catch { return null; } };
const setBaseline = (snap) => { try { localStorage.setItem(BASELINE_KEY, JSON.stringify(snap)); } catch {} };

// The finale confetti auto-fires ONCE per device (the plaque persists; its
// trophy replays the burst on demand). If storage fails, the `celebrated`
// module flag still limits it to once per page load.
const FINALE_KEY = 'wcdraft.finaleSeen.v1';
const finaleSeen = () => { try { return !!localStorage.getItem(FINALE_KEY); } catch { return false; } };
const setFinaleSeen = () => { try { localStorage.setItem(FINALE_KEY, '1'); } catch {} };
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
let celebrated = false; // auto-fire the completion burst once per page load (FINALE_KEY gates per device)
let summaryTeamId = null; // admin: which team's "2026 so far" text is being edited
let summaryDraft = null; // admin: unsaved textarea text — survives the re-render a live score triggers

const view = () => document.getElementById('view');

// lookups rebuilt per render
const teamMap = (state) => new Map(state.teams.map((t) => [t.id, t]));
const memberByTeam = (state) => { const m = new Map(); for (const x of state.members) if (x.teamId) m.set(x.teamId, x); return m; };
const myTeamId = (state) => { const m = state.members.find((x) => x.id === meId); return m ? m.teamId : null; };

// ===========================================================================
// Shared renderers
// ===========================================================================
// Sticker-card tap targets. Bound ONLY through these helpers so every surface
// is a deliberate choice: never inside another control (the what-if coupon
// cells are already <button>s — nested buttons are invalid HTML — and admin
// edit controls stay controls). Names inside prose sentences (wire stake
// lines, pens labels) also stay plain — the tap lives on the score row or
// label above them. The dotted gold underline (CSS .tapcard) is the
// "there's a card here" affordance.
function teamTap(team, inner) {
  if (!team || !teamProfiles[team.id]) return inner; // TBD/placeholder teams have no card
  return `<button type="button" class="tapcard" data-act="card" data-team="${esc(team.id)}" aria-haspopup="dialog" title="${esc(team.name)} — team card">${inner}</button>`;
}
function memberTap(member, inner) {
  if (!member) return inner;
  return `<button type="button" class="tapcard" data-act="card" data-member="${esc(member.id)}" aria-haspopup="dialog" title="${esc(member.name)} — league history">${inner}</button>`;
}

// Used by the bracket lines, schedule tickets and the marquee — all verified
// button-free contexts, so the label itself can be the card tap target.
function teamLabel(team) { return team ? teamTap(team, `${flag(team)} <span class="tl">${esc(team.name)}</span>`) : '<span class="tbd">— TBD —</span>'; }

function pickRow(p, { hideLock, newlyLocked, moved } = {}) {
  const top1 = p.pickNumber === 1 ? ' top1' : '';
  const aliveCls = p.alive ? ' alive' : '';
  // A locked pick's number block sits visibly deeper (see .pick.locked in CSS) so
  // locked positions read as locked regardless of their band colour. Hidden in the
  // what-if explorer (hideLock) where lock flags are meaningless.
  const lockedCls = !hideLock && p.locked ? ' locked' : '';
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
    <div class="pick${top1}${aliveCls}${lockedCls}${mineCls}${pulse}${movedCls}${bandCls}">
      <div class="pick-num">${p.pickNumber}</div>
      <div class="pick-main">
        <div class="pick-member">${memberTap(p.member, `<span>${esc(p.member.name)}</span>`)}${mineCls ? ' <span class="you">you</span>' : ''} ${tb}</div>
        <div class="pick-team">${p.team
          ? teamTap(p.team, `${flag(p.team)}<span class="team-name">${esc(p.team.name)}</span>`)
          : '<span class="team-name">unassigned</span>'}</div>
      </div>
      <div class="pick-meta">${bandTag}${statLine}${status}</div>
    </div>`;
}

function orderBlock(state, mode) {
  const { picks } = computeDraftOrder({ ...state, includeProvisional: mode === 'projected' });
  if (picks.length === 0) {
    return `<div class="empty">The draw hasn't been entered yet.</div>`;
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
      ${owner ? memberTap(owner, `<span class="ml-owner">${esc(owner.name)}</span>`) : ''}
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
  final: { label: 'Order set', cls: 'gold' }, // every pick locked — the page is now the record
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
// The completion celebration — a foil-heavy confetti shower (DOM + CSS only,
// no library; ~140 spans removed as one node). Auto-fired when the Final's
// entered result locks the whole order; replayed from the plaque's trophy.
// Replay-safe (tears down a running layer first) and reduced-motion aware.
function celebrate() {
  if (reducedMotion()) return;
  document.querySelector('.confetti-layer')?.remove();
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  layer.setAttribute('aria-hidden', 'true'); // purely decorative — hide from screen readers
  const colors = ['#c6a24c', '#d8452f', '#f3ecd9', '#0e6b52', '#efd98a']; // collectible: golds, coral, cream, green
  for (let i = 0; i < 140; i++) {
    const s = document.createElement('span');
    const round = i % 7 === 0; // a few sequin discs among the ribbons
    s.className = 'confetti' + (i % 4 === 0 ? ' foil' : '') + (round ? ' round' : '');
    if (i % 4 !== 0) s.style.background = colors[i % colors.length]; // foil pieces keep the CSS gradient
    const w = 6 + Math.random() * 5;
    s.style.width = w + 'px';
    s.style.height = (round ? w : 9 + Math.random() * 7) + 'px';
    s.style.left = Math.random() * 100 + '%';
    s.style.setProperty('--dx', ((Math.random() * 2 - 1) * 16).toFixed(1) + 'vw'); // sideways drift
    s.style.setProperty('--rz', Math.round(360 + Math.random() * 540) + 'deg');
    s.style.animationDelay = (Math.random() * 1.5).toFixed(2) + 's';
    s.style.animationDuration = (2.6 + Math.random() * 1.6).toFixed(2) + 's';
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 6000); // past max delay + duration
}

// The finale plaque — the Order page's record header once every pick is locked
// (phase 'final'). The champions line comes from the Final match itself, NOT
// picks[0]: the champion team can be one of the four undrawn teams (rule 2),
// in which case picks[0] is simply the best-finishing drawn team — and if the
// Final itself isn't decided yet (possible when neither finalist was drawn,
// so the order locked without it), the line is omitted until it is.
function finaleBlock(state, picks) {
  const finalMatch = state.matches.find((m) => m.round === 'Final');
  const wl = finalMatch ? matchWinnerLoser(finalMatch) : null;
  const champs = wl ? teamMap(state).get(wl.winner) : null;
  const first = picks[0], last = picks[picks.length - 1];
  const k = finalMatch ? kickoffMs(finalMatch) : null;
  return `<section class="finale" aria-label="The final draft order">
    <button type="button" class="fin-trophy" data-act="celebrate" title="More confetti" aria-label="More confetti">
      <svg width="44" height="44" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <defs><linearGradient id="fin-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#efd98a"/><stop offset=".48" stop-color="#c6a24c"/>
          <stop offset=".52" stop-color="#a07d2c"/><stop offset="1" stop-color="#e6cf82"/>
        </linearGradient></defs>
        <path fill="url(#fin-gold)" d="M7 3h10v4.4a5 5 0 0 1-10 0Z"/>
        <path fill="none" stroke="url(#fin-gold)" stroke-width="1.5" d="M7 4.6H3.9a3.3 3.3 0 0 0 3.5 3.8M17 4.6h3.1a3.3 3.3 0 0 1-3.5 3.8"/>
        <path fill="url(#fin-gold)" d="M10.7 12.2h2.6l.6 4.4h-3.8Z"/>
        <rect fill="url(#fin-gold)" x="7.6" y="16.4" width="8.8" height="2.4" rx="0.7"/>
      </svg>
    </button>
    <p class="fin-eyebrow">2026 World Cup · full time</p>
    <h2 class="fin-title">Final <em>order.</em></h2>
    ${champs ? `<p class="fin-champs">${teamTap(champs, `${flag(champs)} <span class="tl">${esc(champs.name)}</span>`)}<span class="fin-chip">champions</span></p>` : ''}
    <p class="fin-picks">${memberTap(first.member, `<strong>${esc(first.member.name)}</strong>`)} picks ${nth(first.pickNumber)} · ${memberTap(last.member, `<strong>${esc(last.member.name)}</strong>`)} picks ${nth(last.pickNumber)}</p>
    ${k != null ? `<p class="fin-date">decided ${esc(new Date(k).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }))}</p>` : ''}
  </section>`;
}

function meBar(state) {
  const me = state.members.find((x) => x.id === meId);
  if (!me) {
    return `<div class="me-bar">
      <select data-act="setme" aria-label="Find your name">
        <option value="">choose your name…</option>
        ${state.members.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}
      </select>
    </div>`;
  }
  const team = state.teams.find((t) => t.id === me.teamId);
  const { picks } = computeDraftOrder({ ...state, includeProvisional: true });
  const mine = picks.find((p) => p.member.id === me.id);
  const teamBtn = team ? teamTap(team, `${flag(team)} <span class="tl">${esc(team.name)}</span>`) : '';
  const standing = !team ? 'not assigned yet'
    : !mine ? teamBtn
    : `${teamBtn} · currently pick&nbsp;${mine.pickNumber} ${mine.locked ? '(locked)' : mine.alive ? '(still alive)' : '(if it stands)'}`;
  return `<div class="me-bar mine">
    <span>You're ${memberTap(me, `<strong>${esc(me.name)}</strong>`)} — ${standing}</span>
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

  const gdTxt = (gd) => `GD ${gd > 0 ? '+' : gd < 0 ? '−' : ''}${Math.abs(gd)}`;
  // Only lines that carry real news get printed (Dylan: readability, visibility,
  // clear understanding — if there's nothing interesting to say, say nothing):
  //   scheduled  → just whose teams are in the game (win = alive is obvious, and
  //                a hypothetical loser's exact pick isn't a promise tiebreaks
  //                let us make)
  //   live       → only owners whose team is OUT as it stands, with the same
  //                provisional number the ladder shows right now (real score,
  //                nothing invented); leading or level = no news
  //   full-time  → only the eliminated owner (their band is now set; the number
  //                stays "for now" until it locks) — a winner simply stays alive
  // The Final and 3rd-place game are the exception: one match = one finish, so
  // win/loss numbers are exact there and worth stating up front.
  const FINISH = { Final: ['champion', 'runner-up'], '3rd': ['third place', 'fourth place'] };
  const stakeLines = (m) => {
    const exact = !!FINISH[m.round];
    const owners = [m.teamA, m.teamB].map((t) => ({ t, o: mbt.get(t) })).filter((x) => x.o);
    if (!owners.length) return '';
    const pkOf = (o) => current.find((x) => x.member.id === o.id);
    const name = (t) => esc(tm.get(t)?.name ?? '');
    const out = [];
    if (m.status === 'final') {
      const wl = matchWinnerLoser(m);
      for (const { t, o } of owners) {
        const pk = pkOf(o);
        if (!wl || !pk) continue;
        const tail = pk.locked ? `pick <strong>${pk.pickNumber}</strong>, locked in` : `pick <strong>${pk.pickNumber}</strong> for now`;
        if (exact) out.push(`<div class="wi-line ${wl.winner === t ? 'good' : 'bad'}"><strong>${esc(o.name)}</strong> (${name(t)}): ${FINISH[m.round][wl.winner === t ? 0 : 1]} — ${tail}</div>`);
        else if (wl.loser === t) {
          const gd = t === m.teamA ? (m.scoreA ?? 0) - (m.scoreB ?? 0) : (m.scoreB ?? 0) - (m.scoreA ?? 0);
          out.push(m.decidedByPens
            ? `<div class="wi-line bad"><strong>${esc(o.name)}</strong> (${name(t)}): out on pens — counts as a draw, ${gdTxt(gd)} — ${tail}</div>`
            : `<div class="wi-line bad"><strong>${esc(o.name)}</strong> (${name(t)}): out, ${gdTxt(gd)} — ${tail}</div>`);
        }
      }
    } else if (exact) {
      // the tournament's only hypotheticals — two engine runs, two matches, exact
      const ordA = pickIf(m, m.teamA), ordB = pickIf(m, m.teamB);
      for (const { t, o } of owners) {
        const pW = pickOf(t === m.teamA ? ordA : ordB, o.id), pL = pickOf(t === m.teamA ? ordB : ordA, o.id);
        if (pW == null || pL == null) continue;
        const mine = t === m.teamA ? (m.scoreA ?? 0) : (m.scoreB ?? 0);
        const theirs = t === m.teamA ? (m.scoreB ?? 0) : (m.scoreA ?? 0);
        const txt = m.status !== 'in_progress' || mine === theirs
          ? `pick <strong>${pW}</strong> with a win · pick <strong>${pL}</strong> with a loss`
          : mine > theirs
            ? `pick <strong>${pW}</strong> if this score holds · pick <strong>${pL}</strong> if ${name(t === m.teamA ? m.teamB : m.teamA)} win`
            : `pick <strong>${pL}</strong> if this score holds · pick <strong>${pW}</strong> if ${name(t)} win`;
        out.push(`<div class="wi-line"><strong>${esc(o.name)}</strong> (${name(t)}): ${txt}</div>`);
      }
    } else if (m.status === 'in_progress') {
      for (const { t, o } of owners) {
        const mine = t === m.teamA ? (m.scoreA ?? 0) : (m.scoreB ?? 0);
        const theirs = t === m.teamA ? (m.scoreB ?? 0) : (m.scoreA ?? 0);
        const pk = pkOf(o);
        if (mine >= theirs || !pk) continue; // leading or level: no news yet
        out.push(`<div class="wi-line bad"><strong>${esc(o.name)}</strong> (${name(t)}): out as it stands — pick <strong>${pk.pickNumber}</strong> for now</div>`);
      }
    } else {
      // scheduled: visibility only — whose teams are on the line today
      out.push(`<div class="wi-line">${owners.map(({ t, o }) => `<strong>${esc(o.name)}</strong>’s ${name(t)}`).join(' · ')}</div>`);
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
    return `<div class="wi-score">${badge}${teamTap(a, `${flag(a)} <span class="tl">${esc(a.name)}</span>`)} ${mid} ${teamTap(b, `<span class="tl">${esc(b.name)}</span> ${flag(b)}`)}${pens}</div>`;
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

  // No mode banner: the phase pill, the lock tally, the toggle labels and the
  // per-plate badges already SHOW everything the banner used to tell.
  const controls = picks.length ? `
    <div class="toggle">
      <button data-act="mode" data-mode="projected" class="${viewMode === 'projected' ? 'on' : ''}">Projected</button>
      <button data-act="mode" data-mode="locked" class="${viewMode === 'locked' ? 'on' : ''}">Locked only</button>
    </div>` : '';

  const body = picks.length
    ? `<div class="picks ladder">${picks.map((p) => pickRow(p, { newlyLocked })).join('')}</div>`
    : `<div class="empty">The draw hasn't been entered yet.</div>`;

  view().innerHTML = `
    ${nav()}${meBar(state)}
    ${phase === 'final' ? finaleBlock(state, picks) : ''}
    <div class="statusline">
      <span class="phase-pill ${PHASE[phase].cls}">${PHASE[phase].label}</span>
      ${picks.length ? `<span class="lock-tally">${lockedCount}/12 locked</span>` : ''}
    </div>
    ${picks.length ? matchdayWire(state) : ''}
    ${controls}
    ${body}
    <h2 class="section-title">Out of play</h2>
    <div class="unassigned">
      ${unassigned.map((t) => `<span class="chip">${teamTap(t, `${flag(t)} <span class="tl">${esc(t.name)}</span>`)}</span>`).join('') || '<span class="chip">—</span>'}
    </div>
    ${trustStamps(state)}`;

  prevLocked = nowLocked;
  // The completion moment: the render where the Final's entered result locks
  // the last picks. A viewer watching live gets the burst the instant it lands;
  // later visitors get it once (per device) on first sight of the finished
  // order. A result edit that un-finals and re-finals never re-fires it.
  if (phase === 'final') {
    if (!celebrated) {
      celebrated = true;
      if (!finaleSeen()) { setFinaleSeen(); celebrate(); }
    }
  } else celebrated = false;
}

// ===========================================================================
// SCHEDULE + countdown
// ===========================================================================
// The "hot ticket" marquee: the live match (score) or the next kickoff (countdown).
function featuredNext(state) {
  const next = nextMatch(state.matches, Date.now());
  if (!next) return `<div class="marquee done">Tournament complete.</div>`;

  const tm = teamMap(state);
  const teams = `${teamLabel(tm.get(next.teamA))} <span class="mq-v">v</span> ${teamLabel(tm.get(next.teamB))}`;
  const k = kickoffMs(next);
  if (next.status === 'in_progress') {
    return `<div class="marquee live">
      <div class="mq-tag"><span class="livedot"></span> Live now · ${ROUND_LABEL[next.round]}</div>
      <div class="mq-teams">${teams}</div>
      <div class="mq-score">${next.scoreA ?? 0} – ${next.scoreB ?? 0}</div>
      ${next.venue ? `<div class="mq-sub">${esc(next.venue)}</div>` : ''}
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
      ${owner ? memberTap(owner, `<span class="tk-owner">${esc(owner.name)}</span>`) : ''}${scoreTxt}</div>`;
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
  // "· local time" rides the FIRST band only — the one place the (unshowable)
  // timezone fact still needs words, folded where the eye already is.
  const band = (label, n, tz) => `<div class="day-band"><span class="db-day">${label}</span><span class="db-rule"></span><span class="db-count">${n} ${n === 1 ? 'match' : 'matches'}${tz ? ' · local time' : ''}</span></div>`;
  const dayBlock = (g, i) => `
    ${band(esc(g.day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })), g.items.length, i === 0)}
    <div class="ticket-list">${g.items.map((m) => scheduleTicket(m, state)).join('')}</div>`;

  view().innerHTML = `
    ${nav()}${meBar(state)}
    ${featuredNext(state)}
    ${groups.map(dayBlock).join('')}
    ${undated.length ? `${band('Times TBD', undated.length, groups.length === 0)}<div class="ticket-list">${undated.map((m) => scheduleTicket(m, state)).join('')}</div>` : ''}`;
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
  view().innerHTML = `${nav()}${meBar(state)}${rounds.map(block).join('')}`;
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
// "2026 so far" editor for the sticker cards: pick a team, type 1–3 sentences,
// save. Writes to /state/summaries/<teamId> — live for every viewer instantly,
// no deploy. summaryDraft (module state) keeps unsaved text across the
// re-renders that live score updates trigger.
function summariesEditor(state) {
  const current = state.teams.find((t) => t.id === summaryTeamId) ?? state.teams[0];
  if (!current) return '';
  const saved = state.summaries?.[current.id] ?? '';
  return `
    <h2 class="section-title">Team cards — “2026 so far”</h2>
    <div class="summary-box">
      <select data-act="pick-summary-team" aria-label="Team whose summary to edit">
        ${state.teams.map((t) => `<option value="${esc(t.id)}" ${t.id === current.id ? 'selected' : ''}>${esc(t.flagEmoji)} ${esc(t.name)}${state.summaries?.[t.id] ? ' ·' : ''}</option>`).join('')}
      </select>
      <textarea data-field="summary-text" rows="3" maxlength="400" aria-label="${esc(current.name)} — 2026 summary"
        placeholder="Optional colour for ${esc(current.name)}’s card — the table and results are already on it.">${esc(summaryDraft ?? saved)}</textarea>
      <div class="admin-actions">
        <button data-act="save-summary" class="btn-secondary">Save summary</button>
        <p class="hint">Empty + save removes the section. A “·” marks teams with one.</p>
      </div>
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
        <p class="hint">Everything else on the site is public — leaguemates never need an account.</p>
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
    ${summariesEditor(state)}
    <h2 class="section-title">League update (paste into the group chat)</h2>
    <div class="update-box">
      <textarea id="update-text" class="update-text" readonly rows="14" aria-label="League update text">${esc(formatUpdate({ state, baseline: getBaseline(), url: publicUrl(), now: Date.now() }))}</textarea>
      <div class="admin-actions">
        <button data-act="copy-update" class="btn-secondary">Copy</button>
        <button data-act="mark-sent" class="btn-secondary">Mark as sent (reset "since last update")</button>
      </div>
      <p class="hint">"Mark as sent" snapshots the current order so the next update only lists what changed after it.</p>
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
        <span class="punches" role="img" aria-label="Marked ${marked} of ${editable.length}">${punches}</span>
        <button data-act="reset-preds" class="btn-secondary">Clear coupon</button>
      </div>
      <p class="coupon-note">Nothing here is saved or shared · <a href="#help">how ties split</a></p>
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
  view().innerHTML = `
    ${nav()}
    <div class="prog-mast">
      <h2 class="prog-title">How the draft order works</h2>
    </div>

    <h2 class="law-head"><span class="law-no">1</span>The finish ladder</h2>
    <p class="prose">Each of the 12 members is randomly assigned one Round-of-16 team. Your draft pick is
      <strong>how far your team goes</strong> — the further, the earlier you pick.</p>
    <div class="finish-ladder">
      <div class="ladder-cap">← better pick</div>
      ${ladder.map(([cls, count, n, d]) => `<div class="ladder-row ${cls}">
        <span class="lad-num">${count}<em>${count === '1' ? 'pick' : 'picks'}</em></span>
        <span class="lad-n">${n}</span><span class="lad-d">${d}</span></div>`).join('')}
      <div class="ladder-cap">worse pick →</div>
    </div>
    <p class="prose">Only the 12 drawn teams are ranked — unassigned teams are skipped and everyone below
      slides up.</p>

    <h2 class="law-head"><span class="law-no">2</span>Tiebreakers — same exit round only</h2>
    <p class="prose">Two teams knocked out in the same round are ordered by, in order:
      <strong>1)</strong> goal difference in their elimination match, <strong>2)</strong> goals scored in it,
      <strong>3)</strong> their tiebreak number (a distinct 1–12 drawn for everyone, lower = better).</p>
    <div class="worked">
      <div class="worked-title">Worked example — two R16 losers, one shootout</div>
      <p>A shootout counts as a draw, so Team B's recorded score is 0–0:</p>
      <div class="wx-row"><span class="wx-team">Team A</span><span class="wx-score">1–2</span><span class="wx-note">lost in normal time</span><span class="wx-gd">GD −1</span></div>
      <div class="wx-row"><span class="wx-team">Team B</span><span class="wx-score">0–0</span><span class="wx-note">lost the shootout</span><span class="wx-gd win">GD 0</span></div>
      <p>Higher GD gets the better pick, so <strong>Team B picks ahead of Team A</strong> — even though it
        "lost" its shootout.</p>
      <p class="wx-freq">Not a rare wrinkle: in a 10,000-tournament simulation, a shootout loser out-picked a
        regulation loser in about half of them.</p>
    </div>
`;
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
// ===========================================================================
// STICKER CARD — tap a country → team card; tap a leaguemate → their league
// history, which is literally the card BACK (3-D flip; the global
// reduced-motion rule collapses the turn to an instant swap). Content is a
// snapshot of the state at open time — live score updates re-render #view but
// deliberately leave an open card alone (it sits outside #app).
// ===========================================================================
const cardDialog = () => document.getElementById('card-dialog');

const nth = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]); };
// Foil stars — one per title/championship, struck in the pick-1 gradient.
const foilStars = (n) => (n ? `<span class="foil-stars">${'★'.repeat(n)}</span>` : '<span class="sc-none">—</span>');
const statRow = (label, value, sub) =>
  `<div class="sc-row"><span class="sc-label">${label}</span><span class="sc-val">${value}${sub ? `<em>${sub}</em>` : ''}</span></div>`;

// The final group table, straight standings — the viewer's team struck gold,
// advancing rows carrying the app's green "alive" dot instead of a caption.
function groupTable(team, p) {
  const rows = groups[p.group];
  if (!rows) return '';
  const myIso = isoFromFlag(team.flagEmoji);
  return `<p class="sc-sec">Group ${esc(p.group)} — final table</p>
  <table class="sc-table">
    <thead><tr><th class="t-team">Team</th><th>W</th><th>D</th><th>L</th><th class="t-g">GF–GA</th><th>Pts</th></tr></thead>
    <tbody>${rows.map(([iso, name, w, d, l, gf, ga, adv]) => `
      <tr class="${iso === myIso ? 'me' : ''}">
        <td class="t-team">${flagIso(iso)}<span class="t-name">${esc(name)}</span>${adv ? '<span class="t-adv" title="advanced to the knockouts" aria-label="advanced"></span>' : ''}</td>
        <td>${w}</td><td>${d}</td><td>${l}</td><td class="t-g">${gf}–${ga}</td><td class="t-pts">${w * 3 + d}</td>
      </tr>`).join('')}</tbody>
  </table>`;
}

// The knockout run as scorelines: the (static, pre-app) R32 result, then this
// team's live matches straight from the store — the card updates itself as
// rounds finish, no prose to rewrite. Opponents are tappable (their card
// replaces this one in the open dialog).
const RUN_MARK = { R16: 'R16', QF: 'QF', SF: 'SF', '3rd': '3rd', Final: 'F' };
function knockoutRun(team, state, p) {
  const rows = [];
  if (p.r32) rows.push(`<div class="run-row win">
    <span class="run-mark">R32</span>
    <span class="run-opp">${flagIso(p.r32.iso)}<span class="tl-plain">${esc(p.r32.name)}</span></span>
    <span class="run-res">${esc(p.r32.score)}${p.r32.pens ? ' <em>won pens</em>' : ''}</span>
  </div>`);
  for (const m of state.matches) {
    if (m.teamA !== team.id && m.teamB !== team.id) continue;
    const opp = state.teams.find((t) => t.id === (m.teamA === team.id ? m.teamB : m.teamA));
    const mine = m.teamA === team.id ? m.scoreA : m.scoreB;
    const theirs = m.teamA === team.id ? m.scoreB : m.scoreA;
    const wl = matchWinnerLoser(m); // final only
    const won = wl && wl.winner === team.id;
    const k = kickoffMs(m);
    const res = m.status === 'final'
      ? `${mine}–${theirs}${m.decidedByPens ? ` <em>${m.penWinner === team.id ? 'won' : 'lost'} pens</em>` : ''}`
      : m.status === 'in_progress' ? `<em class="run-live">LIVE</em> ${mine ?? 0}–${theirs ?? 0}`
      : k != null ? `<em>${esc(new Date(k).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</em>` : '<em>TBD</em>';
    rows.push(`<div class="run-row${wl ? (won ? ' win' : ' lose') : ''}">
      <span class="run-mark">${RUN_MARK[m.round] ?? esc(m.round)}</span>
      <span class="run-opp">${opp ? teamTap(opp, `${flag(opp)}<span class="tl">${esc(opp.name)}</span>`) : '<span class="tbd">— TBD —</span>'}</span>
      <span class="run-res">${res}</span>
    </div>`);
  }
  return rows.length ? `<p class="sc-sec">Knockout run</p><div class="sc-run">${rows.join('')}</div>` : '';
}

function teamFace(team, state, { canFlip, owner }) {
  const p = teamProfiles[team.id];
  const summary = state.summaries?.[team.id]; // optional admin colour — the table + run above show the facts
  return `<div class="card-face sc-front" role="group" aria-label="${esc(team.name)} — team card">
    <div class="sc-head">
      ${flag(team)}
      <div class="sc-title">
        <p class="sc-eyebrow">2026 World Cup</p>
        <p class="sc-name">${esc(team.name)}</p>
      </div>
      <span class="sc-code">${esc(team.code ?? team.id)}</span>
    </div>
    ${p ? `${groupTable(team, p)}
    ${knockoutRun(team, state, p)}
    <div class="sc-stats">
      ${statRow('World Cups', `${nth(p.appearances)} appearance`, `debut ${p.debut}`)}
      ${statRow('Titles', foilStars(p.titles))}
      ${statRow('Best finish', esc(p.bestFinish))}
    </div>
    <p class="sc-sec">Key players</p>
    <p class="sc-players">${p.keyPlayers.map(esc).join(' · ')}</p>
    ${p.note ? `<p class="sc-note">${esc(p.note)}</p>` : ''}` : ''}
    ${summary ? `<p class="sc-sec">2026 so far</p><p class="sc-summary">${esc(summary)}</p>` : ''}
    <div class="sc-foot">
      <span class="sc-ownerline">${owner
        ? `Drawn by <strong>${esc(owner.name)}</strong>${owner.tiebreakNumber != null ? ` · tiebreak #${owner.tiebreakNumber}` : ''}`
        : 'Not drawn — out of play'}</span>
      ${canFlip ? `<button type="button" class="sc-flip" data-act="card-flip">⟲ ${esc(owner.name)}’s league history</button>` : ''}
    </div>
  </div>`;
}

function memberFace(member, state, { canFlip, team }) {
  const h = memberHistory[member.name]; // keyed by display name; a miss shows NO stats (never someone else's)
  const winPct = h ? (h.wins / (h.wins + h.losses)).toFixed(3).replace(/^0/, '') : null;
  return `<div class="card-face sc-back" role="group" aria-label="${esc(member.name)} — league history">
    <div class="sc-head">
      <div class="sc-title">
        <p class="sc-eyebrow">LPPC league history</p>
        <p class="sc-name">${esc(member.name)}</p>
      </div>
    </div>
    ${h ? `<div class="sc-stats">
      ${statRow('Seasons', h.seasons, esc(h.tenure))}
      ${statRow('All-time record', `${h.wins}–${h.losses}`, `${winPct} win rate`)}
      ${statRow('Last season', `${nth(h.lastSeasonFinish)} of 12`)}
      ${statRow('Championships', foilStars(h.championships))}
      ${statRow('Last places', h.lastPlaces || '<span class="sc-none">—</span>')}
      ${statRow('Avg draft spot', h.avgDraftSpot.toFixed(1))}
    </div>` : '<p class="sc-note">No league history on file for this name.</p>'}
    <div class="sc-foot">
      <span class="sc-ownerline">${team ? `2026 team: <strong>${esc(team.name)}</strong>` : 'No team drawn'}</span>
      ${canFlip ? `<button type="button" class="sc-flip" data-act="card-flip">⟲ ${esc(team.name)} team card</button>` : ''}
    </div>
  </div>`;
}

// Hidden face: unreachable by pointer (CSS) AND by assistive tech / tabbing.
function syncCardFaces(c3) {
  const flipped = c3.classList.contains('flipped');
  c3.querySelector('.sc-front')?.toggleAttribute('inert', flipped);
  c3.querySelector('.sc-back')?.toggleAttribute('inert', !flipped);
}

function openCard({ teamId, memberId }) {
  const state = appState;
  let team = teamId ? state.teams.find((t) => t.id === teamId) : null;
  let member = memberId ? state.members.find((m) => m.id === memberId) : null;
  if (member && !team) team = state.teams.find((t) => t.id === member.teamId) ?? null;
  if (team && !member) member = memberByTeam(state).get(team.id) ?? null;
  if (!team && !member) return;

  const canFlip = !!(team && member);
  const startFlipped = canFlip && !!memberId; // a member tap opens on the history side
  const faces = `${team ? teamFace(team, state, { canFlip, owner: member }) : ''}
                 ${member ? memberFace(member, state, { canFlip, team }) : ''}`;
  const dlg = cardDialog();
  dlg.innerHTML = `
    <button type="button" class="sc-close" data-act="card-close" aria-label="Close card">✕</button>
    <div class="card3d${startFlipped ? ' flipped' : ''}">${faces}</div>`;
  const c3 = dlg.querySelector('.card3d');
  if (canFlip) syncCardFaces(c3);
  // A tap on an opponent inside the knockout-run block swaps the card in
  // place — calling showModal() on an already-open dialog would throw.
  if (!dlg.open) dlg.showModal();
}

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
  else if (act === 'pick-summary-team') { summaryTeamId = e.target.value; summaryDraft = null; render(); }
});

// The summary textarea saves on the button, not on change — so a live-score
// re-render mid-sentence must not eat the draft. Track it as it's typed.
document.addEventListener('input', (e) => {
  if (e.target.dataset.field === 'summary-text') summaryDraft = e.target.value;
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  const act = btn ? btn.dataset.act : null;
  if (!act) return;
  if (act === 'mode') { viewMode = btn.dataset.mode; render(); }
  else if (act === 'card') openCard({ teamId: btn.dataset.team, memberId: btn.dataset.member });
  else if (act === 'card-close') cardDialog().close();
  else if (act === 'card-flip') {
    const c3 = cardDialog().querySelector('.card3d');
    c3.classList.toggle('flipped');
    syncCardFaces(c3);
    // the button just tapped is now on the hidden face — hand focus to its twin
    c3.querySelector('.card-face:not([inert]) .sc-flip')?.focus();
  }
  else if (act === 'save-summary') {
    const ta = document.querySelector('[data-field="summary-text"]');
    store.setSummary(document.querySelector('[data-act="pick-summary-team"]').value, ta.value.trim());
    summaryDraft = null; // saved — let renders show the store's truth again
  }
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
  else if (act === 'celebrate') celebrate(); // the plaque's trophy: confetti encore
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

// Sticker card: a tap on the backdrop closes it (a click there targets the
// <dialog> element itself, never the card inside). Esc is native to showModal.
cardDialog().addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

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
