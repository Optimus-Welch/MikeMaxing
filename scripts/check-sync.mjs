// Cloud-sync checks: merge rules, offline queueing, and the config guards.
// No network — a fake Supabase stands in, so this runs in CI. Run with
// `npm run check:sync`.

import { mergeCollection, MERGE_STRATEGY } from '../src/lib/mergeCollections.js';
import { normaliseProjectUrl, assertNotSecretKey } from '../src/lib/supabaseConfig.js';

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`  ASSERT FAILED: ${msg}`);
    failures++;
  }
};

const at = (ms) => ({ updatedAt: ms });

// --- 1. the data-loss case ------------------------------------------------
// Two devices each log a workout before either syncs. Whole-document
// last-write-wins would throw one away; union-by-id must keep both.
console.log('=== concurrent logging on two devices ===');
{
  const phone = {
    value: [
      { id: 'b', type: 'Lift', date: '2026-08-06' },
      { id: 'a', type: 'Lift', date: '2026-08-03' },
    ],
    ...at(2000),
  };
  const ipad = {
    value: [
      { id: 'c', type: 'Cardio', date: '2026-08-07' },
      { id: 'a', type: 'Lift', date: '2026-08-03' },
    ],
    ...at(1000),
  };

  const { value, changed } = mergeCollection('sessionHistory', phone, ipad);
  const ids = value.map((s) => s.id);
  console.log('  merged ids:', ids.join(', '));

  assert(ids.length === 3, `expected 3 sessions, got ${ids.length}`);
  for (const id of ['a', 'b', 'c']) assert(ids.includes(id), `session ${id} was lost in the merge`);
  assert(new Set(ids).size === ids.length, 'the shared session was duplicated');
  assert(ids[0] === 'c', `expected newest-first ordering, got ${ids.join(',')}`);
  assert(changed.local && changed.remote, 'both sides should be told to write back');
}

// --- 2. readiness log: one entry per date --------------------------------
console.log('\n=== readiness log union by date ===');
{
  const local = { value: [{ date: '2026-08-07', score: 90 }], ...at(2000) };
  const remote = {
    value: [
      { date: '2026-08-07', score: 40 },
      { date: '2026-08-06', score: 70 },
    ],
    ...at(1000),
  };
  const { value } = mergeCollection('readinessLog', local, remote);
  console.log('  merged:', JSON.stringify(value));

  assert(value.length === 2, `expected 2 dated entries, got ${value.length}`);
  const today = value.find((e) => e.date === '2026-08-07');
  assert(today.score === 90, `newer side should win a same-date clash, got ${today.score}`);
  assert(value.some((e) => e.date === '2026-08-06'), 'the remote-only date was lost');
}

// --- 3. documents use last-write-wins ------------------------------------
console.log('\n=== settings last-write-wins ===');
{
  const older = { value: { bands: { green: 80 } }, ...at(1000) };
  const newer = { value: { bands: { green: 75 } }, ...at(5000) };

  assert(mergeCollection('settings', newer, older).value.bands.green === 75, 'newer local wins');
  assert(mergeCollection('settings', older, newer).value.bands.green === 75, 'newer remote wins');
  console.log('  newer side wins in both directions');
}

// --- 4. first sign-in migration ------------------------------------------
// A collection that exists only locally must survive and be flagged for push.
console.log('\n=== first sign-in migration ===');
{
  const local = { value: [{ id: 'x', type: 'Lift', date: '2026-08-01' }], ...at(1000) };
  const remote = { value: undefined, updatedAt: 0 };
  const { value, changed } = mergeCollection('sessionHistory', local, remote);

  assert(value.length === 1 && value[0].id === 'x', 'local-only data must be kept');
  assert(changed.remote === true, 'local-only data must be queued for upload');
  assert(changed.local === false, 'local-only data must not be rewritten locally');
  console.log('  local-only history preserved and queued for upload');

  // And the reverse: a fresh device with nothing local takes the cloud copy.
  const fresh = mergeCollection('sessionHistory', { value: undefined, updatedAt: 0 }, local);
  assert(fresh.value.length === 1, 'a fresh device must receive the cloud copy');
  assert(fresh.changed.local === true, 'a fresh device must write what it pulled');
  console.log('  fresh device receives the cloud copy');
}

