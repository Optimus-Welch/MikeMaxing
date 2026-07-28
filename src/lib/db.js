// Data-access layer: one function per collection operation. Pages/components
// call these instead of storage.js directly, so the storage format and the
// seeding logic stay in one place.

import { readCollection, writeCollection } from './storage';
import { seedProfile, seedEquipment, seedSettings } from './seed';

const DEFAULTS = {
  profile: seedProfile,
  equipment: seedEquipment,
  exerciseLibrary: [],
  sessionHistory: [],
  readinessLog: [],
  settings: seedSettings,
};

// Write the seed value for any collection that has never been touched, so
// every collection always exists once the app has loaded once.
function ensureSeeded() {
  for (const [collection, seedValue] of Object.entries(DEFAULTS)) {
    const missing = readCollection(collection, undefined) === undefined;
    if (missing) writeCollection(collection, seedValue);
  }
}
ensureSeeded();

// -- profile -----------------------------------------------------------

export function getProfile() {
  return readCollection('profile', seedProfile);
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
  return readCollection('exerciseLibrary', []);
}

// -- settings --------------------------------------------------------------

export function getSettings() {
  return readCollection('settings', seedSettings);
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
