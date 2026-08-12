// Data-access layer: one function per collection operation. Pages/components
// call these instead of storage.js directly, so the storage format and the
// seeding logic stay in one place.

import { readCollection, writeCollection, writeSeed } from './storage.js';
import {
  seedProfile,
  seedEquipment,
  seedSettings,
  EXERCISE_LIBRARY_VERSION,
  SETTINGS_VERSION,
} from './seed.js';
import { seedExerciseLibrary } from './exercises.js';

const DEFAULTS = {
  profile: seedProfile,
  equipment: seedEquipment,
  exerciseLibrary: seedExerciseLibrary,
  sessionHistory: [],
  readinessLog: [],
  settings: seedSettings,
  // Bookkeeping that is not user data: which shipped-data versions this
  // browser has already been migrated to.
  meta: { exerciseLibraryVersion: 0, settingsVersion: 0 },
  // An in-progress guided workout, or null. Persisted so closing the app
  // mid-session (or the phone locking and the tab being evicted) does not
  // lose the sets already ticked off.
  activeSession: null,
};

// Write the seed value for any collection that has never been touched, so
// every collection always exists once the app has loaded once.
//
// Seeds go in via writeSeed, which stamps them as older than anything real —
// see the comment there. This runs on import, so on a device you are about to
// sign in on it runs seconds before the first sync; stamped "now", these
// factory defaults would outrank and overwrite the settings on your phone.
function ensureSeeded() {
  // A never-opened install has no settings. Anything else is an existing
  // install, which may still owe the version migrations below — so only a
  // genuinely fresh one may claim it is already migrated.
  const freshInstall = readCollection('settings', undefined) === undefined;

  for (const [collection, seedValue] of Object.entries(DEFAULTS)) {
    if (readCollection(collection, undefined) !== undefined) continue;

    // A fresh install is born on the current shapes, so record that rather
    // than pretending it is at version 0 and running migrations over data
    // that was written by this very build. Those migrations rewrite settings,
    // which on a fresh device means re-stamping factory defaults as brand new
    // — exactly what writeSeed exists to avoid.
    const value =
      collection === 'meta' && freshInstall
        ? { exerciseLibraryVersion: EXERCISE_LIBRARY_VERSION, settingsVersion: SETTINGS_VERSION }
        : seedValue;

    writeSeed(collection, value);
  }
}

// The exercise library is reference data shipped with the app, not something
// the user authors — so it is safe to replace wholesale when we ship a newer
// one. `ensureSeeded` alone is not enough: Phase 0 wrote an empty array, and a
// collection that already exists is never re-seeded.
function ensureLibraryCurrent() {
  const meta = readCollection('meta', DEFAULTS.meta);
  if ((meta.exerciseLibraryVersion ?? 0) >= EXERCISE_LIBRARY_VERSION) return;

  writeCollection('exerciseLibrary', seedExerciseLibrary);
  writeCollection('meta', { ...meta, exerciseLibraryVersion: EXERCISE_LIBRARY_VERSION });
}

// Move a pre-Garmin install onto the new settings shape:
//   - drop `readinessWeights` — the multi-input scoring it configured is gone,
//     and a stale key would just be confusing dead data
//   - add `durationTargets` if absent
// Everything the user actually tuned (band thresholds, freshness window) is
// preserved. Runs once, guarded by meta.settingsVersion.
function migrateSettings() {
  const meta = readCollection('meta', DEFAULTS.meta);
  if ((meta.settingsVersion ?? 0) >= SETTINGS_VERSION) return;

  const stored = readCollection('settings', seedSettings) ?? {};
  const { readinessWeights: _removed, ...keep } = stored;

  writeCollection('settings', {
    ...seedSettings,
    ...keep,
    bands: { ...seedSettings.bands, ...(keep.bands ?? {}) },
    durationTargets: { ...seedSettings.durationTargets, ...(keep.durationTargets ?? {}) },
  });
  writeCollection('meta', { ...meta, settingsVersion: SETTINGS_VERSION });
}