// --- 5. every synced collection has a deliberate strategy ----------------
console.log('\n=== strategy coverage ===');
{
  const synced = [
    'profile',
    'equipment',
    'exerciseLibrary',
    'sessionHistory',
    'readinessLog',
    'settings',
    'meta',
  ];
  for (const c of synced) {
    assert(MERGE_STRATEGY[c] != null, `${c} has no declared merge strategy`);
  }
  // The two append-only logs must never be whole-document LWW.
  assert(MERGE_STRATEGY.sessionHistory === 'unionById', 'sessionHistory must merge by id');
  assert(MERGE_STRATEGY.readinessLog === 'unionByDate', 'readinessLog must merge by date');
  console.log('  ', synced.map((c) => `${c}=${MERGE_STRATEGY[c]}`).join(', '));
}

// --- 6. offline queue + no push/pull ping-pong ---------------------------
console.log('\n=== offline queue ===');
{
  // Minimal localStorage so storage.js can load.
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const storage = await import('../src/lib/storage.js');

  // Writes queue.
  storage.writeCollection('sessionHistory', [{ id: 'a' }]);
  storage.writeCollection('settings', { bands: {} });
  let pending = storage.pendingCollections().sort();
  console.log('  after 2 local writes, pending:', pending.join(', '));
  assert(pending.length === 2, `expected 2 pending, got ${pending.length}`);

  // Reads stay synchronous and correct while "offline".
  const read = storage.readCollection('sessionHistory', null);
  assert(Array.isArray(read) && read[0].id === 'a', 'reads must work offline from cache');

  // A successful upload clears just that collection.
  storage.clearPending('settings');
  pending = storage.pendingCollections();
  assert(pending.length === 1 && pending[0] === 'sessionHistory', 'clearPending must be targeted');

  // Applying a remote value must NOT re-queue it, or devices ping-pong.
  storage.writeCollectionFromRemote('sessionHistory', [{ id: 'a' }, { id: 'b' }]);
  pending = storage.pendingCollections();
  console.log('  after applying a remote value, pending:', pending.length === 0 ? '(none)' : pending);
  assert(pending.length === 0, 'a remote-applied value must not be queued for re-upload');
  assert(
    storage.readCollection('sessionHistory', []).length === 2,
    'the remote value should be readable immediately',
  );

  // An in-progress workout must never enter the upload queue: it is rewritten
  // on every set, so queueing it would leave the badge permanently "unsynced".
  storage.writeCollection('activeSession', { index: 3 });
  assert(
    !storage.pendingCollections().includes('activeSession'),
    'activeSession must not be queued for upload',
  );
  assert(
    storage.readCollection('activeSession', null)?.index === 3,
    'activeSession must still persist locally',
  );
  console.log('  activeSession persists locally but never queues');

  // The synchronous interface is unchanged — this is what pages depend on.
  assert(typeof storage.readCollection === 'function', 'readCollection must still exist');
  assert(storage.readCollection.length === 2, 'readCollection(collection, fallback) signature');
  assert(storage.writeCollection.length === 2, 'writeCollection(collection, value) signature');
  assert(
    storage.readCollection('nope', 'fallback') === 'fallback',
    'a missing collection must still return the fallback',
  );
}

