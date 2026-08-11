// Pull/push engine. Talks to Supabase; the merge rules it applies live in
// mergeCollections.js so they can be tested without a network.
//
// The client is deliberately NOT the authority on reads. storage.js serves
// every read from a local cache, synchronously, because the whole app (and
// db.js's module-level seeding) is built on synchronous reads and the brief
// was to keep that interface. Sync therefore runs alongside: pull on sign-in
// and on reconnect, push on write.

import { getSupabase, hasCloud } from './supabaseClient.js';
import { mergeCollection } from './mergeCollections.js';

export const SYNCED_COLLECTIONS = [
  'profile',
  'equipment',
  'exerciseLibrary',
  'sessionHistory',
  'readinessLog',
  'settings',
  'meta',
];

// `activeSession` is deliberately absent: a half-finished workout is tied to
// the phone in your hand, and syncing it would let a stale device resurrect or
// clobber a session you are in the middle of.

const TABLE = 'collections';

/** Fetch every collection row for the signed-in user. */
export async function pullAll(userId) {
  if (!hasCloud) return {};

  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('collection, data, updated_at')
    .eq('user_id', userId);

  if (error) throw error;

  const out = {};
  for (const row of data ?? []) {
    out[row.collection] = {
      value: row.data,
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }
  return out;
}

/** Upsert one collection. */
export async function pushCollection(userId, collection, value, updatedAt) {
  if (!hasCloud) return { ok: false, error: 'not configured' };

  const { error } = await getSupabase().from(TABLE).upsert(
    {
      user_id: userId,
      collection,
      data: value ?? null,
      updated_at: new Date(updatedAt ?? Date.now()).toISOString(),
    },
    { onConflict: 'user_id,collection' },
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Reconcile local and remote for every synced collection.
 *
 * This doubles as the first-sign-in migration: a collection that exists only
 * locally has no remote counterpart, so the merge keeps the local value and
 * flags it for push. Nothing already logged is lost, and nothing needs a
 * separate one-shot migration path that could only ever be tested once.
 *
 * @param readLocal   (collection) => ({ value, updatedAt })
 * @param writeLocal  (collection, value) => void   // must NOT re-enqueue
 * @param pull        override for tests; defaults to the real pullAll
 * @param push        override for tests; defaults to the real pushCollection
 */
export async function reconcile({
  userId,
  readLocal,
  writeLocal,
  onProgress,
  // Injected so the orchestration can be tested without a network. Production
  // callers never pass these.
  pull = pullAll,
  push = pushCollection,
}) {
  if ((!hasCloud && pull === pullAll) || !userId) return { pulled: 0, pushed: 0, errors: [] };

  const remote = await pull(userId);
  const errors = [];
  let pulled = 0;
  let pushed = 0;

  for (const collection of SYNCED_COLLECTIONS) {
    const local = readLocal(collection);
    const { value, changed } = mergeCollection(collection, local, remote[collection]);

    if (value === undefined) continue;

    if (changed.local) {
      writeLocal(collection, value);
      pulled++;
    }

    if (changed.remote) {
      // Stamp the merged result as "now" so other devices see it as newest.
      const res = await push(userId, collection, value, Date.now());
      if (res.ok) pushed++;
      else errors.push(`${collection}: ${res.error}`);
    }

    onProgress?.(collection);
  }

  return { pulled, pushed, errors };
}
