# AUTOMATION.md — live-scores poller design (v1)

Design doc for automating score entry. Decided 2026-07-04 with Dylan:
**auto-final with double-check · cards deferred to v2 · box score = expandable
Schedule ticket (v1.5) · matchday live loop + results sweep · DB kill switch.**

The client stays zero-external-request. Only a GitHub Actions workflow talks to
football-data.org, and it writes into the RTDB; the app just renders DB data.

---

## 1. The write credential (security model)

The DB rule is public-read / admin-UID-write, so the poller needs its own
server-side credential. Three options considered:

| Option | What it is | Blast radius if leaked |
|---|---|---|
| Service account JSON | Firebase Admin SDK key in GH Secrets | **Entire project** — bypasses ALL security rules, full read/write everywhere |
| Legacy DB secret | Deprecated token auth | Full DB. Deprecated; no. |
| **Dedicated poller Auth user** ✅ | Second email/password user in Firebase Auth; rules grant its UID write access to ONLY the paths it needs | Match fields + `/box` + `/automation` heartbeat only. Cannot wipe `/state`, cannot touch `/backup`, cannot flip the kill switch. Revoke = disable the user in the console. |

**Chosen: dedicated poller Auth user.** The workflow signs in via the Identity
Toolkit REST API (`signInWithPassword`, using the public web `apiKey` from
firebaseConfig — not a secret) and gets a 1-hour ID token, refreshed in-loop at
~50 min. RTDB REST calls append `?auth=<idToken>`. No SDK, no service account,
plain `fetch` — auditable in one file.

### Rules change (Dylan applies in Firebase console; back up current rules text first)

```json
{
  "rules": {
    ".read": true,
    "state": {
      ".write": "auth != null && auth.uid === '<ADMIN_UID>'",
      "matches": {
        "$idx": { ".write": "auth != null && (auth.uid === '<ADMIN_UID>' || auth.uid === '<POLLER_UID>')" }
      },
      "meta": {
        "lastUpdated": { ".write": "auth != null && (auth.uid === '<ADMIN_UID>' || auth.uid === '<POLLER_UID>')" }
      }
    },
    "backup":     { ".write": "auth != null && auth.uid === '<ADMIN_UID>'" },
    "box":        { ".write": "auth != null && (auth.uid === '<ADMIN_UID>' || auth.uid === '<POLLER_UID>')" },
    "automation": {
      ".write": "auth != null && (auth.uid === '<ADMIN_UID>' || auth.uid === '<POLLER_UID>')",
      "enabled": { ".write": "auth != null && auth.uid === '<ADMIN_UID>'" }
    }
  }
}
```

Note: the kill switch (`/automation/enabled`) is **admin-write-only** — even a
leaked poller credential can't turn automation back on.

### GitHub Actions Secrets (never in the repo)

- `FOOTBALL_DATA_KEY` — football-data.org v4 API key
- `POLLER_EMAIL`, `POLLER_PASSWORD` — the poller Auth user

---

## 2. DB schema additions (both OUTSIDE `/state`, invisible to the client's `onValue('state')`)

```
/automation
  enabled: false            ← kill switch; poller exits immediately when not true (admin-only write)
  fixtureMap: { "89": 419512, ... }   ← our match id → football-data match id, built once, persisted
  pendingFinal: { "97": { seenAt, scoreA, scoreB } }  ← first-FINISHED marker for the double-check
  lastRun: { at, mode, notes }        ← heartbeat
  log: { <push-id>: { at, matchId, patch, prev } }    ← audit trail of every write (capped)
  preAutomationSnapshot: { savedAt, state }           ← full /state copy taken by the first write-enabled run

/box/<matchId>              ← v1.5 goalscorers (client gets a new store.js subscription later)
  { updatedAt, scorers: [{ minute, name, teamId, type: "goal"|"og"|"pen" }] }
```

---

## 3. The poller — `scripts/poller.mjs` (zero dependencies, Node 22)

Imports `resolveBracket` + `bracketTopology` + `teams` from the app's own
modules — winner propagation uses the **same code** `store.js` uses, no drift.

One cycle:

1. `GET /automation.json` → `enabled !== true` → log + exit 0 (kill switch).
2. `GET /state.json` → current matches array (id → array index mapping; QF+
   matches may omit `teamA`/`teamB` — RTDB drops nulls).
3. `GET api.football-data.org/v4/competitions/WC/matches?dateFrom=…&dateTo=…`
   (1 request; free tier = 10/min, we use ≤2).
4. Map API fixtures → our ids via persisted `fixtureMap`; build missing entries
   by joining on **kickoff UTC + stage** (all 16 kickoffs are unique), verify
   team TLAs when known. A team-name conflict on a mapped match = log ERROR,
   skip the match, never write silently.
