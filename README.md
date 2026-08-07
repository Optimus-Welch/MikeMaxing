# MikeMaxing

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

`npm run check` runs the linter plus six data/logic checks:

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
- `npm run check:migration` runs `db.js` against a fake localStorage holding
  pre-Garmin data and asserts the upgrade preserves everything (see Migration
  below).
- `npm run check:qol` asserts the swap-alternatives filters, the demo link-out
  (always an external search, never embedded media) and the chime's mute and
  priming gates.
- `npm run check:weekly` re-runs the weekly-count assertions under seven
  timezones from UTC-11 to UTC+14. Dates are stored as `YYYY-MM-DD` and mean a
  calendar day on the user's own clock, so they must be parsed with
  `parseLocalDate()` — `new Date('2026-08-03')` is UTC midnight and silently
  drops a Monday session west of UTC.

## Structure

```
src/
  lib/
    storage.js     # localStorage read/write, namespaced — the only file
                    # that touches localStorage directly
    seed.js         # first-run data: profile, equipment, settings
    db.js           # one function per collection (getProfile, addSession,
                    # etc.) — pages call these, never storage.js directly
    readiness.js     # pure functions: band, duration target, and the
                    # Lift/Cardio/Rest + location recommendation
    weekly.js       # Monday-start weekly session counts
    exercises.js    # the shipped exercise library + equipment/cap metadata
    liftGenerator.js # pure session generation: templates, selection, schemes
    blocks.js       # groups a session into named blocks; flattens to run steps
    warmups.js      # warm-up / cool-down drills, keyed by movement pattern
    sessionStats.js # finish-screen maths: volume, muscles, records
    muscleMap.js    # muscle name -> diagram region mapping
    demos.js        # where to send someone to see how a lift is performed
    chime.js        # WebAudio timer chime + iOS autoplay unlocking
  pages/
    Today.jsx       # readiness, recommendation, block overview, START WORKOUT
    Run.jsx         # guided one-thing-at-a-time run mode
    Finish.jsx      # post-session payoff screen
    Settings.jsx    # band thresholds, weekly + duration targets, variety
  components/
    NavBar.jsx      # bottom tab bar (Today / Settings)
    HistoryList.jsx # recent sessions list
    BlockList.jsx   # session overview: blocks, rounds, explicit rest
    MuscleMap.jsx   # front/back body diagram drawn as SVG
    ExercisePicker.jsx # swap sheet: alternatives for the same muscles
    SessionOverlay.jsx # full workout seen from inside run mode
    DemoLink.jsx    # "how to" button
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

### Swapping an exercise

`alternativesFor()` lists every exercise that shares a **primary muscle** with
the one you are replacing, is possible with the equipment at your current
location, and — at a capped location — obeys the same `capFriendly` rule
generation uses, so the list can never offer something the generator would
refuse to pick. Same-pattern options sort first.

The picker is a sheet, not a route. Opening it from run mode leaves the run
screen mounted underneath, so closing it returns you to the same set with any
rest timer still counting. Picking runs `swapExerciseTo()`, which prescribes
the replacement through the same code path generation uses — a swapped-in lift
is indistinguishable from one the generator chose.

### Exercise demonstrations

`demoFor(exercise)` returns where to send someone who wants to see the lift.
Today that is always a YouTube **search** opened in a new tab: nothing is
embedded, copied, hotlinked or proxied from any fitness app or other
copyrighted source.

The indirection is the point. Give an exercise a `demoUrl`, or add an entry to
`DEMO_CLIPS`, and it starts returning `kind: 'clip'` instead — `DemoLink.jsx`
is then the only file that needs an inline player. No caller changes.

### Timer chimes

A two-note chime plays when a rest timer runs out, synthesised with an
oscillator rather than loaded from a file — nothing to fetch, and it works
offline in the installed PWA without extra precache entries.

iOS Safari (including a home-screen PWA) will not produce sound unless an
AudioContext was unlocked inside a real user gesture, and a chime fired from a
timer minutes later is not a gesture. `initAudio()` is therefore called on the
**START WORKOUT** tap — the one guaranteed tap before any rest can end. It
resumes the context and runs a silent blip through it, which is what actually
satisfies the unlock. Backgrounding suspends the context again, so `playChime()`
resumes it before playing; that is allowed once unlocked. Mute lives in
Settings.

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
- `readinessLog` — one entry per day (`score`, `band`, `source`); pre-Garmin
  entries also retain their original `sleepScore` / `load` / `energy`
- `settings` — `bands` (score thresholds), `durationTargets`, `freshnessWindow`,
  `soundEnabled`
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

Readiness is **Garmin's Training Readiness score**, entered by hand — one
field, 0-100. Garmin already folds in sleep, recovery time, HRV, acute load,
recent sleep and recent rest, so the app takes the number as given rather than
computing its own from separate inputs.

1. `scoreToBand()` maps the score to Green (≥80) / Yellow (≥55) /
   Orange (≥35) / Red, using the thresholds in `settings.bands`.
2. `recommendSession()` picks a session **type** (Lift, Cardio, or
   Rest/Recovery) using the band plus how many lifts/cardio sessions are
   already logged this week against `profile.goals`, and a **location**
   (Work on weekdays, Home on weekends, overridable).
3. `durationTargetFor()` reads `settings.durationTargets[band]` for how much
   session the score bought.

The one score drives two independent axes:

| | set by | what it controls |
|---|---|---|
| **Intensity** | the band, via `BAND_PRESCRIPTION` | reps, RPE, sets per exercise |
| **Duration** | `settings.durationTargets[band]` | exercises in a lift, minutes of cardio |

Defaults run Green 6 exercises / 45 min cardio down to Red 3 / 15, and every
number is editable in Settings. Lift exercises are capped at
`MAX_LIFT_EXERCISES` (the number of slots a template has) so the setting can
never promise more than the generator can deliver. When a target is smaller
than the template, slots are dropped **from the back** — a short session loses
its carry and core finisher, never its main lift.

### Migration from the old readiness system

The multi-input scoring (sleep + training load + energy, weighted and
renormalized) is gone, not deprecated — `computeReadiness()` and
`settings.readinessWeights` are deleted rather than left unused.

Existing installs upgrade in place, guarded by `meta.settingsVersion`:

- **Settings** drop `readinessWeights` and gain `durationTargets`. Anything you
  had tuned — band thresholds, freshness window, weekly goals — is preserved.
- **Readiness log** entries keep their `score` and `band` and gain
  `source: 'legacy'`, so an old computed score is never mistaken for a Garmin
  reading. Their original `sleepScore` / `load` / `energy` are kept as a record
  of what actually happened that day. An entry missing a `band` has one
  recovered from its score using your thresholds.
- **Session history** is untouched, so old sessions still feed freshness
  rotation and weight pre-fill.

Both migrations are idempotent. `npm run check:migration` asserts all of the
above against a simulated pre-Garmin install.

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
