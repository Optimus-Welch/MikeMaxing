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
// pick up. Kept for the record and for fresh-install bookkeeping, but it is NO
// LONGER what decides whether a device re-seeds — see libraryFingerprint().
export const EXERCISE_LIBRARY_VERSION = 2;

/**
 * A content fingerprint of the shipped exercise library.
 *
 * This replaces "remember to bump the version" as the thing that decides
 * whether a device's stored library is out of date, because remembering is
 * exactly what failed: `unilateral: true` was added to 21 exercises and the
 * version was left at 1, so every existing install kept its pre-tag library
 * out of localStorage and showed "3 × 10" where the source said
 * "3 × 10 per side". Every check passed throughout, because they all import
 * seedExerciseLibrary directly and never go through storage.
 *
 * Derived from the data itself, so it cannot be forgotten: change the library
 * in any way and the fingerprint changes with it.
 *
 * FNV-1a over the serialised library. Not cryptographic — it only has to
 * change when the content changes, and collisions between two versions of a
 * hand-edited data file are not a realistic concern.
 */
export function libraryFingerprint(library) {
  const json = JSON.stringify(library);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${library.length}-${hash.toString(36)}`;
}

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
  // Returning from a break: after a 10+ day gap in training (see
  // RAMP_BACK.minGapDays in rampBack.js), this many lift sessions run easier —
  // reduced weights and sets — before normal programming resumes.
  rampBackSessions: 2,
  // The break the user chose to skip ramping back from, keyed by the date of
  // the last session before that break. null = no skip recorded. A later,
  // different break is offered again regardless of this value.
  rampBackSkipped: null,
  // Audible chime when a rest timer ends. Default on.
  soundEnabled: true,
};
