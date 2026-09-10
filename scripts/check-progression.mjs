// Progressive overload checks. Pure logic, no storage and no DOM.
// Run with `npm run check:progression`.

import {
  assessLastSession,
  suggestFor,
  lastPerformanceAt,
  roundToStep,
  snapDownToStep,
  fitToEquipment,
  loadLimitsFor,
} from '../src/lib/progression.js';
import { seedExerciseLibrary } from '../src/lib/exercises.js';

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`  ASSERT FAILED: ${msg}`);
    failures++;
  }
};

const byId = (id) => seedExerciseLibrary.find((e) => e.id === id);
const sets = (...pairs) => pairs.map(([reps, weight]) => ({ reps, weight, rpe: null }));

// A logged lift session, in the shape Run.jsx writes.
function session({ date, location = 'Work', exercises }) {
  return { id: date, type: 'Lift', date, location, exercises };
}
function logged({ id, name = id, group, pattern, targetSets, targetReps, done }) {
  return {
    exerciseId: id,
    name,
    variationGroup: group,
    pattern,
    targetSets,
    targetReps,
    sets: done,
  };
}

// --- 1. weight arithmetic lands on weights that exist --------------------
console.log('=== weights the equipment can actually make ===');
{
  // 2.5 lb steps and floating point are a classic mismatch.
  assert(roundToStep(51.3, 2.5) === 52.5, `51.3 -> ${roundToStep(51.3, 2.5)}`);
  assert(roundToStep(50.1, 2.5) === 50, `50.1 -> ${roundToStep(50.1, 2.5)}`);
  assert(roundToStep(47.5, 2.5) === 47.5, 'an exact step must pass through unchanged');
  assert(snapDownToStep(53.9, 2.5) === 52.5, `snap down 53.9 -> ${snapDownToStep(53.9, 2.5)}`);

  // No stray floating point in anything we would display.
  for (let w = 0; w <= 100; w += 0.1) {
    const r = roundToStep(w, 2.5);
    assert(Number.isInteger(r * 10), `roundToStep produced a non-representable weight: ${r}`);
  }
  console.log('  2.5 and 5 lb steps round cleanly, no floating-point dust');

  // Home ceilings hold.
  const homeDb = loadLimitsFor(byId('db-bench-press') ?? { equipment: ['dumbbells'] }, 'Home');
  assert(homeDb.cap === 52.5, `Home dumbbell cap should be 52.5, got ${homeDb.cap}`);
  assert(homeDb.step === 2.5, `Home dumbbell step should be 2.5, got ${homeDb.step}`);

  const capped = fitToEquipment(60, { step: 2.5, cap: 52.5 });
  assert(capped.weight === 52.5, `must not exceed the cap, got ${capped.weight}`);
  assert(capped.capped === true, 'hitting the ceiling must be reported');

  const uncapped = fitToEquipment(185, { step: 5, cap: null });
  assert(uncapped.weight === 185 && !uncapped.capped, 'Work has no ceiling to hit');
  console.log('  Home caps at 52.5 / 80 hold; Work is uncapped');
}

