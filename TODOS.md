# TODOS — draft-order-world-cup inbox

what: repo-native idea/task inbox (capture-ritual target); sessions sweep + prune, replace-semantics
updated: 2026-07-18 (meta desk: §finale born — Dylan's order-page ask, routed same day)

## §finale — order-page state styling + final celebration (Dylan, Jul-18; verbatim = meta intake/dylan-wc-finale-jul18.md)

**SHIPPED locally 2026-07-18, commit `d7854b5`** (Fable-in-repo §WC-FINALE session). Demo
for Dylan pending; deploy = his word once the hold lifts. 122 checks green.

- [x] **Order-page locked-vs-alive styling** — the whole LOCKED plate now darkens (aged
      paper, flattened shadow, deeper number block; day + night). Data-driven off the
      engine's `locked` flag exactly as asked: the 3rd-place score flips 3-4 dark on its
      own, the Final's score flips 1-2. Newly locked plates "ink-dry" bright→dark once.
- [x] **Final = celebratory** — when all 12 picks lock: finale plaque (foil trophy, "Final
      order." in Anton, champions line, first/last pick, date) + 140-piece foil confetti
      shower. Auto-fires once per device; the plaque's trophy replays it.

Taste forks banked Jul-18 (each is a one-line change if Dylan re-cuts it):
- **Pick 1 stays foil-bright when locked** (chosen: winner's plate shines alone over the
  settled board; alt = darken it too → drop `:not(.top1)` on `.pick.locked` in styles.css).
- **Confetti once per DEVICE, trophy = encore** (alt = every visit → drop the finaleSeen
  gate in app.js renderOrder).
- **Phase pill says "Order set" when complete** (was "Final"; alt → PHASE.final in app.js).
- **Night locked-contrast** = darker ground + harder rung dim; if it reads weak on his
  phone, next lever is dimming locked plate text (night-only rule in styles.css).

Standing fences: **ABSOLUTE no-push hold to ~Jul-19; push=deploy to the live league page —
ask Dylan EVERY time, even after the hold lifts** (rule 6). Repo sits ~14 commits ahead of
origin on purpose. Keep the full test suite + tournament-validate green (122 checks at last
booking); no deletions, no installs.
