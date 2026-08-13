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
  const { SYNCED_COLLECTIONS } = await import('../src/lib/syncEngine.js');

  for (const c of SYNCED_COLLECTIONS) {
    assert(MERGE_STRATEGY[c] != null, `${c} has no declared merge strategy`);
  }
  // The two append-only logs must never be whole-document LWW.
  assert(MERGE_STRATEGY.sessionHistory === 'unionById', 'sessionHistory must merge by id');
  assert(MERGE_STRATEGY.readinessLog === 'unionByDate', 'readinessLog must merge by date');
  console.log('  ', SYNCED_COLLECTIONS.map((c) => `${c}=${MERGE_STRATEGY[c]}`).join(', '));

  // Device-local collections must not be synced, and must not carry a strategy
  // either — a stray strategy is how one quietly gets synced again later.
  for (const c of ['meta', 'exerciseLibrary', 'activeSession']) {
    assert(!SYNCED_COLLECTIONS.includes(c), `${c} describes a device and must not sync`);
    assert(MERGE_STRATEGY[c] == null, `${c} is device-local but still declares a merge strategy`);
  }
  console.log('   device-local: meta, exerciseLibrary, activeSession');
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

// --- 6a. a pulled value must reach the UI, not just the disk --------------
// The bug this pins down: signing in on a second device pulled the history
// down and wrote it to localStorage, but nothing told the rendered page, so
// the screen kept showing the empty snapshot it took at mount. Every page read
// went through useState(getSessionHistory) — correct once, then frozen.
console.log('\n=== a pulled value notifies the UI ===');
{
  const storage = await import('../src/lib/storage.js');
  const seen = [];
  const stop = storage.subscribeCollection('sessionHistory', (c) => seen.push(c));

  // The pull path. This is the one that was silent.
  storage.writeCollectionFromRemote('sessionHistory', [{ id: 'cloud-1' }]);
  assert(seen.length === 1, 'applying a pulled value must notify subscribers');

  // Local writes notify too, so one subscription covers both sources.
  storage.writeCollection('sessionHistory', [{ id: 'local-1' }]);
  assert(seen.length === 2, 'a local write must notify subscribers');

  // Subscriptions are per collection: an unrelated write must not wake a page
  // that does not care. activeSession is rewritten on every single set.
  storage.writeCollection('activeSession', { index: 1 });
  assert(seen.length === 2, 'an unrelated collection must not notify');

  // A throwing subscriber must not take the write down with it.
  const stopBad = storage.subscribeCollection('sessionHistory', () => {
    throw new Error('bad subscriber');
  });
  let survived = true;
  try {
    storage.writeCollection('sessionHistory', [{ id: 'local-2' }]);
  } catch {
    survived = false;
  }
  assert(survived, 'a throwing subscriber must not break the write');
  assert(
    storage.readCollection('sessionHistory', [])[0].id === 'local-2',
    'the write must still have landed',
  );
  stopBad();

  stop();
  storage.writeCollectionFromRemote('sessionHistory', [{ id: 'cloud-2' }]);
  assert(seen.length === 3, 'unsubscribe must actually unsubscribe');
  console.log('  pulls and local writes both notify; unrelated writes do not');
}

