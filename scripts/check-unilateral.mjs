// Per-side (unilateral) labelling. Run with `npm run check:unilateral`.
//
// Two things to prove. First, the LIBRARY is tagged correctly and completely —
// the whole point of the audit was that nobody should have to find these one
// by one. Second, "per side" means the same thing at every step of the chain:
// prescription -> what you log -> what is suggested next. A conversion
// anywhere in there is the bug this feature exists to prevent.

import {
  seedExerciseLibrary,
  isUnilateral,
  sidesFor,
  validateLibrary,
  PER_SIDE_LABEL,
} from '../src/lib/exercises.js';
import { generateLiftSession, SCHEMES } from '../src/lib/liftGenerator.js';
import { suggestFor } from '../src/lib/progression.js';
import { totalVolume } from '../src/lib/sessionStats.js';
import { muscleVolume } from '../src/lib/analytics.js';

const library = seedExerciseLibrary;
let failures = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`  ASSERT FAILED: ${msg}`);
    failures++;
  }
};

// --- 1. the library audit --------------------------------------------------
console.log('=== library tagging ===');
{
  assert(validateLibrary().length === 0, `library must validate: ${validateLibrary().join('; ')}`);

  const tagged = library.filter(isUnilateral).map((e) => e.id);
  console.log(`  ${tagged.length} of ${library.length} exercises tagged per side`);

  // Every movement in the unilateral SLOT must be tagged — validateLibrary
  // enforces it, this states it as an expectation of its own.
  for (const ex of library.filter((e) => e.movementPattern === 'unilateral')) {
    assert(isUnilateral(ex), `${ex.id}: unilateral-pattern movement is not tagged`);
  }

  // Name-based cross-check. Anything calling itself single-leg, single-arm,
  // one-arm, split, lunge, step-up, B-stance or side-something is per side —
  // this is the net that catches a new library entry nobody tagged.
  const NAME_HINTS = /single-leg|single-arm|one-arm|b-stance|split squat|lunge|step-up|side plank|suitcase/i;
  for (const ex of library) {
    if (NAME_HINTS.test(ex.name) && !isUnilateral(ex)) {
      assert(false, `${ex.id} ("${ex.name}") reads as per-side but is not tagged`);
    }
  }

  // ...and the converse: nothing obviously bilateral should be tagged.
  const BILATERAL_HINTS = /^(back squat|front squat|barbell bench|conventional deadlift|pull-up|chin-up|plank)$/i;
  for (const ex of library.filter(isUnilateral)) {
    assert(!BILATERAL_HINTS.test(ex.name), `${ex.id} ("${ex.name}") is tagged per side but is bilateral`);
  }

  // capStrategy: 'unilateral' answers a DIFFERENT question (why a lift stays
  // hard under a load cap). The two must not have been conflated.
  const capOnly = library.filter((e) => e.capStrategy === 'unilateral' && !isUnilateral(e));
  const tagOnly = library.filter((e) => isUnilateral(e) && e.capStrategy !== 'unilateral');
  assert(capOnly.length === 0, `capStrategy unilateral but untagged: ${capOnly.map((e) => e.id).join()}`);
  assert(
    tagOnly.length > 0,
    'the two fields should NOT be identical — tempo/elevated per-side lifts exist',
  );
  console.log(`  ${tagOnly.length} per-side lifts carry a non-unilateral capStrategy (tempo, elevated range...)`);
  assert(sidesFor(library.find(isUnilateral)) === 2, 'a per-side movement is performed twice');
  assert(sidesFor(library.find((e) => !isUnilateral(e))) === 1, 'a bilateral movement once');
}

