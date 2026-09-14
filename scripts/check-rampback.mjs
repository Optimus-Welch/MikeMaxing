// Returning-from-a-break checks: detection from history, the reduction maths,
// and — the part worth being paranoid about — that ramp-back sessions leave
// normal progression exactly where it was. Run with `npm run check:rampback`.

import { seedExerciseLibrary } from '../src/lib/exercises.js';
import { rampBackStatus, rampBackWeightFactor, RAMP_BACK } from '../src/lib/rampBack.js';
import { generateLiftSession } from '../src/lib/liftGenerator.js';
import { suggestFor, lastPerformanceAt, fitToEquipment } from '../src/lib/progression.js';

const library = seedExerciseLibrary;
let failures = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`  ASSERT FAILED: ${msg}`);
    failures++;
  }
};

const TODAY = '2026-09-14';
const lift = (date, extra = {}) => ({ id: date, type: 'Lift', date, location: 'Work', exercises: [], ...extra });
const cardio = (date) => ({ id: `c-${date}`, type: 'Cardio', date });
const rest = (date) => ({ id: `r-${date}`, type: 'Rest', date });

// --- 1. detection ---------------------------------------------------------
console.log('=== break detection ===');
{
  // 13 days since the last session: break, first ramp-back session.
  let s = rampBackStatus({ sessionHistory: [lift('2026-09-01')], today: TODAY });
  assert(s?.sessionNumber === 1 && s.gapDays === 13, `13-day gap should offer session 1, got ${JSON.stringify(s)}`);
  assert(s.lastActiveDate === '2026-09-01', 'the break is keyed by the last active date');

  // 8 days is not a break.
  s = rampBackStatus({ sessionHistory: [lift('2026-09-06')], today: TODAY });
  assert(s === null, `an 8-day gap must not trigger, got ${JSON.stringify(s)}`);

  // One lift already done since a 23-day gap: today is session 2 of 2.
  s = rampBackStatus({ sessionHistory: [lift('2026-09-12'), lift('2026-08-20')], today: TODAY });
  assert(s?.sessionNumber === 2 && s.gapDays === 23, `should be session 2, got ${JSON.stringify(s)}`);

  // Two lifts done since the gap: the window is over.
  s = rampBackStatus({
    sessionHistory: [lift('2026-09-13'), lift('2026-09-11'), lift('2026-08-20')],
    today: TODAY,
  });
  assert(s === null, `after 2 post-break lifts the offer must expire, got ${JSON.stringify(s)}`);

  // A cardio session ends the break but does not consume a lift slot.
  s = rampBackStatus({ sessionHistory: [cardio('2026-09-13'), lift('2026-08-25')], today: TODAY });
  assert(s?.sessionNumber === 1 && s.lastActiveDate === '2026-08-25',
    `cardio ends the break without using a ramp-back session, got ${JSON.stringify(s)}`);

  // A logged Rest day is not training and does not reset the clock.
  s = rampBackStatus({ sessionHistory: [rest('2026-09-13'), lift('2026-08-25')], today: TODAY });
  assert(s?.gapDays === 20, `Rest sessions must not hide a break, got ${JSON.stringify(s)}`);

  // No history at all: nothing to have detrained from.
  assert(rampBackStatus({ sessionHistory: [], today: TODAY }) === null, 'empty history must not trigger');
  assert(rampBackStatus({ sessionHistory: [lift('2026-08-01')], today: TODAY, sessions: 0 }) === null,
    'sessions=0 disables the feature');

  // A configurable, longer ramp-back window.
  s = rampBackStatus({
    sessionHistory: [lift('2026-09-12'), lift('2026-09-10'), lift('2026-08-15')],
    today: TODAY,
    sessions: 3,
  });
  assert(s?.sessionNumber === 3 && s.sessionsTotal === 3, `3-session config, got ${JSON.stringify(s)}`);
  console.log('  gaps, expiry, cardio/Rest handling and the session count all behave');
}

// --- 2. the reduction maths -----------------------------------------------
console.log('\n=== weight factors ===');
{
  assert(rampBackWeightFactor(1, 2) === 0.9, `s1/2 should be 0.90, got ${rampBackWeightFactor(1, 2)}`);
  assert(rampBackWeightFactor(2, 2) === 0.95, `s2/2 should be 0.95, got ${rampBackWeightFactor(2, 2)}`);
  assert(rampBackWeightFactor(1, 3) === 0.85, `s1/3 should be 0.85, got ${rampBackWeightFactor(1, 3)}`);
  assert(rampBackWeightFactor(3, 3) === 0.95, `s3/3 should be 0.95, got ${rampBackWeightFactor(3, 3)}`);
  assert(rampBackWeightFactor(1, 6) === RAMP_BACK.minWeightFactor,
    'a long ramp-back must clamp at the floor, never approach zero');
  console.log('  90%/95% by default, clamped at 85%');
}