// --- 6f. seed defaults must never outrank real cloud data ----------------
// db.js seeds every missing collection at import — which on a device you are
// about to sign in on happens seconds before the first sync. Stamped with the
// wall clock, those factory defaults are the newest version of every
// last-write-wins collection anywhere, and reconciliation would push them over
// the settings you had tuned on your phone.
console.log('\n=== seeded defaults lose to real data ===');
{
  const storage = await import('../src/lib/storage.js');

  storage.writeSeed('settings', { bands: { green: 80 }, freshnessWindow: 3 });
  assert(storage.localUpdatedAt('settings') === 0, 'a seed must be stamped as older than anything');
  assert(
    storage.pendingCollections().includes('settings'),
    'a seed must still upload, so a local-only device seeds an empty cloud',
  );

  const seeded = storage.readForSync('settings');
  const fromPhone = { value: { bands: { green: 70 }, freshnessWindow: 5 }, updatedAt: 1000 };
  const { value, changed } = mergeCollection('settings', seeded, fromPhone);

  assert(value.bands.green === 70, 'the phone’s tuned settings must win over fresh defaults');
  assert(changed.local === true, 'the fresh device must adopt them');
  assert(changed.remote === false, 'and must not push its defaults back over them');

  // A real local edit still wins, which is the whole point of LWW.
  storage.writeCollection('settings', { bands: { green: 90 } });
  const edited = storage.readForSync('settings');
  assert(edited.updatedAt > 0, 'a real edit must be stamped with a real time');
  assert(
    mergeCollection('settings', edited, fromPhone).value.bands.green === 90,
    'a genuine local edit must still beat an older cloud copy',
  );
  console.log('  factory defaults yield to the cloud; real edits still win');
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

// --- 6c-ii. reconcile(): a SEEDED second device --------------------------
// The real-world case, and the one that was broken. A second device is never
// actually empty: opening the app once runs ensureSeeded(), so by the time you
// sign in it holds an empty history, default goals and factory settings. The
// history must come down, and the defaults must not go up.
console.log('\n=== reconcile: seeded second device ===');
{
  const { reconcile } = await import('../src/lib/syncEngine.js');
  const { seedProfile, seedSettings } = await import('../src/lib/seed.js');

  // What ensureSeeded() leaves behind: real values, stamped as placeholders.
  const local = {
    profile: { value: seedProfile, updatedAt: 0 },
    settings: { value: seedSettings, updatedAt: 0 },
    sessionHistory: { value: [], updatedAt: 0 },
    readinessLog: { value: [], updatedAt: 0 },
  };

  const phoneHistory = [
    { id: 'p2', type: 'Cardio', date: '2026-08-07' },
    { id: 'p1', type: 'Lift', date: '2026-08-03' },
  ];
  const cloudRows = {
    sessionHistory: { value: phoneHistory, updatedAt: 5000 },
    readinessLog: { value: [{ date: '2026-08-07', score: 62 }], updatedAt: 5000 },
    profile: { value: { units: 'lb', goals: { liftsPerWeek: 4, cardioPerWeek: 3 } }, updatedAt: 5000 },
    settings: { value: { ...seedSettings, freshnessWindow: 6 }, updatedAt: 5000 },
  };

  const written = {};
  const pushed = {};
  const res = await reconcile({
    userId: 'user-1',
    readLocal: (c) => local[c] ?? { value: undefined, updatedAt: 0 },
    writeLocal: (c, v) => {
      written[c] = v;
    },
    pull: async () => cloudRows,
    push: async (u, c, v) => {
      pushed[c] = v;
      return { ok: true };
    },
  });

  console.log('  written locally:', Object.keys(written).sort().join(', ') || '(none)');
  console.log('  pushed back:', Object.keys(pushed).sort().join(', ') || '(none)');

  assert(res.errors.length === 0, `reconcile reported errors: ${res.errors.join('; ')}`);

  // The symptom: "No sessions logged yet" and 0/2 on a device that has them.
  assert(written.sessionHistory?.length === 2, 'the phone’s sessions must land on this device');
  assert(
    written.sessionHistory.map((s) => s.id).join(',') === 'p2,p1',
    'and in newest-first order',
  );
  assert(written.readinessLog?.length === 1, 'the readiness log must come down too');

  // The quieter half: fresh defaults must not overwrite the account.
  assert(written.profile?.goals.liftsPerWeek === 4, 'the account’s goals must win over defaults');
  assert(written.settings?.freshnessWindow === 6, 'the account’s settings must win over defaults');
  assert(pushed.profile == null, 'default goals must not be pushed over the account’s');
  assert(pushed.settings == null, 'default settings must not be pushed over the account’s');
  assert(pushed.sessionHistory == null, 'an empty history must not be pushed back');

  console.log('  cloud data hydrates the device; its factory defaults stay put');
}

// --- 6c-iii. an unauthenticated read must fail, not look empty ------------
// The mechanism this guards, quoted from the installed supabase-js:
//
//     async _getAccessToken() {
//       return (await this._getSessionToken()) ?? this.supabaseKey
//     }
//
// With no session it sends the PUBLISHABLE key, so the request goes out as the
// `anon` role. Our RLS grants `anon` nothing, and under RLS "not allowed" is
// not an error — it is zero rows. So a read of a full account returns exactly
// what a brand new account returns, and reconcile() responds by treating it as
// a first sign-in and pushing this device's empty state up. That is how an app
// with a working pull behaves as though it only pushes.
console.log('\n=== an empty read must not be mistaken for an empty account ===');
{
  const { reconcile } = await import('../src/lib/syncEngine.js');

  const phoneHistory = [{ id: 'p1', type: 'Lift', date: '2026-08-03' }];
  const local = {
    sessionHistory: { value: [], updatedAt: 0 },
    settings: { value: { bands: { green: 80 } }, updatedAt: 0 },
  };

  // 1. The silent-anon shape: a "successful" read that returned nothing.
  const pushed = {};
  const res = await reconcile({
    userId: 'user-1',
    readLocal: (c) => local[c] ?? { value: undefined, updatedAt: 0 },
    writeLocal: () => {},
    pull: async () => ({}),
    push: async (u, c, v) => {
      pushed[c] = v;
      return { ok: true };
    },
  });

  // reconcile cannot tell the difference — and should not have to. What it
  // must do is report the read as empty so the layer above, and the screen,
  // can say so instead of implying everything is fine.
  assert(res.remoteCollections === 0, 'an empty read must be reported as 0 collections');
  assert(res.remoteSessions === 0, 'an empty read must be reported as 0 sessions');
  console.log('  an empty read is reported as empty, not hidden behind "synced"');

  // 2. The same call with the session intact returns the account, and the
  //    counts distinguish it from case 1 beyond any doubt.
  const ok = await reconcile({
    userId: 'user-1',
    readLocal: (c) => local[c] ?? { value: undefined, updatedAt: 0 },
    writeLocal: () => {},
    pull: async () => ({ sessionHistory: { value: phoneHistory, updatedAt: 5000 } }),
    push: async () => ({ ok: true }),
  });
  assert(ok.remoteCollections === 1, 'a real read must report the rows it received');
  assert(ok.remoteSessions === 1, 'a real read must report the sessions it received');
  console.log('  a real read reports what it received, so the two are distinguishable');

  // 3. The guard pullAll runs before it will believe any answer at all.
  const { verifySession } = await import('../src/lib/syncEngine.js');
  const refuses = (session, userId, why) => {
    let threw = false;
    let message = '';
    try {
      verifySession(session, userId);
    } catch (err) {
      threw = true;
      message = err.message;
    }
    assert(threw, why);
    return message;
  };

  // No session at all: this is the case that used to sail through as the anon
  // role and come back with an empty, error-free result set.
  const noSession = refuses(null, 'user-1', 'a missing session must be refused, not sent as anon');
  assert(/not signed in/i.test(noSession), `the message must say why: ${noSession}`);

  // A session object with no token is the same hazard wearing a disguise.
  refuses({ user: { id: 'user-1' } }, 'user-1', 'a session without a token must be refused');

  // Signed in as somebody else: reading would return their rows, or none, and
  // either way merging them into this device's data is wrong.
  refuses(
    { access_token: 'tok', user: { id: 'someone-else' } },
    'user-1',
    'a session for a different account must be refused',
  );

  // And the good case must pass cleanly.
  let ok3 = true;
  try {
    verifySession({ access_token: 'tok', user: { id: 'user-1' } }, 'user-1');
  } catch {
    ok3 = false;
  }
  assert(ok3, 'a valid session for the right user must be accepted');
  console.log('  a read without a verified session is refused instead of read as anon');

  // The guard is only worth anything if pullAll actually runs it.
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/lib/syncEngine.js', import.meta.url), 'utf8'),
  );
  const pullBody = src.split('export async function pullAll')[1] ?? '';
  assert(
    /assertAuthenticatedAs\(userId\)/.test(pullBody.split('\n}')[0]),
    'pullAll must verify the session before trusting its result',
  );
  console.log('  pullAll runs it before trusting the result');
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

// --- 6g. db.js really seeds through writeSeed ----------------------------
// 6f proves writeSeed stamps a placeholder and 6c-ii proves a placeholder
// loses to the cloud. This is the link between them: that the seeding which
// actually runs on a fresh device goes through writeSeed and not the ordinary
// write. Run in a child process so it gets a genuinely empty store — this file
// has been writing to the shared one since test 6.
console.log('\n=== ensureSeeded stamps placeholders, not fresh writes ===');
{
  const { execFileSync } = await import('node:child_process');
  const probe = [
    'const store = new Map();',
    'globalThis.localStorage = {',
    '  getItem: (k) => (store.has(k) ? store.get(k) : null),',
    '  setItem: (k, v) => store.set(k, String(v)),',
    '  removeItem: (k) => store.delete(k),',
    '};',
    // Importing db.js is what runs ensureSeeded() and the migrations.
    "await import('../src/lib/db.js');",
    "const s = await import('../src/lib/storage.js');",
    "const { SETTINGS_VERSION } = await import('../src/lib/seed.js');",
    "for (const c of ['profile', 'settings', 'equipment', 'sessionHistory', 'readinessLog']) {",
    '  const t = s.localUpdatedAt(c);',
    '  if (t !== 0) throw new Error(`${c} was seeded with a real timestamp (${t})`);',
    '}',
    // The migrations must not fire on a fresh install and re-stamp settings.
    "const meta = s.readCollection('meta', null);",
    '  if (meta.settingsVersion !== SETTINGS_VERSION)',
    '    throw new Error(`fresh install left settingsVersion at ${meta.settingsVersion}`);',
    "console.log('ok');",
  ].join('\n');

  let ok = true;
  let detail = '';
  try {
    ok = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
      encoding: 'utf8',
      cwd: new URL('.', import.meta.url).pathname,
    }).includes('ok');
  } catch (err) {
    ok = false;
    detail =
      String(err.stderr ?? err.message)
        .split('\n')
        .find((l) => /Error/.test(l)) ?? '';
  }
  assert(ok, `ensureSeeded must write placeholders. ${detail}`);
  if (ok) console.log('  a fresh install seeds at updatedAt 0 and runs no migrations');
}

