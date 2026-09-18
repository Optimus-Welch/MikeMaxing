// Does a library change actually REACH an existing device?
//
// This check exists because of a bug every other check was blind to. 21
// exercises gained `unilateral: true`; EXERCISE_LIBRARY_VERSION was left at 1;
// ensureLibraryCurrent() therefore returned early on every existing install,
// which went on generating sessions from the library it had cached before the
// change — showing "3 × 10" for a split squat while the source said
// "3 × 10 per side". check:library, check:generator and check:unilateral all
// passed throughout, because every one of them imports seedExerciseLibrary
// directly and never goes near storage.
//
// So this file deliberately does the opposite: it drives db.js against a fake
// localStorage holding a STALE library, exactly as a real device would.
//
// Run with `npm run check:librarysync`.

import { seedExerciseLibrary, isUnilateral } from '../src/lib/exercises.js';
import { libraryFingerprint } from '../src/lib/seed.js';
import { generateLiftSession } from '../src/lib/liftGenerator.js';

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`  ASSERT FAILED: ${msg}`);
    failures++;
  }
};

const K = (name) => `autopilot:${name}`;

function installFakeStorage(initial) {
  const store = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return store;
}

// The library as it stood BEFORE the per-side tags — what a real device was
// still holding, and still generating from.
const staleLibrary = seedExerciseLibrary.map(({ unilateral: _dropped, ...rest }) => rest);

console.log('=== the fingerprint notices a changed library ===');
{
  const current = libraryFingerprint(seedExerciseLibrary);
  assert(current === libraryFingerprint(seedExerciseLibrary), 'the fingerprint must be stable');
  assert(
    current !== libraryFingerprint(staleLibrary),
    'dropping a field from every tagged exercise must change the fingerprint',
  );
  // A change anywhere, not just to the tags.
  const renamed = seedExerciseLibrary.map((e, i) => (i === 0 ? { ...e, name: `${e.name} ` } : e));
  assert(current !== libraryFingerprint(renamed), 'a renamed exercise must change the fingerprint');
  const extra = [...seedExerciseLibrary, { id: 'new', name: 'New' }];
  assert(current !== libraryFingerprint(extra), 'an added exercise must change the fingerprint');
  console.log(`  ${current} — stable, and moves for a tag, a rename or an addition`);
}

console.log('\n=== a stale device re-seeds and sees the tags ===');
{
  // An existing install: real data, the pre-tag library, and meta claiming it
  // is already up to date under the OLD version scheme. This is the exact
  // state that shipped the bug.
  const store = installFakeStorage({
    [K('profile')]: JSON.stringify({ units: 'lb', goals: { liftsPerWeek: 2, cardioPerWeek: 2 } }),
    [K('settings')]: JSON.stringify({ bands: { green: 80, yellow: 55, orange: 35 }, freshnessWindow: 3 }),
    [K('readinessLog')]: JSON.stringify([]),
    [K('sessionHistory')]: JSON.stringify([]),
    [K('exerciseLibrary')]: JSON.stringify(staleLibrary),
    [K('meta')]: JSON.stringify({ exerciseLibraryVersion: 1, settingsVersion: 2 }),
  });

  const before = JSON.parse(store.get(K('exerciseLibrary')));
  assert(
    before.filter(isUnilateral).length === 0,
    'precondition: the stored library carries no per-side tags',
  );

  // Importing db.js runs the migrations, exactly as loading the app does.
  const db = await import('../src/lib/db.js');
  const library = db.getExerciseLibrary();

  const tagged = library.filter(isUnilateral);
  assert(tagged.length > 0, 'the device must pick up the per-side tags');
  assert(
    tagged.length === seedExerciseLibrary.filter(isUnilateral).length,
    `all ${seedExerciseLibrary.filter(isUnilateral).length} tags must arrive, got ${tagged.length}`,
  );
  for (const id of ['front-foot-elevated-split-squat', 'half-kneeling-dumbbell-press', 'b-stance-rdl']) {
    assert(isUnilateral(library.find((e) => e.id === id)), `${id} must be tagged after the upgrade`);
  }

  // ...and it is written back, so the next load does not have to redo it.
  const stored = JSON.parse(store.get(K('exerciseLibrary')));
  assert(stored.filter(isUnilateral).length === tagged.length, 'the refreshed library must be persisted');
  const meta = JSON.parse(store.get(K('meta')));
  assert(
    meta.exerciseLibraryFingerprint === libraryFingerprint(seedExerciseLibrary),
    'the stored fingerprint must be updated, so this runs once rather than every load',
  );
  console.log(`  ${tagged.length} tags arrived on a device that claimed to be up to date`);

  // The whole point: what the user actually sees.
  const session = generateLiftSession({
    location: 'Home',
    band: 'Yellow',
    library,
    exerciseCount: 6,
    seed: 11,
    template: { id: 'B', name: 'B', slots: [{ pattern: 'unilateral', emphasis: 'secondary' }] },
  });
  for (const ex of session.exercises) {
    const source = seedExerciseLibrary.find((e) => e.id === ex.exerciseId);
    if (!isUnilateral(source)) continue;
    assert(
      ex.prescription.includes('per side'),
      `a per-side lift generated from the stored library must say so: "${ex.prescription}"`,
    );
    console.log(`  generated from storage: ${ex.name} — ${ex.prescription}`);
  }
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
