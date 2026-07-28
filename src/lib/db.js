// Data-access layer: one function per collection operation. Pages/components
// call these instead of storage.js directly, so the storage format and the
// seeding logic stay in one place.

import { readCollection, writeCollection } from './storage';
import {
  seedProfile,
  seedEquipment,
  seedSettings,
  EXERCISE_LIBRARY_VERSION,
} from './seed';
import { seedExerciseLibrary } from './exercises';

const DEFAULTS = {
  profile: seedProfile,
  equipment: seedEquipment,
  exerciseLibrary: seedExerciseLibrary,
  sessionHistory: [],
  readinessLog: [],
  settings: seedSettings,
  // Bookkeeping that is not user data: which shipped-data versions this
  // browser has already been migrated to.
  meta: { exerciseLibraryVersion: 0 },
};

// Write the seed value for any collection that has never been touched, so
// every collection always exists once the app has loaded once.
function ensureSeeded() {
  for (const [collection, seedValue] of Object.entries(DEFAULTS)) {
    const missing = readCollection(collection, undefined) === undefined;
    if (missing) writeCollection(collection, seedValue);
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

ensureSeeded();
ensureLibraryCurrent();

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
