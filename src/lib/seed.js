// Initial data for a fresh install. Only used the first time a collection
// is read and nothing exists in localStorage yet — see ensureSeeded() in db.js.

export const seedProfile = {
  units: 'lb',
  // Weekly targets. This is the single source of truth for "how many lifts
  // and cardio sessions per week" — the Settings screen edits this object
  // directly rather than keeping a second copy elsewhere.
  goals: {
    liftsPerWeek: 2,
    cardioPerWeek: 2,
  },
};

export const seedEquipment = {
  Work: {
    strength: [
      { name: 'Barbell + squat rack', note: 'No weight limit' },
      { name: 'Machines' },
      { name: 'Dumbbells', note: 'Full range' },
    ],
    cardio: [
      { name: 'Bike' },
      { name: 'Stair machine' },
      { name: 'Treadmill' },
      { name: 'Rower' },
    ],
  },
  Home: {
    strength: [
      { name: 'Adjustable dumbbells', note: 'Up to 52.5 lb/hand' },
      { name: 'Adjustable barbell + curl bar', note: 'Up to 80 lb total' },
      { name: 'Adjustable bench' },
    ],
    cardio: [
      { name: 'Indoor bike', note: 'Kickr' },
      { name: 'Treadmill' },
    ],
  },
};

// Bump whenever seedExerciseLibrary changes in a way existing installs should
// pick up. db.js compares this against the version last written to storage and
// re-seeds the library when it is behind — without this, anyone who already ran
// Phase 0 would be stuck with the empty library that shipped then.
export const EXERCISE_LIBRARY_VERSION = 1;

// Bump when seedSettings changes shape in a way existing installs must adopt.
// v2 dropped `readinessWeights` (the old multi-input scoring is gone) and
// added `durationTargets`. See migrateSettings() in db.js.
export const SETTINGS_VERSION = 2;

// Readiness config, edited on the Settings screen. Weekly targets live on
// `profile.goals` instead of here (see comment above) so there is only one
// place that number is stored.
export const seedSettings = {
  // Lower bound (inclusive) for each band, applied to the Garmin Training
  // Readiness score. Anything below `orange` is Red.
  bands: {
    green: 80,
    yellow: 55,
    orange: 35,
  },
  // Session SIZE per band — the duration axis. Intensity (reps/RPE/sets per
  // exercise) is separate and lives in liftGenerator's BAND_PRESCRIPTION;
  // this decides how much work the session contains.
  //
  //   liftExercises  how many exercises a generated lift includes
  //   cardioMinutes  target minutes for a cardio session
  //
  // Red still carries a cardio target because Red recommends recovery, and an
  // easy 15 minutes is a legitimate way to spend a recovery day.
  durationTargets: {
    Green: { liftExercises: 6, cardioMinutes: 45 },
    Yellow: { liftExercises: 5, cardioMinutes: 30 },
    Orange: { liftExercises: 4, cardioMinutes: 20 },
    Red: { liftExercises: 3, cardioMinutes: 15 },
  },
  // How many recent lift sessions the generator looks back over before it is
  // willing to reuse a variationGroup. 0 disables freshness filtering.
  freshnessWindow: 3,
  // Audible chime when a rest timer ends. Default on.
  soundEnabled: true,
};
