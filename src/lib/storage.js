// Persistence layer. Every read/write in the app goes through this module.
//
// The public interface is unchanged and still SYNCHRONOUS:
//     readCollection(collection, fallback)
//     writeCollection(collection, value)
// Nothing above this file changed when cloud sync landed — that was the point
// of having this seam.
//
// How it works now:
//   reads   localStorage, synchronously. Always. Even signed in, even online.
//   writes  localStorage immediately, then queued for upload.
//   sync    pulls on sign-in and on reconnect, merges (mergeCollections.js),
//           and flushes the queue.
//
// Local-first rather than remote-first is not a shortcut, it is the design:
// this is used in a gym, where the network is frequently absent and a read
// that awaits a round trip is a read that hangs. Serving reads from the cache
// is also what lets the interface stay synchronous.

const NAMESPACE = 'autopilot';
const META_KEY = `${NAMESPACE}:__syncmeta`;

// Collections that stay on this device and never enter the upload queue.
//
// `activeSession` is a workout in progress: it belongs to the phone in your
// hand, and syncing it would let a stale device resurrect or clobber a session
// you are mid-way through. It is also rewritten on every single set, so
// queueing it would leave the sync badge permanently showing unsent changes
// throughout a workout.
//
// `meta` is this browser's record of which shipped-data migrations it has
// already run. It describes the device, not the user, so syncing it let one
// device's migration bookkeeping decide whether another device migrates.
//
// `exerciseLibrary` is reference data that ships inside the bundle. Every
// device already has it, and db.js re-seeds it whenever the running build is
// newer — so there is nothing for the cloud to contribute except a chance to
// hand a device an older copy than the one it was built with.
const LOCAL_ONLY = new Set(['activeSession', 'meta', 'exerciseLibrary']);

function storageKey(collection) {
  return `${NAMESPACE}:${collection}`;
}

// -- sync bookkeeping ------------------------------------------------------
// Per-collection local modification time, plus the pending-upload set. Kept in
// one localStorage key so it survives a reload mid-queue.

function readSyncMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function writeSyncMeta(meta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* quota or private mode — sync bookkeeping is best-effort */
  }
}

export function localUpdatedAt(collection) {
  return readSyncMeta().updatedAt?.[collection] ?? 0;
}

export function pendingCollections() {
  return Object.keys(readSyncMeta().pending ?? {});
}

function markDirty(collection, at = Date.now()) {
  if (LOCAL_ONLY.has(collection)) return;
  const meta = readSyncMeta();
  meta.updatedAt = { ...(meta.updatedAt ?? {}), [collection]: at };
  meta.pending = { ...(meta.pending ?? {}), [collection]: true };
  writeSyncMeta(meta);
}

export function clearPending(collection) {
  const meta = readSyncMeta();
  if (meta.pending) delete meta.pending[collection];
  writeSyncMeta(meta);
}

// -- the interface ---------------------------------------------------------

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
  markDirty(collection);
  notifyChange(collection);
  if (LOCAL_ONLY.has(collection)) return value;
  // Fire-and-forget: a write must never wait on, or fail because of, the
  // network. If the push fails the collection stays pending and the next
  // flush retries it.
  notifyWrite(collection);
  return value;
}

/**
 * Write a seed default — a value this device has never had an opinion about.
 *
 * Stamped `updatedAt: 0` on purpose. `ensureSeeded()` runs at import on every
 * device, so a laptop opening the app for the first time writes a full set of
 * defaults moments before you sign in. Stamped with the wall clock those
 * defaults are the NEWEST version of every last-write-wins collection in
 * existence, and reconciliation would dutifully overwrite the settings and
 * goals you had tuned on your phone with factory values. A timestamp of 0 says
 * what is actually true: this is a placeholder, anything real beats it.
 *
 * It is still queued for upload, so a device whose data only exists locally
 * does seed an empty cloud.
 */
export function writeSeed(collection, value) {
  localStorage.setItem(storageKey(collection), JSON.stringify(value));
  markDirty(collection, 0);
  notifyChange(collection);
  if (LOCAL_ONLY.has(collection)) return value;
  notifyWrite(collection);
  return value;
}

/**
 * Apply a value that came FROM the cloud.
 *
 * Deliberately does not mark the collection dirty — otherwise every pull would
 * queue an immediate push of what we just received, and two devices would
 * ping-pong writes at each other indefinitely.
 *
 * It DOES notify subscribers. Writing the pulled data to localStorage without
 * telling anyone is how a signed-in device could hold your whole history on
 * disk and still render "No sessions logged yet" — the screen was built from a
 * snapshot taken at mount, before the pull landed.
 */
export function writeCollectionFromRemote(collection, value, updatedAt = Date.now()) {
  localStorage.setItem(storageKey(collection), JSON.stringify(value));
  const meta = readSyncMeta();
  meta.updatedAt = { ...(meta.updatedAt ?? {}), [collection]: updatedAt };
  if (meta.pending) delete meta.pending[collection];
  writeSyncMeta(meta);
  notifyChange(collection);
  return value;
}

/** Snapshot for the merge engine. */
export function readForSync(collection) {
  return {
    value: readCollection(collection, undefined),
    updatedAt: localUpdatedAt(collection),
  };
}

// -- notifications ---------------------------------------------------------
// Two different audiences, and keeping them separate is the whole point:
//
//   writeListener  the sync store. "This DEVICE changed something — upload
//                  it." A cloud pull must never fire this, or every pull
//                  bounces straight back up as a push.
//   subscribers    the UI. "This collection's CONTENTS changed — re-read it."
//                  A cloud pull must always fire this, or the screen keeps
//                  rendering whatever it read at mount.
//
// Plain callbacks rather than imports keep storage.js free of any dependency
// on the sync layer or on React, so there is no cycle either way.

let writeListener = null;

export function setWriteListener(fn) {
  writeListener = fn;
}

function notifyWrite(collection) {
  try {
    writeListener?.(collection);
  } catch {
    /* a listener must never break a write */
  }
}

const subscribers = new Map();

/**
 * Watch one collection for content changes, from any source — a local write,
 * or a value pulled down from another device.
 *
 * @returns unsubscribe
 */
export function subscribeCollection(collection, fn) {
  if (!subscribers.has(collection)) subscribers.set(collection, new Set());
  subscribers.get(collection).add(fn);
  return () => {
    subscribers.get(collection)?.delete(fn);
  };
}

function notifyChange(collection) {
  for (const fn of subscribers.get(collection) ?? []) {
    try {
      fn(collection);
    } catch {
      /* a bad subscriber must never break a write */
    }
  }
}

/** Wipe local data on sign-out so the next account starts clean. */
export function clearLocalData(collections) {
  for (const collection of collections) localStorage.removeItem(storageKey(collection));
  localStorage.removeItem(META_KEY);
}
