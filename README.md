# Autopilot

A personal workout web app. No backend, no login — everything lives in
`localStorage` on your device. Built with Vite + React, installable as a
PWA for iPad/iPhone Safari.

## Running locally

```bash
npm install
npm run dev
```

Then open the printed `localhost` URL. `npm run build` produces a static
`dist/` folder (deployable anywhere that serves static files); `npm run
preview` serves that build locally to test the PWA install flow.

`npm run check` runs the linter plus three data/logic checks:

- `npm run check:library` validates the exercise library (no exercise is
  tagged for a location that lacks its equipment) and prints per-location
  coverage so gaps are visible.
- `npm run check:generator` generates sessions across every band, location
  and seed and asserts the invariants — no duplicate movement families in a
  session, cap-friendly picks at Home, A/B alternation, and that swap and
  regenerate actually change something.
- `npm run check:blocks` builds blocks and run steps for every band, asserting
  the structure (warm up first, explicit rest, nothing dropped) and the
  finish-screen maths (volume, records, first-time-is-not-a-record).

## Structure

```
src/
  lib/
    storage.js     # localStorage read/write, namespaced — the only file
                    # that touches localStorage directly
    seed.js         # first-run data: profile, equipment, settings
    db.js           # one function per collection (getProfile, addSession,
                    # etc.) — pages call these, never storage.js directly
    readiness.js     # pure functions: readiness score, band, and the
                    # Lift/Cardio/Rest + location recommendation
    weekly.js       # Monday-start weekly session counts
    exercises.js    # the shipped exercise library + equipment/cap metadata
    liftGenerator.js # pure session generation: templates, selection, schemes
    blocks.js       # groups a session into named blocks; flattens to run steps
    warmups.js      # warm-up / cool-down drills, keyed by movement pattern
    sessionStats.js # finish-screen maths: volume, muscles, records
    muscleMap.js    # muscle name -> diagram region mapping
  pages/
    Today.jsx       # readiness, recommendation, block overview, START WORKOUT
    Run.jsx         # guided one-thing-at-a-time run mode
    Finish.jsx      # post-session payoff screen
    Settings.jsx    # readiness weights, band thresholds, targets, variety
  components/
    NavBar.jsx      # bottom tab bar (Today / Settings)
    HistoryList.jsx # recent sessions list
    BlockList.jsx   # session overview: blocks, rounds, explicit rest
    MuscleMap.jsx   # front/back body diagram drawn as SVG
scripts/           # dev-only data and logic checks (see npm run check)
```

## The guided session

The engine decides *what* to train; this layer walks you through it.

**Blocks.** `buildBlocks()` groups the generated exercises into named blocks
with a round count — `WARM UP`, `[4x] PRIMARY STRENGTH — MAIN LIFT`,
`[3x] ACCESSORY WORK — BLOCK A`, `COOL DOWN`. Rest is an explicit item with a
duration (longer after heavy primary work, shorter on Orange days), not
something implied between lines. Warm-up and cool-down drills are drawn from
the movement patterns the session actually trains.

**Run mode.** `buildRunSteps()` flattens blocks x rounds into a linear
sequence, and `/run` walks it one screen at a time: current exercise, current
set, editable reps and weight, a `PREVIOUS` line showing what you did last
time, and swap/skip without leaving the flow. Marking a set done starts the
rest countdown automatically.

Run state is persisted to the `activeSession` collection on every step, so
locking your phone mid-workout resumes exactly where you left off. The rest
timer stores an absolute end time rather than counting down in memory —
a backgrounded tab stops firing intervals, but wall-clock time does not.

**Finish.** Total volume, sets, exercises, an SVG muscle map shaded by how
much each region was worked, and any weight or rep records beaten. A first-ever
performance is deliberately *not* a record.

### Data model

Six collections, each just a JSON value under its own `localStorage` key
(see `src/lib/storage.js`):