// --- 6e. the sync modules must import without a native WebSocket ----------
// supabase-js builds a realtime client inside createClient(), which needs a
// native WebSocket. Node only has one from v22, so constructing the client at
// module scope made every sync module unimportable under older Node — which is
// exactly how this broke in CI. The client is lazy now; this pins that down.
console.log('\n=== module import without native WebSocket ===');
{
  const { execFileSync } = await import('node:child_process');
  const probe = [
    'delete globalThis.WebSocket;',
    "const m = await import('../src/lib/syncEngine.js');",
    "await import('../src/lib/auth.js');",
    "await import('../src/lib/syncStore.js');",
    "if (typeof m.reconcile !== 'function') throw new Error('reconcile missing');",
    "console.log('ok');",
  ].join('\n');

  let ok = true;
  let detail = '';
  try {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
      encoding: 'utf8',
      cwd: new URL('.', import.meta.url).pathname,
    });
    ok = out.includes('ok');
  } catch (err) {
    ok = false;
    detail = String(err.stderr ?? err.message).split('\n').find((l) => /Error/.test(l)) ?? '';
  }
  assert(ok, `sync modules must import with no native WebSocket. ${detail}`);
  if (ok) console.log('  syncEngine, auth and syncStore import cleanly (client stays lazy)');
}

