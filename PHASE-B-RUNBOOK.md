# Phase B runbook — poller credential setup (Dylan, solo, tonight Jul 8)

One-time operational guide, written 2026-07-08. Expands AUTOMATION.md §8 into
click-by-click steps. Safe to delete (or commit, your call) once Phase B is done.

**What Phase B is:** the poller has been rehearsing in dry-run mode all week —
reading the football API and *printing* what it would write, never writing.
Phase B gives it a real (but tightly limited) key to the database and proves
the key works, on the tournament's only blank day. No automation turns on
tonight; that's Phase C tomorrow.

**Why a dedicated Auth user instead of a service account:** a service-account
key in GitHub bypasses ALL security rules — if it leaks, the whole project is
writable. A second email/password user, granted write access by UID to only
the paths the poller needs, can at worst scribble on match scores — it cannot
delete `/state`, touch `/backup`, or turn automation on. Revoking it is one
click (disable the user).

**Time:** ~20–30 min. **You need:** a browser signed into the Firebase
console, your password manager, and a terminal in the repo directory with
`gh` working.

**Precondition (already verified ✓):** all 8 R16 results are entered and
`final` in the live DB (match 96 SUI–COL included). This matters because a
write-enabled run fills gaps for real — with everything final, it has nothing
to write except its own heartbeat.

---

## Step 1 — Back up the current database rules (your undo path)

1. Open <https://console.firebase.google.com> → project
   **draft-order-world-cup-26**.
2. Left sidebar → **Build → Realtime Database** → **Rules** tab.
3. Select ALL the rules text, copy it, and paste into a new local file
   **outside the repo**, e.g. `~/Documents/rtdb-rules-backup-2026-07-08.txt`.
   Save it.

If anything in Step 4 goes wrong, pasting this text back and clicking
**Publish** restores tonight's starting state exactly.

## Step 2 — Create the poller user

1. Same console → **Build → Authentication** → **Users** tab → **Add user**.
2. **Email:** any address you control — it never receives mail.
   `dylanf183+poller@gmail.com` works nicely (Gmail plus-addressing: it's
   still your inbox, but clearly labeled).
3. **Password:** generate 24+ random characters in your password manager and
   save the entry there (name it e.g. "WC poller — Firebase"). It must never
   appear in the repo, in chat, or in any file Claude can read.
4. Click **Add user**.

## Step 3 — Copy both UIDs

Still on the **Users** table, each row has a **User UID** column (hover for a
copy icon).

- Copy the **admin** account's UID — the account you sign into the app with.
- Copy the new **poller** user's UID.

Paste both somewhere temporary (a scratch text editor is fine — UIDs are
identifiers, not secrets). Label which is which; they look identical in shape.

## Step 4 — Apply the new rules

1. Back to **Realtime Database → Rules**.
2. Replace the entire rules text with the block below, then substitute the
   placeholders: `<ADMIN_UID>` appears in **7** places, `<POLLER_UID>` in
   **4**. Paste the block into a text editor first and use find-and-replace,
   then paste the result into the console. Double-check no `<` brackets
   remain before publishing.

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

What this grants: the poller can write **only** individual match entries,
`state/meta/lastUpdated`, `/box` (future scorers), and `/automation`
(heartbeat/log) — **except** `/automation/enabled`, the kill switch, which
stays admin-only. Even a leaked poller password cannot switch automation on.

3. Click **Publish**.
4. **Sanity-check immediately:**
   - Open the live app in a normal tab — it should load and show data
     (public read still works).
   - Sign in to #admin and change something trivial — edit a venue name and
     save, then change it back. If the save succeeds, admin write works.
   - If the app won't load or the save fails: **Rules tab → paste the Step 1
     backup → Publish**, and stop here — bring the error text to the Phase C
     session.

## Step 5 — Add the two GitHub secrets

In a terminal, **from the repo directory**:

```
cd ~/Projects/ai-workspaces/claude/draft-order-world-cup
gh secret set POLLER_EMAIL
gh secret set POLLER_PASSWORD
```

Each command opens a hidden prompt (like the API key did) — paste the value,
press Enter. Nothing echoes to the screen or shell history.

Verify all three exist:

```
gh secret list
```

Expect `FOOTBALL_DATA_KEY`, `POLLER_EMAIL`, `POLLER_PASSWORD`.

## Step 6 — Create the kill switch

1. **Realtime Database → Data** tab.
2. Hover the root of the tree → **+** → name: `automation` → don't set a
   value on it directly; instead click **+** on the new `automation` node →
   child name: `enabled`, value: `false`.
3. **Type gotcha — this is the one detail that can silently break the test:**
   the poller checks `enabled !== true` **strictly** — the string `"true"`
   fails the check. In the Data tab a boolean shows as bare `false`; a string
   shows quoted as `"false"`. If you see quotes, delete the child and re-add
   it, choosing the boolean type.

