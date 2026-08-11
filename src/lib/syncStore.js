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

const state = {
  configured: hasCloud,
  user: null,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  status: hasCloud ? 'signed-out' : 'local-only',
  pending: 0,
  lastSyncedAt: null,
  error: null,
};

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
    let failed = false;
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
      else failed = true;
    }
    emit(
      failed
        ? { status: 'error', error: 'Some changes could not be uploaded — will retry.' }
        : { status: 'synced', lastSyncedAt: Date.now(), error: null },
    );
  } catch (err) {
    // Offline or a transient failure: keep the queue and try again later.
    emit({ status: 'offline', error: err?.message ?? 'Upload failed' });
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

/**
 * Merge local and cloud in both directions.
 *
 * Also serves as the first-sign-in migration: collections that exist only
 * locally have no remote row, so the merge keeps them and pushes them up.
 */
export async function syncNow() {
  if (!hasCloud || !state.user || !state.online) return;

  emit({ status: 'syncing', error: null });
  try {
    const result = await reconcile({
      userId: state.user.id,
      readLocal: readForSync,
      writeLocal: writeCollectionFromRemote,
    });
    // Anything queued while we were reconciling still needs sending.
    await flush();
    emit({
      status: result.errors.length ? 'error' : 'synced',
      lastSyncedAt: Date.now(),
      error: result.errors[0] ?? null,
    });
    return result;
  } catch (err) {
    emit({ status: 'offline', error: err?.message ?? 'Sync failed' });
  }
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
    const changed = user?.id !== state.user?.id;
    emit({ user, status: user ? 'syncing' : 'signed-out' });
    if (user && changed) syncNow();
  });
}