// --- 6h. pages must read synced collections live -------------------------
// The storage layer notifies now, but that only helps if the screens listen.
// `useState(getSessionHistory)` reads correctly exactly once and then goes
// deaf, which is what left a signed-in device rendering "No sessions logged
// yet" over a full local copy of the history. There is no DOM in this project
// to mount React into, so this is a static guard instead — cheap, and it fails
// on the shape of the mistake rather than waiting to be noticed on a phone.
console.log('\n=== pages read synced collections live ===');
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const pagesDir = new URL('../src/pages/', import.meta.url);

  // Getters that read a collection the cloud can change underneath us.
  const liveGetters = {
    getProfile: 'profile',
    getSettings: 'settings',
    getSessionHistory: 'sessionHistory',
    getReadinessLog: 'readinessLog',
    getEquipment: 'equipment',
  };

  let offenders = 0;
  for (const file of readdirSync(pagesDir).filter((f) => f.endsWith('.jsx'))) {
    const src = readFileSync(new URL(file, pagesDir), 'utf8');
    for (const getter of Object.keys(liveGetters)) {
      // The frozen-snapshot shape: useState(getX) / useState(() => getX(...)).
      const snapshot = new RegExp(String.raw`useState\(\s*(\(\s*\)\s*=>\s*)?${getter}\b`);
      if (snapshot.test(src)) {
        console.error(`  ${file}: useState(${getter}) — snapshots, never updates`);
        offenders++;
      }
    }
  }
  assert(offenders === 0, 'a page snapshots a synced collection instead of subscribing to it');

  // And confirm the page the symptom was reported on genuinely subscribes.
  const today = readFileSync(new URL('Today.jsx', pagesDir), 'utf8');
  for (const collection of ['sessionHistory', 'profile', 'settings']) {
    assert(
      new RegExp(String.raw`useCollection\(\s*'${collection}'`).test(today),
      `Today must read ${collection} through useCollection`,
    );
  }
  console.log('  no page holds a frozen snapshot of a synced collection');
}