// --- 2. reading the last session, WITHOUT RPE ----------------------------
// This is the decision worth reviewing: no RPE is ever logged today, so
// "room to spare" is inferred from the reps against what was prescribed.
console.log('\n=== assessing a session with no RPE ===');
{
  const hitEverything = assessLastSession({
    sets: sets([10, 100], [10, 100], [10, 100]),
    targetSets: 3,
    targetReps: 10,
  });
  assert(hitEverything.verdict === 'progress', `all sets met -> ${hitEverything.verdict}`);

  const justShort = assessLastSession({
    sets: sets([10, 100], [10, 100], [9, 100]),
    targetSets: 3,
    targetReps: 10,
  });
  assert(justShort.verdict === 'hold', `one rep short -> ${justShort.verdict}`);

  // Volume well below target is a miss, not a near miss.
  const missed = assessLastSession({
    sets: sets([8, 100], [6, 100], [5, 100]),
    targetSets: 3,
    targetReps: 10,
  });
  assert(missed.verdict === 'deload', `19 of 30 reps -> ${missed.verdict}`);

  // The fade signal: respectable total, obvious grind.
  const faded = assessLastSession({
    sets: sets([12, 100], [11, 100], [5, 100]),
    targetSets: 3,
    targetReps: 10,
  });
  assert(faded.verdict === 'deload', `12/11/5 should read as a grind, got ${faded.verdict}`);
  assert(/faded/i.test(faded.reason), `the reason must name the fade: ${faded.reason}`);
  console.log('  met -> progress, short -> hold, missed or faded -> back off');

  // RPE, when it exists, leads.
  const easy = assessLastSession({
    sets: [{ reps: 5, weight: 100, rpe: 6 }],
    targetSets: 3,
    targetReps: 10,
  });
  assert(easy.verdict === 'progress', 'a low logged RPE must win over the rep count');
  const hard = assessLastSession({
    sets: [{ reps: 10, weight: 100, rpe: 9.5 }],
    targetSets: 3,
    targetReps: 10,
  });
  assert(hard.verdict === 'deload', 'a high logged RPE must win over the rep count');
  console.log('  logged RPE, when present, overrides the rep inference');

  // Pre-feature sessions carry no target. Hold rather than invent a yardstick.
  const noTarget = assessLastSession({
    sets: sets([10, 100], [10, 100]),
    targetSets: null,
    targetReps: null,
  });
  assert(noTarget.verdict === 'hold', `no recorded target -> ${noTarget.verdict}`);
  assert(/without its target/i.test(noTarget.reason), `and must say so: ${noTarget.reason}`);
  console.log('  a session logged before this feature holds, and says why');
}

// --- 3. Work and Home are separate ledgers -------------------------------
console.log('\n=== location is not shared ===');
{
  const history = [
    session({
      date: '2026-08-10',
      location: 'Home',
      exercises: [logged({ id: 'db-bench-press', targetSets: 3, targetReps: 10, done: sets([10, 50]) })],
    }),
    session({
      date: '2026-08-03',
      location: 'Work',
      exercises: [logged({ id: 'db-bench-press', targetSets: 3, targetReps: 10, done: sets([10, 80]) })],
    }),
  ];

  const atHome = lastPerformanceAt(history, 'db-bench-press', 'Home');
  const atWork = lastPerformanceAt(history, 'db-bench-press', 'Work');
  assert(atHome.topSet.weight === 50, `Home must read the Home session, got ${atHome.topSet.weight}`);
  assert(atWork.topSet.weight === 80, `Work must read the Work session, got ${atWork.topSet.weight}`);
  assert(
    atWork.date === '2026-08-03',
    'the newest HOME session must not shadow the Work one just because it is newer',
  );
  console.log('  a Home 50 and a Work 80 stay independent');
}