// --- 3. through the generator ---------------------------------------------
console.log('\n=== generation under ramp-back ===');
{
  // History so suggestions carry real weights (as check-progression does).
  const first = generateLiftSession({ location: 'Home', band: 'Yellow', library, exerciseCount: 6, seed: 7 });
  const performed = {
    id: 'perf', type: 'Lift', location: 'Home', date: '2026-08-20',
    exercises: first.exercises.map((ex) => ({
      exerciseId: ex.exerciseId, name: ex.name, variationGroup: ex.variationGroup, pattern: ex.pattern,
      targetSets: ex.sets, targetReps: ex.reps,
      sets: Array.from({ length: ex.sets ?? 3 }, () => ({ reps: ex.reps ?? 10, weight: 30, rpe: null })),
    })),
  };

  const args = { location: 'Home', band: 'Yellow', library, sessionHistory: [performed], exerciseCount: 6, seed: 7 };
  const normal = generateLiftSession(args);
  const ramp = generateLiftSession({ ...args, rampBack: { sessionNumber: 1, sessionsTotal: 2, gapDays: 14 } });

  assert(ramp.rampBack?.sessionNumber === 1, 'the session must carry its ramp-back stamp');
  assert(normal.rampBack === null, 'normal generation must not');

  let weighted = 0;
  ramp.exercises.forEach((ex, i) => {
    const base = normal.exercises[i];
    assert(ex.exerciseId === base.exerciseId, 'ramp-back must not change exercise selection');
    assert(ex.sets === Math.max(RAMP_BACK.minSets, base.sets - 2),
      `${ex.name}: session 1 of 2 should drop 2 sets (floor ${RAMP_BACK.minSets}), got ${ex.sets} from ${base.sets}`);
    if (ex.seconds != null) return; // timed work: sets reduced, rest untouched

    assert(ex.reps === ex.repFloor, `${ex.name}: reps should sit at the range floor, got ${ex.reps}`);
    assert(/ramp-back/i.test(ex.suggestion.note ?? ''), `${ex.name}: note must explain the reduction`);
    if (base.suggestion.weight != null) {
      weighted++;
      const expected = fitToEquipment(base.suggestion.weight * 0.9, ex.suggestion.equipment ?? {}).weight;
      assert(ex.suggestion.weight === expected,
        `${ex.name}: expected ${expected} (90% of ${base.suggestion.weight}, fitted), got ${ex.suggestion.weight}`);
      assert(ex.suggestion.weight > 0, `${ex.name}: reduced, never to zero`);
      assert(Number.isInteger(ex.suggestion.weight * 10), `${ex.name}: ${ex.suggestion.weight} is not loadable`);
    }
  });
  assert(weighted > 0, 'expected at least one weight-bearing lift in the comparison');
  console.log(`  ${ramp.exercises.length} exercises: fewer sets, floor reps, ${weighted} weight(s) at 90%, all loadable`);

  // Determinism holds under ramp-back too.
  const again = generateLiftSession({ ...args, rampBack: { sessionNumber: 1, sessionsTotal: 2, gapDays: 14 } });
  assert(JSON.stringify(again) === JSON.stringify(ramp), 'same seed + ramp-back must be identical');
}

// --- 4. progression resumes where it left off ------------------------------
console.log('\n=== progression is untouched by ramp-back history ===');
{
  const exercise = { id: 'bb', equipment: ['barbell'] };
  const entry = { exerciseId: 'bb', variationGroup: 'g', pattern: 'squat' };
  const benchSets = (reps, weight, n = 4) => Array.from({ length: n }, () => ({ reps, weight, rpe: null }));

  const history = [
    // The ramp-back session, deliberately light, flagged.
    { id: 'rb', type: 'Lift', location: 'Work', date: '2026-09-12', rampBack: true,
      exercises: [{ exerciseId: 'bb', variationGroup: 'g', pattern: 'squat', targetSets: 2, targetReps: 10, sets: benchSets(10, 120, 2) }] },
    // The last real session before the break.
    { id: 'pre', type: 'Lift', location: 'Work', date: '2026-08-20',
      exercises: [{ exerciseId: 'bb', variationGroup: 'g', pattern: 'squat', targetSets: 4, targetReps: 13, sets: benchSets(13, 135) }] },
  ];

  const perf = lastPerformanceAt(history, 'bb', 'Work');
  assert(perf.topSet.weight === 135 && perf.targetReps === 13,
    `lastPerformanceAt must skip the flagged session, got ${JSON.stringify(perf?.topSet)}`);

  const s = suggestFor({
    exercise, location: 'Work', sessionHistory: history,
    target: { sets: 4, reps: 12, repFloor: 10, repCeiling: 15 }, entry,
  });
  assert(s.weight === 135, `should resume from the pre-break 135, not the ramp-back 120, got ${s.weight}`);
  assert(s.reps === 14, `and continue the rep walk from 13 to 14, got ${s.reps}`);
  console.log(`  after the break: ${s.weight} × ${s.reps} — the pre-break walk continues`);
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