// --- 2. every scheme says "per side" ---------------------------------------
console.log('\n=== prescriptions are unambiguous ===');
{
  for (const scheme of SCHEMES) {
    const withSide = scheme.describe({ sets: 4, reps: 12, rpe: '6–7', unilateral: true });
    const without = scheme.describe({ sets: 4, reps: 12, rpe: '6–7', unilateral: false });
    assert(
      withSide.prescription.includes(PER_SIDE_LABEL),
      `${scheme.id}: per-side prescription must say "${PER_SIDE_LABEL}", got "${withSide.prescription}"`,
    );
    assert(
      !without.prescription.includes(PER_SIDE_LABEL),
      `${scheme.id}: a bilateral prescription must not, got "${without.prescription}"`,
    );
  }
  console.log(`  all ${SCHEMES.length} schemes label a per-side set`);

  // Through the real generator, at both locations, over many seeds: a
  // prescription must say "per side" if and only if the movement is per side.
  let checked = 0;
  let labelled = 0;
  for (let seed = 1; seed <= 60; seed++) {
    for (const location of ['Work', 'Home']) {
      const session = generateLiftSession({ location, band: 'Yellow', library, exerciseCount: 6, seed });
      for (const ex of session.exercises) {
        checked++;
        const source = library.find((e) => e.id === ex.exerciseId);
        assert(ex.unilateral === isUnilateral(source), `${ex.name}: entry flag disagrees with the library`);
        const says = ex.prescription.includes(PER_SIDE_LABEL);
        assert(says === isUnilateral(source), `${ex.name}: "${ex.prescription}" mislabels a per-side lift`);
        if (says) labelled++;
      }
    }
  }
  console.log(`  ${checked} generated slots, ${labelled} labelled per side, no mismatches`);

  // Time-based per-side work too (side plank, suitcase carry).
  const timed = generateLiftSession({
    location: 'Home', band: 'Yellow', library, exerciseCount: 6, seed: 3,
    template: { id: 'T', name: 'T', slots: [{ pattern: 'core', emphasis: 'accessory' }] },
  });
  for (const ex of timed.exercises.filter((e) => e.seconds != null && e.unilateral)) {
    assert(ex.prescription.includes(PER_SIDE_LABEL), `timed per-side "${ex.prescription}" must say per side`);
  }
}

// --- 3. progression stays in per-side terms --------------------------------
console.log('\n=== progression does not convert ===');
{
  const row = library.find((e) => e.id === 'one-arm-dumbbell-row');
  assert(isUnilateral(row), 'precondition: the one-arm row is per side');

  // 50 lb in ONE hand for 12 reps on that side.
  const history = [{
    id: 'h', type: 'Lift', location: 'Work', date: '2026-09-10',
    exercises: [{
      exerciseId: 'one-arm-dumbbell-row', name: 'One-Arm Dumbbell Row',
      variationGroup: 'single-arm-row', pattern: 'horizontalPull',
      unilateral: true, targetSets: 3, targetReps: 12,
      sets: Array.from({ length: 3 }, () => ({ reps: 12, weight: 50, rpe: null })),
    }],
  }];

  const s = suggestFor({
    exercise: row, location: 'Work', sessionHistory: history,
    target: { sets: 3, reps: 12, repFloor: 10, repCeiling: 15 },
    entry: { exerciseId: 'one-arm-dumbbell-row', variationGroup: 'single-arm-row', pattern: 'horizontalPull' },
  });
  assert(s.weight === 50, `the suggestion must stay 50 lb per hand — not 100, not 25 — got ${s.weight}`);
  assert(s.reps === 13, `and progress reps per side, got ${s.reps}`);
  console.log(`  logged 50 lb × 12 per side -> suggested ${s.weight} lb × ${s.reps} per side`);
}

// --- 4. volume counts both sides, and says so ------------------------------
console.log('\n=== total work counts both sides ===');
{
  // Same numbers, one bilateral lift and one per-side lift.
  const perSide = [{ exerciseId: 'bulgarian-split-squat', name: 'Bulgarian Split Squat', reps: 10, weight: 50 }];
  const bilateral = [{ exerciseId: 'goblet-squat', name: 'Goblet Squat', reps: 10, weight: 50 }];

  assert(totalVolume(bilateral, library) === 500, `bilateral volume should be 500, got ${totalVolume(bilateral, library)}`);
  assert(totalVolume(perSide, library) === 1000, `per-side volume should count both sides (1000), got ${totalVolume(perSide, library)}`);

  const session = (id, exerciseId) => ({
    id, type: 'Lift', location: 'Home', date: '2026-09-15',
    exercises: [{
      exerciseId, name: exerciseId, sets: [{ reps: 10, weight: 50 }],
    }],
  });
  const uni = muscleVolume([session('a', 'bulgarian-split-squat')], library, { reference: new Date('2026-09-16T12:00:00') });
  const bil = muscleVolume([session('b', 'goblet-squat')], library, { reference: new Date('2026-09-16T12:00:00') });
  const total = (rows) => rows.reduce((n, r) => n + r.volume, 0);
  assert(total(uni) === 1000, `muscle volume must double a per-side lift, got ${total(uni)}`);
  assert(total(bil) === 500, `and leave a bilateral one alone, got ${total(bil)}`);
  // Set counts are NOT doubled: one set is one set.
  assert(
    uni.reduce((n, r) => n + r.sets, 0) === bil.reduce((n, r) => n + r.sets, 0),
    'set counts must not be doubled — only load-volume is',
  );
  console.log('  per-side lifts contribute both sides of tonnage; set counts are untouched');
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