## Step 7 — The auth test (two dispatches)

### 7a. Prove the kill switch stops a live run (optional but free)

With `enabled` still `false`:

```
gh workflow run poller.yml -f dry_run=false
```

Wait ~30s, then `gh run list --workflow=poller.yml --limit 1` and
`gh run view <id> --log` (run from the repo directory — outside it, `gh`
can't find the repo and prints nothing useful). Expect:

```
poller start — LIVE (writes enabled)
kill switch: /automation/enabled !== true — exiting without writes
```

That's the emergency brake proven before it's ever needed. (Note this exits
*before* sign-in, so it says nothing about the secrets yet — that's 7b.)

### 7b. The real auth test

1. Data tab → set `automation/enabled` to `true` (click the value, edit).
2. Dispatch again:

```
gh workflow run poller.yml -f dry_run=false
```

3. In the run log, expect — with **no `[DRY]` prefixes** this time:
   - `poller start — LIVE (writes enabled)`
   - `MAP: 92: no API fixture(s) …` — **expected and harmless.** Match 92
     (MEX–ENG) was delayed ~1h on Jul 5 and its DB kickoff was never
     corrected, so the kickoff-join can't map it. It's long final, so
     nothing depends on it; the persisted map just won't have a "92" entry.
   - `PATCH /automation/fixtureMap {…15 entries…}` — the first REAL write:
     the API-fixture map, persisted at last.
   - `PUT /automation/lastRun {"at":…,"dryRun":false,"writes":0,…}`
   - `cycle done — 0 write(s), 0 problem(s), active=false`
   - `nothing live or imminent — single pass complete`
   - **Zero `/state/...` writes** — every match is already final/scheduled.
4. Confirm in the **Data** tab: `/automation` now contains `fixtureMap` and
   `lastRun` alongside `enabled`. That proves sign-in, the token exchange,
   and the scoped rules end-to-end.
5. **Leave `enabled` = `true`.** Scheduled runs remain dry-run until the
   Phase C code change, so nothing writes overnight either way, and leaving
   it on means tomorrow only needs the one-line workflow flip.

## If something fails in 7b

| Symptom in the log | Cause | Fix |
|---|---|---|
| `firebase sign-in` error mentioning `EMAIL_NOT_FOUND`, `INVALID_PASSWORD`, or `INVALID_LOGIN_CREDENTIALS` | A secret was mistyped/pasted with whitespace | Re-run `gh secret set POLLER_EMAIL` / `POLLER_PASSWORD`, dispatch again |
| `DB PATCH … HTTP 401` or `Permission denied` | A UID in the rules is wrong (swapped, truncated, or brackets left in) | Rules tab → fix the UID → Publish → dispatch again |
| `kill switch … exiting without writes` even though you set it | `enabled` is the **string** `"true"`, not boolean | Step 6's type gotcha — recreate as boolean |
| `POLLER_EMAIL / POLLER_PASSWORD not set` | Secrets missing or workflow didn't pass them | `gh secret list`; if present, bring to Phase C session |
| Job fails after 3 `cycle FAILED` lines | API or network trouble | Nothing is harmed; wait and re-dispatch, or bring the log tomorrow |

Every failure above is loud and writes nothing to `/state` — worst case you
stop and we finish together in the Phase C session.

## Full undo (if you want tonight completely reverted)

1. Rules tab → paste the Step 1 backup → Publish.
2. Authentication → Users → ⋮ on the poller user → Disable (or Delete).
3. `gh secret delete POLLER_EMAIL && gh secret delete POLLER_PASSWORD`
4. Optionally delete `/automation` in the Data tab.

## Done checklist

- [ ] Rules backup saved outside the repo
- [ ] Poller user created; password only in the password manager
- [ ] New rules published; app loads AND admin save still works
- [ ] `gh secret list` shows all three secrets
- [ ] `automation/enabled` exists and is a **boolean**
- [ ] 7a: kill-switch exit seen in a live-mode log (optional)
- [ ] 7b: real `fixtureMap` + `lastRun` writes in the log and visible in the
      Data tab; zero `/state` writes; `enabled` left `true`

**Then Phase B is done.** Tomorrow (Jul 9, before ~3:45pm ET) we flip the
`DRY_RUN` expression in `.github/workflows/poller.yml` together and watch the
QF-97 cron (FRA–MAR, fires 19:55 UTC) write its first real score. Known items
queued for that session: reschedule-tolerant fixture join, the
pre-automation `/state` snapshot (designed in AUTOMATION.md §2 but not yet in
poller.mjs — should be added before the first real match write), and the
still-unverified pens API shape (ARG–SUI is a plausible shootout).
