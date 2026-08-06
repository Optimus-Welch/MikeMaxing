// Verifies that an install carrying pre-Garmin data survives the upgrade.
// Runs db.js against a fake localStorage seeded with old-shape data.
// Run with `npm run check:migration`.

import { seedSettings, SETTINGS_VERSION } from '../src/lib/seed.js';

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`  ASSERT FAILED: ${msg}`);
    failures++;
  }
};

// Minimal localStorage stand-in — db.js only needs getItem/setItem.
function installFakeStorage(initial) {
  const store = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return store;
}

const K = (name) => `autopilot:${name}`;

// --- an install from before the Garmin change ------------------------------
// Old settings: readinessWeights present, no durationTargets, and band
// thresholds the user had customised. Old readiness entries were computed
// from sleep/load/energy. Old sessions were logged against those bands.
const legacyReadiness = [
  { date: '2026-07-25', sleepScore: 82, load: 2, energy: 4, score: 84, band: 'Green' },
  { date: '2026-07-24', sleepScore: 55, load: 4, energy: null, score: 51, band: 'Red' },
  // An entry whose band never got written — the migration should recover it.
  { date: '2026-07-23', sleepScore: 70, load: 3, score: 66 },
];
const legacySessions = [
  {
    id: 'old-1',
    type: 'Lift',
    location: 'Work',
    date: '2026-07-25',
    templateId: 'A',
    exercises: [
      { exerciseId: 'back-squat', name: 'Back Squat', variationGroup: 'back-squat', sets: [{ reps: 5, weight: 185, rpe: 8 }] },
    ],
  },
  { id: 'old-2', type: 'Cardio', location: 'Home', date: '2026-07-24' },
];

const store = installFakeStorage({
  [K('profile')]: JSON.stringify({ units: 'lb', goals: { liftsPerWeek: 3, cardioPerWeek: 2 } }),
  [K('settings')]: JSON.stringify({
    readinessWeights: { sleep: 0.5, load: 0.4, energy: 0.1 },
    bands: { green: 75, yellow: 50, orange: 30 }, // user-customised
    freshnessWindow: 4, // user-customised
  }),
  [K('readinessLog')]: JSON.stringify(legacyReadiness),
  [K('sessionHistory')]: JSON.stringify(legacySessions),
  [K('exerciseLibrary')]: JSON.stringify([]),
  [K('meta')]: JSON.stringify({ exerciseLibraryVersion: 1, settingsVersion: 0 }),
});

// Importing db.js runs the migrations as a side effect.
const db = await import('../src/lib/db.js');

console.log('=== settings migration ===');
const settings = db.getSettings();
console.log('  ', JSON.stringify(settings));

assert(settings.readinessWeights === undefined, 'readinessWeights must be gone from settings');
assert(settings.bands.green === 75, 'user-customised band threshold must be preserved (green=75)');
assert(settings.bands.yellow === 50, 'user-customised band threshold must be preserved (yellow=50)');
assert(settings.freshnessWindow === 4, 'user-customised freshnessWindow must be preserved');
assert(settings.durationTargets != null, 'durationTargets must be added');
for (const band of ['Green', 'Yellow', 'Orange', 'Red']) {
  assert(
    settings.durationTargets[band]?.liftExercises > 0,
    `durationTargets.${band}.liftExercises must have a sensible default`,
  );
  assert(
    settings.durationTargets[band]?.cardioMinutes > 0,
    `durationTargets.${band}.cardioMinutes must have a sensible default`,
  );
}
const meta = JSON.parse(store.get(K('meta')));
assert(meta.settingsVersion === SETTINGS_VERSION, 'settingsVersion must be stamped');

console.log('\n=== readiness log migration ===');
const log = db.getReadinessLog();
for (const e of log) console.log('  ', JSON.stringify(e));

assert(log.length === legacyReadiness.length, 'no readiness entries may be lost');
for (const entry of log) {
  assert(entry.score != null, `entry ${entry.date} must keep its score`);
  assert(entry.band != null, `entry ${entry.date} must have a band`);
  assert(entry.source === 'legacy', `entry ${entry.date} must be tagged as legacy`);
}
// The raw historical inputs are a record of what happened; keep them.
const withInputs = log.find((e) => e.date === '2026-07-25');
assert(withInputs.sleepScore === 82, 'legacy sleepScore must be preserved as history');
assert(withInputs.load === 2, 'legacy load must be preserved as history');
// The entry missing a band should have had one recovered from its score,
// using the user's own thresholds (66 >= yellow 50 -> Yellow).
const recovered = log.find((e) => e.date === '2026-07-23');
assert(
  recovered.band === 'Yellow',
  `band should be recovered from score 66 with custom thresholds, got ${recovered.band}`,
);

console.log('\n=== session history untouched ===');
const history = db.getSessionHistory();
assert(history.length === legacySessions.length, 'no sessions may be lost');
assert(history[0].exercises[0].sets[0].weight === 185, 'logged sets must be intact');
console.log(`   ${history.length} sessions preserved, sets intact`);

// Old sessions still feed weight pre-fill and freshness.
const last = db.getLastPerformance('back-squat');
assert(last?.weight === 185, 'getLastPerformance must still read pre-Garmin sessions');
console.log(`   getLastPerformance('back-squat') -> ${JSON.stringify(last)}`);

console.log('\n=== idempotency ===');
const before = store.get(K('readinessLog'));
const settingsBefore = store.get(K('settings'));
// Re-running the migrations must not double-apply.
const db2 = await import(`../src/lib/db.js?rerun=${Date.now()}`);
db2.getSettings();
assert(store.get(K('readinessLog')) === before, 'readinessLog must be stable on re-run');
assert(store.get(K('settings')) === settingsBefore, 'settings must be stable on re-run');
console.log('   re-import did not re-write migrated data');

console.log('\n=== fresh install still works ===');
installFakeStorage({});
const db3 = await import(`../src/lib/db.js?fresh=${Date.now()}`);
const freshSettings = db3.getSettings();
assert(freshSettings.readinessWeights === undefined, 'fresh install must not have readinessWeights');
assert(
  freshSettings.durationTargets.Green.liftExercises === seedSettings.durationTargets.Green.liftExercises,
  'fresh install must get seed duration targets',
);
assert(db3.getExerciseLibrary().length > 0, 'fresh install must get the exercise library');
console.log('   fresh install seeded correctly');

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