- `profile` — units, and weekly goals (`liftsPerWeek`, `cardioPerWeek`)
- `equipment` — per-location equipment lists (seeded with `Work` and `Home`)
- `exerciseLibrary` — the shipped strength library, tagged with movement
  pattern, muscles, equipment, locations, variation group and load notes
- `sessionHistory` — completed sessions (`type`, `location`, `date`); lift
  sessions also carry `templateId` and an `exercises` array with the sets
  actually performed
- `readinessLog` — one entry per day (`sleepScore`, `load`, `energy`, `score`, `band`)
- `settings` — `readinessWeights`, `bands` (score thresholds), `freshnessWindow`
- `meta` — non-user bookkeeping; currently which library version this browser
  has been migrated to

The exercise library is reference data shipped with the app rather than
something you author, so `db.js` replaces it wholesale when
`EXERCISE_LIBRARY_VERSION` in `seed.js` is bumped. Plain seeding is not
enough: a collection that already exists is never re-seeded, so anyone who
ran an earlier version would otherwise be stuck with the old library.

`db.js` is the seam for a future backend: every page goes through its
functions (`getProfile`, `addSession`, ...) instead of localStorage
directly, so swapping in a real API later means rewriting `storage.js` and
`db.js` and nothing else.

### Readiness → recommendation

1. `computeReadiness()` turns whichever inputs you entered (sleep score,
   training load, optional energy) into a 0-100 score, weighted by
   `settings.readinessWeights`. Missing inputs are dropped and the
   remaining weights are rebalanced, so you can skip the energy rating.
2. `scoreToBand()` maps that score to Green (≥80) / Yellow (≥55) /
   Orange (≥35) / Red, using the thresholds in `settings.bands`.
3. `recommendSession()` picks a session **type** (Lift, Cardio, or
   Rest/Recovery) using the band plus how many lifts/cardio sessions are
   already logged this week against `profile.goals`, and a **location**
   (Work on weekdays, Home on weekends, overridable). It returns a
   one-line rationale.

### Lift generation

When the recommendation is a Lift, `generateLiftSession()` builds the
workout. It is a pure function of its inputs plus a seed, so the same seed
always yields the same session and "Regenerate" is simply a new seed.

1. **Template.** Two full-body templates alternate off the last logged lift
   session: **A — Squat / Horizontal** and **B — Hinge / Vertical**. One
   A→B cycle covers all nine movement patterns while consecutive sessions
   emphasise different ones.
2. **Selection.** For each slot, candidates are filtered to what is possible
   at the chosen location, then narrowed by a chain of *soft* preferences —
   availability always wins, so a preference that would empty the pool is
   skipped:
   - **tier** — a primary slot wants a real compound, never an isolation lift
   - **cap-awareness** — at Home, squat/hinge/unilateral patterns prefer
     exercises flagged `capFriendly`
   - **freshness** — nothing whose `variationGroup` appeared in the last
     `settings.freshnessWindow` lift sessions
3. **Prescription.** The readiness band sets volume and intensity (Green =
   low reps / high intensity, Yellow = standard, Orange = reduced volume,
   Red = recovery instead of a lift), and a set/rep scheme is drawn from
   straight sets, tempo, supersets, drop sets and EMOM.

**Cap-awareness lives in the data, not the UI.** Each exercise carries
`capFriendly` and a `capStrategy` (`unilateral` / `tempo` / `highRep` /
`elevatedRange`) explaining *why* it stays hard under Home's 52.5 lb-per-hand
and 80 lb-barbell ceilings. Adding a new cap-beating variation is a data
edit, not a code change.

**Logging.** Each exercise expands into set rows capturing reps, weight and
optional RPE, with weight pre-filled from the last time you did that
exercise. Only rows you actually touch are saved — a pre-filled row is a
suggestion, not a record that the set happened.

## PWA install

The manifest and icons (`public/icons/`) are wired up via
`vite-plugin-pwa`. On iPad/iPhone Safari: Share → Add to Home Screen.
Routing uses `HashRouter` so a reloaded/deep-linked install still resolves
correctly without server-side rewrites.