// --- 4. the Home ceiling changes the shape of progression ----------------
console.log('\n=== capped out at Home ===');
{
  const exercise = { id: 'x', equipment: ['dumbbells'] };
  const entry = { exerciseId: 'x', variationGroup: 'g', pattern: 'horizontalPush' };
  const target = { sets: 3, reps: 10, repFloor: 10, repCeiling: 12 };

  // Already at the 52.5 ceiling with rep room: reps move, load stays.
  const history = [
    session({
      date: '2026-08-10',
      location: 'Home',
      exercises: [logged({ id: 'x', targetSets: 3, targetReps: 10, done: sets([10, 52.5], [10, 52.5], [10, 52.5]) })],
    }),
  ];

  const s = suggestFor({ exercise, location: 'Home', sessionHistory: history, target, entry });
  assert(s.weight <= 52.5, `must never suggest above the cap, got ${s.weight}`);
  assert(s.weight === 52.5, `should sit at the cap, got ${s.weight}`);
  assert(s.reps === 11, `should add a rep instead of weight, got ${s.reps}`);
  assert(/ceiling/i.test(s.note), `the note must explain why: ${s.note}`);
  console.log('  at the cap with room to spare, reps move instead of load');

  // At the cap AND with the top of the range held long enough to earn a
  // weight step the equipment cannot give: the movement has to change.
  const toppedHistory = ['2026-08-10', '2026-08-03'].map((date) =>
    session({
      date,
      location: 'Home',
      exercises: [logged({ id: 'x', targetSets: 3, targetReps: 12, done: sets([12, 52.5], [12, 52.5], [12, 52.5]) })],
    }),
  );
  const topped = suggestFor({
    exercise,
    location: 'Home',
    sessionHistory: toppedHistory,
    target: { sets: 3, reps: 12, repFloor: 10, repCeiling: 12 },
    entry,
  });
  assert(topped.atRepCeiling === true, 'must report having run out of room');
  assert(topped.weight === 52.5, `must stay at the cap, got ${topped.weight}`);
  assert(/harder variation/i.test(topped.note), `must point at the way out: ${topped.note}`);
  console.log('  at the cap and the rep ceiling, it says to change the movement');

  // The same earned step at Work actually happens — one increment, reps back
  // to the floor of the range.
  const workHistory = ['2026-08-10', '2026-08-03'].map((date) =>
    session({
      date,
      location: 'Work',
      exercises: [logged({ id: 'x', targetSets: 3, targetReps: 12, done: sets([12, 52.5], [12, 52.5], [12, 52.5]) })],
    }),
  );
  const atWork = suggestFor({
    exercise,
    location: 'Work',
    sessionHistory: workHistory,
    target: { sets: 3, reps: 12, repFloor: 10, repCeiling: 12 },
    entry,
  });
  // 52.5 came from Home's 2.5 lb grid; on Work's 5 lb grid one step means
  // snap down to 50, then +5 — rounding must never stretch the increment.
  assert(atWork.weight === 55, `Work should add at most one 5 lb step, got ${atWork.weight}`);
  assert(atWork.reps === 10, `and drop reps back to the floor, got ${atWork.reps}`);
  console.log('  the same lift at Work takes its earned one-step increase');
}

