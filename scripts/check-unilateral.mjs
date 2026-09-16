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
import { buildBlocks, buildRunSteps, SIDES } from '../src/lib/blocks.js';
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

// --- 4. the run flow walks both sides --------------------------------------
console.log('\n=== both sides are separate steps ===');
{
  const perSideEx = {
    exerciseId: 'bulgarian-split-squat', name: 'Bulgarian Split Squat',
    pattern: 'unilateral', emphasis: 'secondary', tier: 'primary', unilateral: true,
    sets: 3, reps: 10, seconds: null, schemeId: 'straight', prescription: '3 × 10 per side',
    suggestion: { weight: 40, equipment: { kind: 'dumbbellPerHand', step: 5, cap: 52.5 } },
  };
  const bilateralEx = {
    exerciseId: 'goblet-squat', name: 'Goblet Squat',
    pattern: 'squat', emphasis: 'secondary', tier: 'secondary', unilateral: false,
    sets: 3, reps: 10, seconds: null, schemeId: 'straight', prescription: '3 × 10',
    suggestion: { weight: 40, equipment: { kind: 'dumbbellPerHand', step: 5, cap: 52.5 } },
  };
  const { blocks } = buildBlocks({ location: 'Home', band: 'Yellow', exercises: [perSideEx, bilateralEx] });
  const steps = buildRunSteps(blocks);

  const sideSteps = steps.filter((s) => s.kind === 'exercise' && s.item.exerciseId === 'bulgarian-split-squat');
  const flatSteps = steps.filter((s) => s.kind === 'exercise' && s.item.exerciseId === 'goblet-squat');

  assert(sideSteps.length === 3 * SIDES.length, `3 rounds x 2 sides = 6 steps, got ${sideSteps.length}`);
  assert(flatSteps.length === 3, `a bilateral lift stays at 3 steps, got ${flatSteps.length}`);
  assert(flatSteps.every((s) => s.side == null), 'a bilateral step must carry no side');

  // Every round must contain each side exactly once, left before right, and
  // both sides must come before the rest that ends the round.
  for (let round = 1; round <= 3; round++) {
    const inRound = sideSteps.filter((s) => s.round === round);
    assert(inRound.length === SIDES.length, `round ${round}: expected both sides, got ${inRound.length}`);
    assert(
      inRound.map((s) => s.side).join() === SIDES.map((x) => x.id).join(),
      `round ${round}: sides must run ${SIDES.map((x) => x.id).join(' then ')}, got ${inRound.map((s) => s.side).join()}`,
    );
    for (const s of inRound) assert(!!s.sideLabel, `round ${round}: every side step needs a label`);
  }
  // The rest that ENDS round 1 — not a warm-up ramp rest, which precedes the
  // working sets entirely (this lift earns a ramp too).
  const roundRest = steps.findIndex((s) => s.kind === 'rest' && s.warmupIndex == null);
  const firstRoundSides = sideSteps.filter((s) => s.round === 1).map((s) => steps.indexOf(s));
  assert(
    firstRoundSides.every((i) => i < roundRest),
    'both sides are performed before the round rest, not either side of it',
  );
  assert(
    steps.filter((s) => s.kind === 'warmup').every((s) => s.side == null),
    'warm-up ramp sets are not split per side — they are prep, not working sets',
  );
  assert(new Set(steps.map((s) => s.key)).size === steps.length, 'side steps must keep keys unique');
  console.log(`  ${sideSteps.length} labelled side steps across 3 rounds, left then right, rest after the pair`);
}

// --- 5. volume counts every side performed, exactly once -------------------
console.log('\n=== total work counts every side once ===');
{
  // Logged the new way: one row per side, each carrying its side.
  const logged = [
    { exerciseId: 'bulgarian-split-squat', name: 'BSS', reps: 10, weight: 50, side: 'left' },
    { exerciseId: 'bulgarian-split-squat', name: 'BSS', reps: 10, weight: 50, side: 'right' },
  ];
  assert(totalVolume(logged, library) === 1000, `two logged sides = 1000, got ${totalVolume(logged, library)}`);

  // Logged the OLD way, before the split: one row standing for both sides.
  const legacy = [{ exerciseId: 'bulgarian-split-squat', name: 'BSS', reps: 10, weight: 50 }];
  assert(totalVolume(legacy, library) === 1000, `legacy per-side row still counts both sides, got ${totalVolume(legacy, library)}`);

  const bilateral = [{ exerciseId: 'goblet-squat', name: 'Goblet Squat', reps: 10, weight: 50 }];
  assert(totalVolume(bilateral, library) === 500, `bilateral volume should be 500, got ${totalVolume(bilateral, library)}`);

  const session = (id, exerciseId, sets) => ({
    id, type: 'Lift', location: 'Home', date: '2026-09-15',
    exercises: [{ exerciseId, name: exerciseId, sets }],
  });
  const ref = { reference: new Date('2026-09-16T12:00:00') };
  const total = (rows) => rows.reduce((n, r) => n + r.volume, 0);

  const split = muscleVolume([session('a', 'bulgarian-split-squat', [
    { reps: 10, weight: 50, side: 'left' }, { reps: 10, weight: 50, side: 'right' },
  ])], library, ref);
  const old = muscleVolume([session('b', 'bulgarian-split-squat', [{ reps: 10, weight: 50 }])], library, ref);
  const bil = muscleVolume([session('c', 'goblet-squat', [{ reps: 10, weight: 50 }])], library, ref);

  assert(total(split) === 1000, `per-side sets must not be double-counted, got ${total(split)}`);
  assert(total(old) === 1000, `legacy rows still count both sides, got ${total(old)}`);
  assert(total(bil) === 500, `a bilateral lift is untouched, got ${total(bil)}`);
  console.log('  both shapes of history agree on 1000 lb; a bilateral lift stays 500');
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