// --- 6b. reconcile(): the actual first-sign-in migration ------------------
// Exercises the orchestration, not just the merge rules underneath it, using
// a fake Supabase so it runs without a network.
console.log('\n=== reconcile: first sign-in migration ===');
{
  const { reconcile, SYNCED_COLLECTIONS } = await import('../src/lib/syncEngine.js');

  // A device with existing localStorage data and a completely empty cloud.
  const local = {
    profile: { value: { units: 'lb', goals: { liftsPerWeek: 2 } }, updatedAt: 1000 },
    settings: { value: { bands: { green: 80 } }, updatedAt: 1000 },
    sessionHistory: {
      value: [
        { id: 's2', type: 'Cardio', date: '2026-08-07' },
        { id: 's1', type: 'Lift', date: '2026-08-03' },
      ],
      updatedAt: 1000,
    },
    readinessLog: { value: [{ date: '2026-08-07', score: 90 }], updatedAt: 1000 },
  };

  const cloud = {};            // empty project, as after running schema.sql
  const written = {};          // what reconcile wrote back locally

  const res = await reconcile({
    userId: 'user-1',
    readLocal: (c) => local[c] ?? { value: undefined, updatedAt: 0 },
    writeLocal: (c, v) => {
      written[c] = v;
    },
    pull: async () => ({}),
    push: async (userId, collection, value) => {
      cloud[collection] = { userId, value };
      return { ok: true };
    },
  });

  console.log(`  pushed ${res.pushed}, pulled ${res.pulled}, errors ${res.errors.length}`);
  console.log('  uploaded collections:', Object.keys(cloud).sort().join(', '));

  assert(res.errors.length === 0, `migration reported errors: ${res.errors.join('; ')}`);
  assert(res.pulled === 0, 'nothing should be pulled from an empty cloud');
  assert(Object.keys(written).length === 0, 'an empty cloud must not overwrite local data');

  // Everything the user already had must have gone up, keyed to their user id.
  for (const c of ['profile', 'settings', 'sessionHistory', 'readinessLog']) {
    assert(cloud[c] != null, `${c} was not migrated to the cloud`);
    assert(cloud[c].userId === 'user-1', `${c} was not keyed to the user id`);
  }
  assert(cloud.sessionHistory.value.length === 2, 'both logged sessions must be uploaded');
  assert(
    cloud.profile.value.goals.liftsPerWeek === 2,
    'profile contents must survive the migration',
  );

  // Collections the device never had should not be invented.
  const emptyOnes = SYNCED_COLLECTIONS.filter((c) => local[c] == null);
  for (const c of emptyOnes) {
    assert(cloud[c] == null, `${c} was empty locally but got uploaded anyway`);
  }
  console.log('  local-only data migrated; empty collections left alone');
}

// --- 6c. reconcile(): a second device pulls what the first uploaded -------
console.log('\n=== reconcile: second device ===');
{
  const { reconcile } = await import('../src/lib/syncEngine.js');

  const cloudRows = {
    sessionHistory: {
      value: [{ id: 's1', type: 'Lift', date: '2026-08-03' }],
      updatedAt: 5000,
    },
    settings: { value: { bands: { green: 75 } }, updatedAt: 5000 },
  };
  const written = {};
  const pushed = {};

  const res = await reconcile({
    userId: 'user-1',
    // Fresh device: nothing stored locally.
    readLocal: () => ({ value: undefined, updatedAt: 0 }),
    writeLocal: (c, v) => {
      written[c] = v;
    },
    pull: async () => cloudRows,
    push: async (u, c, v) => {
      pushed[c] = v;
      return { ok: true };
    },
  });

  console.log('  written locally:', Object.keys(written).sort().join(', '));
  assert(res.pulled === 2, `expected 2 collections pulled, got ${res.pulled}`);
  assert(written.sessionHistory?.length === 1, 'the cloud session history must land locally');
  assert(written.settings?.bands.green === 75, 'cloud settings must land locally');
  assert(Object.keys(pushed).length === 0, 'a fresh device has nothing to push back');
  console.log('  fresh device receives cloud data and pushes nothing back');
}

