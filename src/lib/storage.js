// Thin persistence layer. Every read/write in the app goes through this
// module instead of touching `localStorage` directly. Later, swapping in a
// real API just means rewriting the two functions below (and probably
// making them async) — nothing else in the app has to change.

const NAMESPACE = 'autopilot';

function storageKey(collection) {
  return `${NAMESPACE}:${collection}`;
}

export function readCollection(collection, fallback) {
  const raw = localStorage.getItem(storageKey(collection));
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    // Corrupt/foreign data under our key — fall back rather than crash.
    return fallback;
  }
}

export function writeCollection(collection, value) {
  localStorage.setItem(storageKey(collection), JSON.stringify(value));
  return value;
}
