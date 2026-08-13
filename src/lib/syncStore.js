// Orchestrates sync: watches auth and connectivity, runs reconciliation,
// flushes queued writes, and exposes a small observable status for the UI.

import { hasCloud } from './supabaseClient.js';
import { onAuthChange, cleanAuthParamsFromUrl } from './auth.js';
import { reconcile, pushCollection, SYNCED_COLLECTIONS } from './syncEngine.js';
import {
  readForSync,
  writeCollectionFromRemote,
  pendingCollections,
  clearPending,
  setWriteListener,
  localUpdatedAt,
} from './storage.js';

/**
 * Every status the store can be in. Exhaustive on purpose, and exported so the
 * UI maps from this list rather than guessing.
 *
 * This existing as a list is a direct consequence of the bug it replaces: the
 * badge handled five of these explicitly and let the sixth fall through to a
 * trailing `pending ? \`${pending} unsynced\`` branch. That sixth was
 * `signed-out` — so a phone with no session at all displayed "2 UNSYNCED",
 * which reads as "two uploads are stuck". Nothing was stuck. Nothing was even
 * being attempted, because syncNow() returns immediately without a user. The
 * one state where sync is not running at all was being reported as the state
 * where it is running and behind.
 */
export const SYNC_STATUSES = [
  'local-only', // no cloud project configured in this build
  'signed-out', // configured, but this device has no session — sync never runs
  'syncing', // a reconcile is in flight
  'synced', // finished, nothing queued
  'offline', // no network; queue is intact and will go up on reconnect
  'error', // something failed and said why
];

const state = {
  configured: hasCloud,
  user: null,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  status: hasCloud ? 'signed-out' : 'local-only',
  pending: 0,
  lastSyncedAt: null,
  error: null,
  // What the last pull actually returned. Reported to the UI because "it says
  // synced but my history is not here" is otherwise unanswerable from the
  // screen: you cannot tell a genuinely empty account from a read that came
  // back empty for a reason nobody surfaced.
  lastPull: null,
};

// A pull that never settles is worse than one that fails: the status sits on
// "Syncing…" forever and no retry is scheduled, because nothing ever concluded.
const PULL_TIMEOUT_MS = 15000;

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    }),
  ]);
}

const listeners = new Set();

export function getSyncState() {
  return { ...state };
}

export function subscribeSync(fn) {
  listeners.add(fn);
  fn(getSyncState());
  return () => listeners.delete(fn);
}

function emit(patch = {}) {
  Object.assign(state, patch, { pending: pendingCollections().length });
  for (const fn of listeners) {
    try {
      fn(getSyncState());
    } catch {
      /* a bad listener must not stall sync */
    }
  }
}

// -- flushing --------------------------------------------------------------

let flushing = false;
let flushAgain = false;

/** Push every collection with unsaved local changes. */
export async function flush() {
  if (!hasCloud || !state.user || !state.online) return;

  // Coalesce: a burst of writes during a workout should produce one pass, not
  // one request per set.
  if (flushing) {
    flushAgain = true;
    return;
  }
  flushing = true;

  try {
    // Keep the FIRST real reason, not a summary of it. This used to emit
    // "Some changes could not be uploaded — will retry." and drop res.error on
    // the floor, so an upload rejected by a policy, a schema mismatch, or an
    // expired session all presented identically and none of them said which.
    // A failure you cannot name is a failure you cannot fix.
    const failures = [];
    for (const collection of pendingCollections()) {
      if (!SYNCED_COLLECTIONS.includes(collection)) {
        clearPending(collection);
        continue;
      }
      const { value } = readForSync(collection);
      const res = await pushCollection(
        state.user.id,
        collection,
        value,
        localUpdatedAt(collection) || Date.now(),
      );
      if (res.ok) clearPending(collection);
      else failures.push(`${collection}: ${res.error}`);
    }
    if (failures.length) {
      emit({
        status: 'error',
        error:
          failures.length === 1
            ? `Upload failed — ${failures[0]}`
            : `${failures.length} uploads failed — ${failures[0]} (and ${failures.length - 1} more)`,
      });
      scheduleRetry();
    } else {
      resetRetries();
      emit({ status: 'synced', lastSyncedAt: Date.now(), error: null });
    }
  } catch (err) {
    // Either way the queue is kept and retried; the difference is only what we
    // tell you about why nothing is moving.
    emit(offlineOrError(err, 'Upload failed'));
  } finally {
    flushing = false;
    if (flushAgain) {
      flushAgain = false;
      flush();
    }
  }
}