// --- 6i. every sync status says the right thing --------------------------
// The reported bug: a phone with no session showed "2 UNSYNCED", which reads
// as two uploads stuck in a queue. Nothing was queued in any meaningful sense
// — syncNow() returns immediately without a user, so the device was not behind,
// it was not syncing at all. The badge handled five statuses explicitly and let
// the sixth fall through to a trailing `pending ? \`${pending} unsynced\``
// branch, and the sixth was `signed-out`.
console.log('\n=== every sync status is described, and described correctly ===');
{
  const { SYNC_STATUSES } = await import('../src/lib/syncStore.js');
  const { describeSync } = await import('../src/lib/syncMessages.js');

  // Exhaustiveness. This is the guard: a new status must be given words, not
  // inherit whichever branch happens to sit last.
  for (const status of SYNC_STATUSES) {
    let threw = false;
    try {
      describeSync(status, 0);
      describeSync(status, 3);
    } catch {
      threw = true;
    }
    assert(!threw, `status "${status}" has no description`);
  }
  let unknownThrew = false;
  try {
    describeSync('something-new', 0);
  } catch {
    unknownThrew = true;
  }
  assert(unknownThrew, 'an unmapped status must throw, not fall through to a neighbour');
  console.log('  all', SYNC_STATUSES.length, 'statuses mapped; an unknown one throws');

  // Signed out must read as signed out, whether or not anything is queued —
  // never as a stuck upload.
  for (const pending of [0, 2]) {
    const out = describeSync('signed-out', pending);
    const text = `${out.short} ${out.detail}`;
    assert(/not signed in/i.test(out.short), 'signed-out must say it is signed out');
    assert(
      !/unsynced|uploading|waiting to upload/i.test(text),
      `signed-out must not read as a stuck queue (pending=${pending}): ${text}`,
    );
    assert(out.action === 'settings', 'signed-out must offer the fix, not just report');
  }
  console.log('  signed-out reads as signed-out, with or without queued changes');

  // The states that ARE a working queue must not be confused with it either.
  assert(describeSync('offline', 2).tone === 'warn', 'offline is a warning, not a failure');
  assert(
    /reconnect/i.test(describeSync('offline', 2).detail),
    'offline must say the queue drains on reconnect — that IS the waiting case',
  );
  assert(describeSync('error', 0).tone === 'bad', 'a failure must look like a failure');
  assert(describeSync('syncing', 0).tone === 'busy', 'syncing is in-progress, not a problem');

  // The two quiet states stay quiet.
  assert(describeSync('synced', 0) === null, 'synced must render nothing');
  assert(describeSync('local-only', 0) === null, 'local-only must render nothing');
  console.log('  synced and local-only stay silent; offline, error and syncing are distinct');

  // And the badge must actually go through this mapping rather than
  // re-deriving labels from status with its own conditional chain.
  const { readFileSync } = await import('node:fs');
  const badge = readFileSync(new URL('../src/components/SyncBadge.jsx', import.meta.url), 'utf8');
  assert(/describeSync\(/.test(badge), 'SyncBadge must use the shared description');

  // Comments stripped: the word belongs in the explanation of why it is gone,
  // just not in anything rendered.
  const badgeCode = badge.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert(
    !/unsynced/i.test(badgeCode),
    'SyncBadge must not label anything "unsynced" — that was the misleading word',
  );
  console.log('  the badge renders from the shared mapping');

  // A failed upload must name its reason. The store used to replace res.error
  // with a fixed sentence, so a policy rejection, a schema mismatch and an
  // expired session all presented identically and none of them said which.
  const store = readFileSync(new URL('../src/lib/syncStore.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert(
    !/Some changes could not be uploaded/.test(store),
    'flush must report the real upload error, not a fixed summary',
  );
  assert(
    /res\.error/.test(store),
    'flush must carry the failure reason from pushCollection into the status',
  );
  console.log('  a failed upload reports its actual reason');
}

// --- 6j. the magic-link callback -----------------------------------------
// Sign-in never completed on any device, silently. Two independent causes, on
// the same code path, either of which alone is fatal.
console.log('\n=== magic-link callback ===');
{
  const { readAuthParamsFromUrl } = await import('../src/lib/auth.js');

  // CAUSE 1: where the code lands. This is a HashRouter app and the redirect
  // target ends in `#/`, so the provider produces `…/#/?code=abc`. supabase's
  // own helper does `new URLSearchParams(url.hash.substring(1))`, which turns
  // `/?code=abc` into one parameter NAMED `/?code`. The code is in the URL and
  // supabase cannot see it.
  const naive = new URLSearchParams(
    new URL('https://x.github.io/MikeMaxing/#/?code=abc123').hash.substring(1),
  );
  assert(naive.get('code') === null, 'precondition: the naive hash parse misses the code');

  const inHash = readAuthParamsFromUrl('https://x.github.io/MikeMaxing/#/?code=abc123');
  assert(inHash.code === 'abc123', `a code after the hash route must be found, got ${inHash.code}`);

  // The ordinary placement must still work, and win when both are present.
  const inSearch = readAuthParamsFromUrl('https://x.github.io/MikeMaxing/?code=xyz789#/');
  assert(inSearch.code === 'xyz789', 'a code in the query string must be found');
  const both = readAuthParamsFromUrl('https://x.github.io/MikeMaxing/?code=search#/?code=hash');
  assert(both.code === 'search', 'the query string must win, matching supabase precedence');

  // Implicit-style hashes must not regress.
  const implicit = readAuthParamsFromUrl('https://x.github.io/MikeMaxing/#error=access_denied');
  assert(implicit.error === 'access_denied', 'a bare hash error must still be read');

  // A normal load has nothing to do.
  const clean = readAuthParamsFromUrl('https://x.github.io/MikeMaxing/#/');
  assert(!clean.present, 'an ordinary URL must report no auth params');
  assert(clean.code === null, 'an ordinary URL must yield no code');
  console.log('  the code is found in the query string, after the hash route, or neither');

  // CAUSE 2: ordering. supabase-js reads the URL exactly once, inside
  // _initialize(), which runs when the client is CONSTRUCTED. The client is
  // lazy, so nothing constructs it at import — and startSync() stripped the
  // `?code=` before anything ever called getSupabase(). The app deleted the
  // code it needed, then built the client that would have exchanged it.
  const { readFileSync } = await import('node:fs');
  const store = readFileSync(new URL('../src/lib/syncStore.js', import.meta.url), 'utf8');

  assert(
    !/cleanAuthParamsFromUrl/.test(store),
    'startSync must not clean the URL itself — initAuth does it after the exchange',
  );
  assert(/initAuth\(\)/.test(store), 'startSync must run initAuth to complete a magic-link landing');

  const auth = readFileSync(new URL('../src/lib/auth.js', import.meta.url), 'utf8');
  const initBody = auth.slice(auth.indexOf('export async function initAuth'));
  const constructAt = initBody.indexOf('getSupabase()');
  const cleanAt = initBody.indexOf('cleanAuthParamsFromUrl()');
  const exchangeAt = initBody.indexOf('exchangeCodeForSession');
  assert(constructAt !== -1, 'initAuth must construct the client');
  assert(cleanAt !== -1, 'initAuth must clean the URL');
  assert(
    constructAt < cleanAt,
    'initAuth must construct the client BEFORE clearing the code from the URL',
  );
  assert(
    exchangeAt !== -1 && exchangeAt < auth.length,
    'initAuth must be able to exchange a code supabase did not recognise',
  );
  console.log('  the client is constructed before the URL is cleaned, never after');

  // The same thing demonstrated rather than asserted about, since the whole
  // failure was a sequencing one. This stand-in reads the URL at CONSTRUCTION,
  // which is exactly what supabase-js's _initialize() does.
  {
    const LANDED = 'https://x.github.io/MikeMaxing/?code=abc123#/';
    let url = LANDED;
    const construct = () => ({ codeSeen: readAuthParamsFromUrl(url).code });
    const clean = () => {
      url = 'https://x.github.io/MikeMaxing/#/';
    };

    // The old sequence: startSync cleaned first, and the lazy client was built
    // afterwards by onAuthChange.
    clean();
    assert(
      construct().codeSeen === null,
      'precondition: cleaning before constructing loses the code — this was the bug',
    );

    // The new sequence.
    url = LANDED;
    const client = construct();
    clean();
    assert(client.codeSeen === 'abc123', 'constructing first must see the code');
    assert(!/code=/.test(url), 'and the URL must still end up clean afterwards');
    console.log('  demonstrated: clean-then-construct loses it, construct-then-clean keeps it');
  }

  // Cleaning must remove the code from BOTH placements, or a spent code gets
  // retried on the next load.
  const cleaned = [];
  globalThis.window = {
    location: { href: 'https://x.github.io/MikeMaxing/#/?code=abc123' },
    history: { replaceState: (_s, _t, url) => cleaned.push(url) },
  };
  const { cleanAuthParamsFromUrl } = await import('../src/lib/auth.js');
  assert(cleanAuthParamsFromUrl() === true, 'a code in the hash must be recognised as cleanable');
  assert(cleaned.length === 1, 'the URL must be rewritten once');
  assert(!/code=/.test(cleaned[0]), `the code must be gone, got ${cleaned[0]}`);
  assert(/#\//.test(cleaned[0]), `the app route must survive, got ${cleaned[0]}`);
  delete globalThis.window;
  console.log('  cleaning removes the code from the hash as well as the query string');

  // CAUSE 3: the service worker must not reload a first-ever visit, which on a
  // magic-link landing discards the exchange in flight.
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert(
    /const wasControlled = Boolean\(navigator\.serviceWorker\.controller\)/.test(main),
    'the update-reload must sample whether a controller already existed',
  );
  assert(
    /if \(!wasControlled \|\| reloading\) return/.test(main),
    'a first registration must not trigger the update reload',
  );
  console.log('  a first-ever service worker registration no longer reloads the page');
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