// --- 5. the direction of travel ------------------------------------------
// Reps-first: a clean session adds a rep, the top of the range has to be
// HELD across sessions before one small weight step, and nothing ever jumps.
console.log('\n=== reps first, weight second ===');
{
  const exercise = { id: 'bb', equipment: ['barbell'] };
  const entry = { exerciseId: 'bb', variationGroup: 'g', pattern: 'squat' };
  const target = { sets: 3, reps: 12, repFloor: 10, repCeiling: 15 };
  const day = (date, done, targetReps) =>
    session({
      date,
      location: 'Work',
      exercises: [logged({ id: 'bb', targetSets: 3, targetReps, done })],
    });
  const suggest = (history, t = target) =>
    suggestFor({ exercise, location: 'Work', sessionHistory: history, target: t, entry });

  // Clean session inside the range: same weight, one more rep.
  const up = suggest([day('2026-08-10', sets([12, 135], [12, 135], [12, 135]), 12)]);
  assert(up.weight === 135, `a clean session must NOT add weight, got ${up.weight}`);
  assert(up.reps === 13, `it adds a rep instead, got ${up.reps}`);
  assert(/13 reps/.test(up.note), `and says so: ${up.note}`);

  // First time at the top of the range: hold and bank it.
  const banked = suggest([day('2026-08-10', sets([15, 135], [15, 135], [15, 135]), 15)]);
  assert(banked.weight === 135, `one session at the top must not move the weight, got ${banked.weight}`);
  assert(banked.reps === 15, `reps stay at the ceiling, got ${banked.reps}`);
  assert(/once more/i.test(banked.note), `and the note says what is coming: ${banked.note}`);

  // Top of the range held across back-to-back sessions: ONE step, reps reset.
  const heldTop = [
    day('2026-08-10', sets([15, 135], [15, 135], [15, 135]), 15),
    day('2026-08-03', sets([15, 135], [15, 135], [15, 135]), 15),
  ];
  const stepped = suggest(heldTop);
  assert(stepped.weight === 140, `two sessions at the top earn one 5 lb step, got ${stepped.weight}`);
  assert(stepped.reps === 10, `and reps restart at the floor, got ${stepped.reps}`);
  assert(/\+5 lb/.test(stepped.note), `and say so: ${stepped.note}`);

  // A longer streak earns exactly the same single step — never a jump.
  const longer = suggest([...heldTop, day('2026-07-27', sets([15, 135], [15, 135], [15, 135]), 15)]);
  assert(longer.weight === 140, `a longer streak must still add only one step, got ${longer.weight}`);

  const held = suggest([day('2026-08-10', sets([12, 135], [12, 135], [11, 135]), 12)]);
  assert(held.weight === 135 && held.reps === 12, `a near miss should hold, got ${held.weight} × ${held.reps}`);
  assert(/same as last time/i.test(held.note), `and say so: ${held.note}`);

  const down = suggest([day('2026-08-10', sets([8, 135], [7, 135], [6, 135]), 12)]);
  assert(down.weight < 135, `a missed session should come down, got ${down.weight}`);
  assert(down.weight === 120, `10% off 135, snapped to 5 lb, got ${down.weight}`);
  console.log('  +1 rep clean, bank the top, one step after holding it, back off on a miss');

  // Migration from the old heavy philosophy: a 5-rep weight is pulled into
  // today's 10–15 range with the load converted down, clamped to ±15%.
  const oldHeavy = suggest([day('2026-08-10', sets([5, 185], [5, 185], [5, 185]), 5)]);
  assert(oldHeavy.weight === 160, `a 5-rep 185 should settle to ~160 for 10s, got ${oldHeavy.weight}`);
  assert(oldHeavy.reps === 10, `and enter at the floor of the range, got ${oldHeavy.reps}`);
  assert(/not 5/.test(oldHeavy.note), `and explain the conversion: ${oldHeavy.note}`);

  // ...and the conversion is clamped, so extreme old data cannot swing it.
  const clamped = suggest([day('2026-08-10', sets([30, 100], [30, 100], [30, 100]), 30)]);
  assert(clamped.weight === 115, `a 30-rep 100 clamps to +15%, got ${clamped.weight}`);
  assert(clamped.reps === 15, `pulled down to the range ceiling, got ${clamped.reps}`);
  console.log('  old low-rep weights settle into the range, clamped to ±15%');
}

// --- 6. nothing logged yet ------------------------------------------------
console.log('\n=== no history ===');
{
  const entry = { exerciseId: 'new', variationGroup: 'press', pattern: 'horizontalPush' };

  // Nothing at all: it asks rather than inventing a number. Suggesting an
  // absolute starting load for a stranger is the one place here where being
  // wrong is a safety question, not a UX one.
  const blank = suggestFor({
    exercise: { id: 'new', equipment: ['barbell'] },
    location: 'Work',
    sessionHistory: [],
    target: { sets: 3, reps: 10, repCeiling: 12 },
    entry,
  });
  assert(blank.weight === null, `must not invent a starting weight, got ${blank.weight}`);
  assert(/2 reps short/i.test(blank.note), `must give usable guidance instead: ${blank.note}`);

  // Something in the same movement family: seed from it, conservatively.
  const history = [
    session({
      date: '2026-08-10',
      location: 'Work',
      exercises: [
        {
          exerciseId: 'other',
          name: 'Flat DB Press',
          variationGroup: 'press',
          pattern: 'horizontalPush',
          targetSets: 3,
          targetReps: 10,
          sets: sets([10, 100]),
        },
      ],
    }),
  ];
  const seeded = suggestFor({
    exercise: { id: 'new', equipment: ['barbell'] },
    location: 'Work',
    sessionHistory: history,
    target: { sets: 3, reps: 10, repCeiling: 12 },
    entry,
  });
  assert(seeded.weight === 90, `same group at 90% of 100, got ${seeded.weight}`);
  assert(/Flat DB Press/.test(seeded.note), `must name where it came from: ${seeded.note}`);
  console.log('  seeds from a related lift when there is one, asks when there is not');

  // Bodyweight movements progress by reps, never by load.
  const bw = suggestFor({
    exercise: { id: 'deadbug', equipment: ['bodyweight'] },
    location: 'Home',
    sessionHistory: [],
    target: { sets: 3, reps: 12, repCeiling: 15 },
    entry: { exerciseId: 'deadbug', pattern: 'core' },
  });
  assert(bw.weight === null, 'a bodyweight movement must never get a weight suggestion');
  console.log('  bodyweight movements get no weight suggestion at all');

  // Timed work is left alone entirely.
  const timed = suggestFor({
    exercise: { id: 'carry', equipment: ['dumbbells'] },
    location: 'Home',
    sessionHistory: [],
    target: { sets: 3, reps: null, seconds: 40 },
    entry: { exerciseId: 'carry', pattern: 'carry' },
  });
  assert(timed.source === 'timed' && timed.weight === null, 'timed work is out of scope');
  console.log('  timed work (planks, carries) is left alone');
}

