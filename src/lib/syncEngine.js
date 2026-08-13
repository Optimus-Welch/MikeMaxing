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
  'sessionHistory',
  'readinessLog',
  'settings',
];

// Three collections are deliberately absent, all for the same reason: they
// describe a DEVICE, not a person, and syncing them lets one device make
// decisions on another's behalf.
//
//   activeSession   a half-finished workout, tied to the phone in your hand.
//                   Syncing it would let a stale device resurrect or clobber a
//                   session you are in the middle of.
//   meta            which shipped-data migrations this browser has run.
//   exerciseLibrary reference data that ships inside the bundle, which every
//                   device already has and db.js re-seeds when the build is
//                   newer. The cloud can only offer an older copy.
//
// storage.js holds the same list as LOCAL_ONLY, which is what actually keeps
// them out of the upload queue.

const TABLE = 'collections';

/**
 * Confirm this client is really authenticated as `userId` before we believe
 * anything it tells us about that user's data.
 *
 * This is not paranoia, it is the difference between reading your account and
 * reading nothing at all. supabase-js attaches the publishable key as the
 * bearer token whenever it cannot find a session:
 *
 *     async _getAccessToken() {
 *       return (await this._getSessionToken()) ?? this.supabaseKey
 *     }
 *
 * So a request made without a session still goes out — as the `anon` role. Our
 * RLS policies grant `anon` nothing, and under RLS "you may not see these rows"
 * is not an error, it is an empty result set. A SELECT that should have
 * returned your whole training history comes back `{ data: [], error: null }`,
 * which is byte-for-byte identical to a brand new account.
 *
 * reconcile() then does the reasonable thing with an empty cloud — treats it as
 * a first sign-in and pushes the local state up. The net effect is an app that
 * only ever pushes and never pulls, showing "No sessions logged yet" on a
 * device whose account is full of sessions, with no error anywhere to explain
 * it. Checking costs one call against an in-memory session and turns that
 * silent wrong answer into a loud one.
 */
export function verifySession(session, userId) {
  if (!session?.access_token) {
    throw new Error(
      'Not signed in on this device yet — cannot read your cloud data. ' +
        'Sending the request anyway would read as an anonymous visitor and ' +
        'quietly return nothing.',
    );
  }
  if (session.user?.id && session.user.id !== userId) {
    throw new Error('This device is signed in as a different account than the one being synced.');
  }
  return session;
}

async function assertAuthenticatedAs(userId) {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  return verifySession(data?.session ?? null, userId);
}

/** Fetch every collection row for the signed-in user. */
export async function pullAll(userId) {
  if (!hasCloud) return {};

  await assertAuthenticatedAs(userId);

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

  // Same check as the pull, for a different reason. An unauthenticated write
  // does fail loudly — RLS rejects it — but it fails as "new row violates
  // row-level security policy", which reads like a broken policy rather than
  // "you are not signed in". Say the true thing instead.
  try {
    await assertAuthenticatedAs(userId);
  } catch (err) {
    return { ok: false, error: err.message };
  }

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
  if ((!hasCloud && pull === pullAll) || !userId) {
    return { pulled: 0, pushed: 0, errors: [], remoteCollections: 0, remoteSessions: 0 };
  }

  const remote = await pull(userId);
  const errors = [];
  let pulled = 0;
  let pushed = 0;

  // How many rows the cloud actually returned, kept separate from how many we
  // ended up writing locally. "Pulled 0" is ambiguous — it happens both when
  // the cloud is empty and when this device was already up to date. Knowing
  // the cloud returned N rows is what tells you the read worked at all.
  const remoteCollections = Object.keys(remote);
  const remoteSessions = Array.isArray(remote.sessionHistory?.value)
    ? remote.sessionHistory.value.length
    : 0;

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

  return {
    pulled,
    pushed,
    errors,
    remoteCollections: remoteCollections.length,
    remoteSessions,
  };
}