// --- 6d. reconcile(): a failed upload is reported, not swallowed ----------
console.log('\n=== reconcile: upload failure ===');
{
  const { reconcile } = await import('../src/lib/syncEngine.js');
  const res = await reconcile({
    userId: 'user-1',
    readLocal: (c) =>
      c === 'settings' ? { value: { bands: {} }, updatedAt: 1000 } : { value: undefined, updatedAt: 0 },
    writeLocal: () => {},
    pull: async () => ({}),
    push: async () => ({ ok: false, error: 'new row violates row-level security policy' }),
  });
  console.log('  errors surfaced:', JSON.stringify(res.errors));
  assert(res.errors.length === 1, 'a failed upload must be reported');
  assert(/row-level security/.test(res.errors[0]), 'the underlying error must be preserved');
  assert(res.pushed === 0, 'a failed upload must not be counted as pushed');
}

// --- 7. config guards -----------------------------------------------------
console.log('\n=== config guards ===');
{
  // The dashboard hands out a URL with /rest/v1/ appended; supabase-js needs
  // the origin, or every request doubles the path and 404s.
  assert(
    normaliseProjectUrl('https://abc.supabase.co/rest/v1/') === 'https://abc.supabase.co',
    'a /rest/v1/ suffix must be trimmed to the origin',
  );
  assert(
    normaliseProjectUrl('https://abc.supabase.co') === 'https://abc.supabase.co',
    'a bare origin must pass through unchanged',
  );
  console.log('  project URL normalisation ok');

  // The one mistake that would actually breach the data.
  let threw = false;
  try {
    assertNotSecretKey('sb_secret_abc123');
  } catch {
    threw = true;
  }
  assert(threw, 'an sb_secret_* key must be refused');

  threw = false;
  const serviceRoleJwt = `x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.y`;
  try {
    assertNotSecretKey(serviceRoleJwt);
  } catch {
    threw = true;
  }
  assert(threw, 'a service_role JWT must be refused');

  let ok = true;
  try {
    assertNotSecretKey('sb_publishable_abc123');
  } catch {
    ok = false;
  }
  assert(ok, 'a publishable key must be accepted');
  console.log('  secret-key guard rejects sb_secret_* and service_role JWTs');
}

// --- 8. no secret ever committed -----------------------------------------
// Scans for key VALUES, not the words. The word "service_role" legitimately
// appears in the schema's policies, in the startup guard, and in the README —
// matching on it just trains you to ignore the check. What must never appear
// is an actual credential.
console.log('\n=== repository secret scan ===');
{
  const { execSync } = await import('node:child_process');
  const repo = new URL('..', import.meta.url).pathname;

  const patterns = [
    // A real secret key: the prefix followed by actual key material.
    ['sb_secret_ key', String.raw`sb_secret_[A-Za-z0-9_-]{8,}`],
    // Any JWT literal. Supabase legacy service_role keys are JWTs, and no
    // legitimate JWT belongs in source either.
    ['JWT literal', String.raw`eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.`],
    // A service-role env var with something assigned to it.
    ['service-role env var', String.raw`SUPABASE_SERVICE[A-Z_]*\s*[=:]\s*\S`],
  ];

  for (const [label, pattern] of patterns) {
    const out = execSync(
      `git grep -nIE ${JSON.stringify(pattern)} -- . ':(exclude)scripts/check-sync.mjs' || true`,
      { encoding: 'utf8', cwd: repo },
    ).trim();
    if (out) console.error(`  ${label}:\n${out}`);
    assert(out === '', `a ${label} appears in tracked files`);
  }
  console.log('  no secret key material in tracked files');

  // And the publishable key that IS committed must really be publishable.
  const cfg = execSync('git show :src/lib/supabaseConfig.js', { encoding: 'utf8', cwd: repo });
  const keys = cfg.match(/sb_[a-z]+_[A-Za-z0-9_-]+/g) ?? [];
  for (const k of keys) {
    assert(k.startsWith('sb_publishable_'), `committed key is not publishable: ${k.slice(0, 20)}…`);
  }
  console.log(`  committed key(s) are publishable: ${keys.length ? keys.map((k) => k.slice(0, 18) + '…').join(', ') : '(none)'}`);
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