// Debounce write-triggered flushes so a rapid sequence of logged sets does not
// fire a request each.
let flushTimer = null;
function scheduleFlush(delay = 1500) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, delay);
}

// -- full reconcile --------------------------------------------------------

let syncing = null;

/**
 * Merge local and cloud in both directions.
 *
 * Also serves as the first-sign-in migration: collections that exist only
 * locally have no remote row, so the merge keeps them and pushes them up.
 */
export async function syncNow() {
  if (!hasCloud || !state.user || !state.online) return;
  // Coalesce. Sign-in is reported twice (see startSync), the tab becoming
  // visible can land on top of that, and a retry may fire while one is still
  // in flight — all of which should mean one reconcile, not four racing to
  // write the same collections.
  if (syncing) return syncing;
  syncing = runSync().finally(() => {
    syncing = null;
  });
  return syncing;
}

async function runSync() {
  emit({ status: 'syncing', error: null });
  try {
    const result = await withTimeout(
      reconcile({
        userId: state.user.id,
        readLocal: readForSync,
        writeLocal: writeCollectionFromRemote,
      }),
      PULL_TIMEOUT_MS,
      'Sync',
    );
    // Anything queued while we were reconciling still needs sending.
    await flush();
    if (!result.errors.length) resetRetries();
    emit({
      status: result.errors.length ? 'error' : 'synced',
      lastSyncedAt: Date.now(),
      error: result.errors[0] ?? null,
      lastPull: {
        at: Date.now(),
        collections: result.remoteCollections,
        sessions: result.remoteSessions,
        applied: result.pulled,
      },
    });
    return result;
  } catch (err) {
    // A pull can fail for two very different reasons, and calling both
    // "offline" hides the one you can act on. A dropped connection is offline;
    // anything else — a row-level-security policy, a missing table, an expired
    // session — is a real error and its message is the useful part.
    emit({
      ...offlineOrError(err, 'Sync failed'),
      lastPull: { at: Date.now(), failed: true, message: err?.message ?? 'Sync failed' },
    });
    scheduleRetry();
  }
}

// A failed hydrate used to be the end of it: nothing retried until you
// happened to switch tabs. On the one load where it matters most — the first
// one after signing in on a new device — that means an empty screen and no
// second attempt.
let retryTimer = null;
let retryDelay = 0;
const RETRY_DELAYS = [2000, 5000, 15000, 60000];

function scheduleRetry() {
  if (retryTimer) return;
  const delay = RETRY_DELAYS[Math.min(retryDelay, RETRY_DELAYS.length - 1)];
  retryDelay++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    syncNow();
  }, delay);
}

function resetRetries() {
  clearTimeout(retryTimer);
  retryTimer = null;
  retryDelay = 0;
}

function offlineOrError(err, fallback) {
  const message = err?.message ?? fallback;
  const looksOffline =
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    /failed to fetch|networkerror|network request failed/i.test(message);
  return looksOffline
    ? { status: 'offline', error: null }
    : { status: 'error', error: message };
}

// -- wiring ----------------------------------------------------------------

let started = false;

export function startSync() {
  if (started || typeof window === 'undefined') return;
  started = true;

  // Clear the PKCE `?code=` once supabase-js has exchanged it.
  cleanAuthParamsFromUrl();

  // Any write anywhere in the app schedules an upload.
  setWriteListener(() => {
    emit({});
    scheduleFlush();
  });

  window.addEventListener('online', () => {
    emit({ online: true });
    syncNow();
  });
  window.addEventListener('offline', () => emit({ online: false, status: 'offline' }));

  // Coming back to the app is a good moment to pick up another device's work.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });

  if (!hasCloud) {
    emit({ status: 'local-only' });
    return;
  }

  onAuthChange((session) => {
    const user = session?.user ?? null;
    if (!user) resetRetries();
    emit({ user, status: user ? 'syncing' : 'signed-out' });

    // Hydrate whenever we learn there is a session, not only when the account
    // CHANGED. On a device that is already signed in, every load is a load
    // where another device's work may need to come down. The old condition
    // also made that hydrate depend on winning a race: onAuthChange reports
    // through both getSession() and the INITIAL_SESSION event, and whichever
    // arrived second saw "no change" and did nothing — so a single missed
    // first attempt was never retried. syncNow() coalesces, so asking twice
    // costs one round trip.
    if (user) syncNow();
  });
}