// Bring old readiness entries onto the new shape without discarding anything.
//
// Pre-Garmin entries were computed from sleep/load/energy. Those raw inputs are
// kept as a historical record — they are what actually happened on that day —
// but every entry is guaranteed a `score` and a `band` so the rest of the app
// can read old and new days identically. `source` records where the number came
// from, so a legacy computed score is never mistaken for a Garmin reading.
function migrateReadinessLog() {
  const log = readCollection('readinessLog', []);
  if (!Array.isArray(log) || log.length === 0) return;
  if (log.every((e) => e.source)) return; // already migrated

  const bands = { ...seedSettings.bands, ...(readCollection('settings', seedSettings)?.bands ?? {}) };
  const bandFor = (score) => {
    if (score >= bands.green) return 'Green';
    if (score >= bands.yellow) return 'Yellow';
    if (score >= bands.orange) return 'Orange';
    return 'Red';
  };

  writeCollection(
    'readinessLog',
    log.map((entry) => {
      if (entry.source) return entry;
      return {
        ...entry,
        source: 'legacy',
        // A legacy entry should always have a score, but recover the band from
        // it if that is the field that went missing.
        band: entry.band ?? (entry.score != null ? bandFor(entry.score) : null),
      };
    }),
  );
}

ensureSeeded();
ensureLibraryCurrent();
migrateSettings();
migrateReadinessLog();

// Merge stored values over the seed defaults so keys added in a later release
// (e.g. settings.freshnessWindow) appear for people who already have a stored
// object from an earlier version. One level deep is enough for our shapes.
function withDefaults(stored, defaults) {
  const merged = { ...defaults, ...stored };
  for (const [key, value] of Object.entries(defaults)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = { ...value, ...(stored?.[key] ?? {}) };
    }
  }
  return merged;
}

// -- profile -----------------------------------------------------------

export function getProfile() {
  return withDefaults(readCollection('profile', seedProfile), seedProfile);
}

export function updateProfile(patch) {
  return writeCollection('profile', { ...getProfile(), ...patch });
}

// -- equipment -----------------------------------------------------------

export function getEquipment() {
  return readCollection('equipment', seedEquipment);
}

// -- exerciseLibrary -------------------------------------------------------

export function getExerciseLibrary() {
  const stored = readCollection('exerciseLibrary', seedExerciseLibrary);
  // Defensive: if storage somehow holds an empty library, fall back to the
  // shipped one rather than handing the generator nothing to work with.
  return Array.isArray(stored) && stored.length ? stored : seedExerciseLibrary;
}

export function getExerciseById(id) {
  return getExerciseLibrary().find((e) => e.id === id) ?? null;
}

// -- settings --------------------------------------------------------------

export function getSettings() {
  return withDefaults(readCollection('settings', seedSettings), seedSettings);
}

export function updateSettings(patch) {
  return writeCollection('settings', { ...getSettings(), ...patch });
}

// -- sessionHistory ----------------------------------------------------

export function getSessionHistory() {
  return readCollection('sessionHistory', []);
}

// Newest first.
export function addSession(session) {
  return writeCollection('sessionHistory', [session, ...getSessionHistory()]);
}

/**
 * Most recent logged performance of a given exercise, for pre-filling weights.
 * Returns the heaviest set from that session (the one worth matching), or null
 * if this exercise has never been logged with a weight.
 */
export function getLastPerformance(exerciseId) {
  for (const session of getSessionHistory()) {
    if (!Array.isArray(session.exercises)) continue;
    const entry = session.exercises.find((e) => e.exerciseId === exerciseId);
    if (!entry || !Array.isArray(entry.sets)) continue;

    const withWeight = entry.sets.filter((s) => s.weight != null && s.weight !== '');
    if (!withWeight.length) continue;

    const best = withWeight.reduce((a, b) => (Number(b.weight) > Number(a.weight) ? b : a));
    return { date: session.date, weight: best.weight, reps: best.reps, rpe: best.rpe };
  }
  return null;
}

// -- activeSession -------------------------------------------------------
// The guided workout currently being performed. Written on every step so a
// reload mid-session resumes exactly where it left off.

export function getActiveSession() {
  return readCollection('activeSession', null);
}

export function setActiveSession(session) {
  return writeCollection('activeSession', session);
}

export function clearActiveSession() {
  return writeCollection('activeSession', null);
}

// -- readinessLog --------------------------------------------------------

export function getReadinessLog() {
  return readCollection('readinessLog', []);
}

// One entry per calendar date — logging again today replaces today's entry.
export function upsertReadinessEntry(entry) {
  const rest = getReadinessLog().filter((e) => e.date !== entry.date);
  return writeCollection('readinessLog', [entry, ...rest]);
}

export function getReadinessEntryForDate(date) {
  return getReadinessLog().find((e) => e.date === date) ?? null;
}
