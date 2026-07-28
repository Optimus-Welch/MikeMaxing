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
  pages/
    Today.jsx       # readiness entry, recommendation, log action, recent history
    Settings.jsx    # edit readiness weights, band thresholds, weekly targets
  components/
    NavBar.jsx      # bottom tab bar (Today / Settings)
    HistoryList.jsx # recent sessions list
```

### Data model

Six collections, each just a JSON value under its own `localStorage` key
(see `src/lib/storage.js`):

- `profile` — units, and weekly goals (`liftsPerWeek`, `cardioPerWeek`)
- `equipment` — per-location equipment lists (seeded with `Work` and `Home`)
- `exerciseLibrary` — empty for now; a future slice will populate this and
  use it to recommend specific exercises
- `sessionHistory` — completed sessions (`type`, `location`, `date`)
- `readinessLog` — one entry per day (`sleepScore`, `load`, `energy`, `score`, `band`)
- `settings` — `readinessWeights` and `bands` (score thresholds)

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
   one-line rationale but does not pick specific exercises — that's a
   later slice, once `exerciseLibrary` is populated.

## PWA install

The manifest and icons (`public/icons/`) are wired up via
`vite-plugin-pwa`. On iPad/iPhone Safari: Share → Add to Home Screen.
Routing uses `HashRouter` so a reloaded/deep-linked install still resolves
correctly without server-side rewrites.
