// How a local collection and a remote collection are reconciled.
//
// Pure functions, no I/O — this is the part of sync that can actually lose
// data, so it is kept separate and tested directly (scripts/check-sync.mjs).
//
// Whole-document last-write-wins is fine for settings, but it is WRONG for the
// logged collections: if you log a session on your phone and another on your
// iPad before either syncs, LWW silently discards one workout. Those two get
// merged by identity instead, so both survive.

export const MERGE_STRATEGY = {
  // Union by session id. Order is newest-first by date, matching addSession().
  sessionHistory: 'unionById',
  // One entry per calendar date; a later-updated side wins a same-date clash.
  readinessLog: 'unionByDate',
  // Small documents the user edits wholesale — LWW on updated_at is correct
  // and merging them field-by-field would produce settings nobody chose.
  profile: 'lastWriteWins',
  settings: 'lastWriteWins',
  equipment: 'lastWriteWins',
  meta: 'lastWriteWins',
  // Reference data shipped with the app. It syncs so a fresh device is usable
  // immediately, but db.js re-seeds it whenever the running build's
  // EXERCISE_LIBRARY_VERSION is newer, so code always beats the cloud copy.
  exerciseLibrary: 'lastWriteWins',
};

const asArray = (v) => (Array.isArray(v) ? v : []);

/** Union two arrays by a key, preferring `primary` entries on a clash. */
function unionBy(primary, secondary, keyOf) {
  const out = [];
  const seen = new Set();

  for (const item of [...asArray(primary), ...asArray(secondary)]) {
    if (item == null) continue;
    const key = keyOf(item);
    // An entry with no usable key cannot be de-duplicated; keep it rather than
    // drop it, since losing a logged session is far worse than a duplicate.
    if (key == null || key === '') {
      out.push(item);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

const byDateDesc = (a, b) => String(b?.date ?? '').localeCompare(String(a?.date ?? ''));

/**
 * Merge one collection.
 *
 * @param {string} collection
 * @param {{ value: any, updatedAt: number }} local
 * @param {{ value: any, updatedAt: number }} remote
 * @returns {{ value: any, changed: {local: boolean, remote: boolean} }}
 *          `changed` says which side needs writing back.
 */
export function mergeCollection(collection, local, remote) {
  const strategy = MERGE_STRATEGY[collection] ?? 'lastWriteWins';

  const hasLocal = local?.value !== undefined && local?.value !== null;
  const hasRemote = remote?.value !== undefined && remote?.value !== null;

  // Only one side has anything: take it, and tell the other to catch up.
  if (hasLocal && !hasRemote) {
    return { value: local.value, changed: { local: false, remote: true } };
  }
  if (!hasLocal && hasRemote) {
    return { value: remote.value, changed: { local: true, remote: false } };
  }
  if (!hasLocal && !hasRemote) {
    return { value: undefined, changed: { local: false, remote: false } };
  }

  const localNewer = (local.updatedAt ?? 0) >= (remote.updatedAt ?? 0);

  if (strategy === 'unionById') {
    // Newer side first so its version of a duplicated id wins.
    const [first, second] = localNewer
      ? [local.value, remote.value]
      : [remote.value, local.value];
    const merged = unionBy(first, second, (s) => s?.id).sort(byDateDesc);
    return {
      value: merged,
      changed: {
        local: !sameShallow(merged, local.value),
        remote: !sameShallow(merged, remote.value),
      },
    };
  }

  if (strategy === 'unionByDate') {
    const [first, second] = localNewer
      ? [local.value, remote.value]
      : [remote.value, local.value];
    const merged = unionBy(first, second, (e) => e?.date).sort(byDateDesc);
    return {
      value: merged,
      changed: {
        local: !sameShallow(merged, local.value),
        remote: !sameShallow(merged, remote.value),
      },
    };
  }

  // lastWriteWins
  const value = localNewer ? local.value : remote.value;
  return {
    value,
    changed: { local: !localNewer, remote: localNewer && !sameShallow(value, remote.value) },
  };
}

// Cheap structural comparison. These documents are small and JSON-safe, and
// this only decides whether to skip a write, so a false "different" costs one
// redundant upsert rather than any correctness.
function sameShallow(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export { sameShallow };