// --- 7. the whole thing, through the real generator ----------------------
console.log('\n=== end to end through generateLiftSession ===');
{
  const { generateLiftSession } = await import('../src/lib/liftGenerator.js');

  const first = generateLiftSession({
    location: 'Home',
    band: 'Yellow',
    library: seedExerciseLibrary,
    sessionHistory: [],
    exerciseCount: 6,
    seed: 7,
  });
  assert(first.exercises.length > 0, 'the generator must still produce a session');
  for (const ex of first.exercises) {
    assert(ex.suggestion != null, `${ex.name} has no suggestion attached`);
  }
  console.log(`  every one of ${first.exercises.length} exercises carries a suggestion`);

  // Feed the generated session back as history, all reps completed. Under
  // reps-first progression the weight holds (reps climb instead) — but it
  // must never drop, and never breach a Home cap.
  const performed = session({
    date: '2026-08-10',
    location: 'Home',
    exercises: first.exercises.map((ex) => ({
      exerciseId: ex.exerciseId,
      name: ex.name,
      variationGroup: ex.variationGroup,
      pattern: ex.pattern,
      targetSets: ex.sets,
      targetReps: ex.reps,
      sets: Array.from({ length: ex.sets ?? 3 }, () => ({
        reps: ex.reps ?? 10,
        weight: 30,
        rpe: null,
      })),
    })),
  });

  const second = generateLiftSession({
    location: 'Home',
    band: 'Yellow',
    library: seedExerciseLibrary,
    sessionHistory: [performed],
    exerciseCount: 6,
    seed: 7,
  });

  // Only compare lifts that appear in both, since freshness rotates the rest.
  let compared = 0;
  for (const ex of second.exercises) {
    const before = first.exercises.find((e) => e.exerciseId === ex.exerciseId);
    if (!before || ex.suggestion?.weight == null || ex.seconds != null) continue;
    compared++;
    assert(
      ex.suggestion.weight >= 30,
      `${ex.name}: after a clean session at 30 lb the suggestion should not drop (${ex.suggestion.weight})`,
    );
    assert(
      ex.suggestion.weight <= 52.5,
      `${ex.name}: Home suggestion of ${ex.suggestion.weight} exceeds the 52.5 cap`,
    );
  }
  console.log(`  ${compared} repeated lift(s) progressed and stayed under the Home cap`);

  // Nothing above a cap, anywhere, for any band, at Home.
  for (const band of ['Green', 'Yellow', 'Orange']) {
    for (let seed = 1; seed <= 40; seed++) {
      const s = generateLiftSession({
        location: 'Home',
        band,
        library: seedExerciseLibrary,
        sessionHistory: [performed],
        exerciseCount: 6,
        seed,
      });
      for (const ex of s.exercises) {
        const w = ex.suggestion?.weight;
        if (w == null) continue;
        assert(w <= 80, `${band}/${seed}: ${ex.name} suggested ${w} lb, above every Home cap`);
        assert(Number.isInteger(w * 10), `${band}/${seed}: ${ex.name} suggested ${w}, not loadable`);
      }
    }
  }
  console.log('  120 generated Home sessions: no suggestion above a cap, none unloadable');
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