5. Compute desired patch per match: `scoreA`/`scoreB` (end-of-ET score;
   penalties live in the API's separate `score.penalties` field),
   `decidedByPens` (duration === `PENALTY_SHOOTOUT`), `penWinner` (API
   `score.winner` → team id), `status` (TIMED/SCHEDULED→scheduled,
   IN_PLAY/PAUSED→in_progress, FINISHED→final).
6. **Auto-final double-check:** first poll seeing FINISHED writes a
   `pendingFinal` marker and keeps status `in_progress`; the next poll (60s
   later in live mode, next sweep in cron mode) still FINISHED with the same
   score → status `final`. A DB match already `final` is NEVER touched again —
   admin corrections always win.
7. Diff vs DB, `PATCH /state/matches/<idx>.json` with only changed fields
   (targeted patch — cannot clobber a concurrent admin whole-state write; if
   admin's write clobbers ours, the next cycle converges).
8. If an outcome settled, run `resolveBracket` and PATCH downstream
   `teamA`/`teamB` diffs (QF winners feed SFs, etc.). Patch `meta/lastUpdated`.
9. Write `/automation/lastRun` + append `/automation/log` entries.

**Loop mode is emergent, not configured:** every trigger runs the same script;
it loops (60s sleep) while any match is in-progress or within 15 min of
kickoff, otherwise does a single pass and exits. Job-level `timeout-minutes`
caps runaway loops. `DRY_RUN=1` prints every intended PATCH (before → after)
to the Actions log and writes **nothing** — it doesn't even need the Firebase
credential, only the football-data key.

---

## 4. Workflow — `.github/workflows/poller.yml`

- `workflow_dispatch` with a `dry_run` input (default **true** until we flip it).
- `schedule` crons a few minutes before each remaining kickoff (UTC):
  QFs Jul 9 20:00 / Jul 10 19:00 / Jul 11 21:00 / Jul 12 01:00 · SFs Jul 14
  19:00 / Jul 15 19:00 · 3rd Jul 18 21:00 · Final Jul 19 19:00 — plus two
  daily sweeps (09:00, 15:00 UTC) to catch anything missed.
- `concurrency: { group: poller }` so runs never overlap; a queued run that
  finds nothing live exits in seconds.
- CI (`ci.yml`) untouched; a new `poller.test.js` for the pure mapping/diff
  functions joins it as a third step.

---

## 5. Failure modes

| Failure | Behaviour |
|---|---|
| API down / 429 | Log, skip cycle, retry next; persistent failure fails the job → GitHub emails Dylan |
| API sends wrong data | Double-check delays finals 60s; kill switch stops it; finals already set are never overwritten; admin corrects via the normal UI |
| Admin whole-state write races a poller patch | Poller re-reads and re-patches next cycle (converges ≤60s) |
| Rules misconfigured / token rejected | PATCH gets permission-denied → job fails loudly, zero data harm |
| Token expires mid-loop | Proactive re-auth at 50 min; one retry on 401 |
| FIFA reschedules a kickoff | fixtureMap is persisted early; join key only used once per match |
| Actions cron late (5–15 min) | Live loop covers the rest of the window once started; manual `workflow_dispatch` is the backstop |

## 6. Undo path

1. **Kill switch:** set `/automation/enabled = false` (console or Admin page) — poller exits on next cycle. Belt-and-braces: disable the workflow in the GitHub Actions UI.
2. **Every write is logged** with its previous value (`/automation/log` + the Actions run log) — any single patch is hand-reversible.
3. **`/automation/preAutomationSnapshot`** holds the full pre-automation `/state`; `/backup` (admin one-slot) is untouched by the poller.
4. **Revoke credentials:** disable the poller user in Firebase Auth console; rotate `FOOTBALL_DATA_KEY` at football-data.org.
5. Rules rollback: restore the backed-up rules text in the console.

## 7. Rollout phases

- **A — build + dry run (now):** `poller.mjs` + workflow, `DRY_RUN` default on.
  Needs only `FOOTBALL_DATA_KEY`. Run during R16 (Jul 4–7) while Dylan enters
  scores manually; compare the logged would-be patches against his entries.
- **B — credential setup:** Dylan creates the poller Auth user + applies rules
  (console), adds the three secrets. Dry run repeats, now also proving auth via
  a `/automation/lastRun` heartbeat write (the one write dry-run allows).
- **C — enable writes** before QF kickoff Jul 9: seed `/automation/enabled=true`,
  flip `dry_run` default. First live matchday watched together.
- **v1.5:** goalscorers → `/box`, ticket-expansion UI (frontend-design skill,
  Collectible system). **v2:** cards/stats source decision.
