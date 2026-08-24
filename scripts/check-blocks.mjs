// Validates the block/step layer that run mode walks through.
// Run with `npm run check:blocks`.

import { seedExerciseLibrary } from '../src/lib/exercises.js';
import { seedSettings } from '../src/lib/seed.js';
import { generateLiftSession } from '../src/lib/liftGenerator.js';
import { buildBlocks, buildRunSteps } from '../src/lib/blocks.js';
import { needsRamp, warmupRampFor } from '../src/lib/warmupRamp.js';
import { summariseSession, findRecords } from '../src/lib/sessionStats.js';

const library = seedExerciseLibrary;
let failures = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`  ASSERT FAILED: ${msg}`);
    failures++;
  }
};

console.log('=== block structure ===');
for (const band of ['Green', 'Yellow', 'Orange']) {
  const session = generateLiftSession({
    location: 'Work',
    band,
    library,
    exerciseCount: seedSettings.durationTargets[band].liftExercises,
    seed: 21,
  });
  const { blocks, estimatedMinutes } = buildBlocks(session);
  console.log(`\n${band} — ${estimatedMinutes} min est.`);
  for (const b of blocks) {
    const label = `${b.rounds > 1 ? `[${b.rounds}x] ` : ''}${b.name}${b.subtitle ? ` — ${b.subtitle}` : ''}`;
    console.log(`  ${label}`);
    for (const item of b.items) {
      const target =
        item.kind === 'rest'
          ? `${item.seconds}s`
          : (item.prescription ?? (item.seconds ? `${item.seconds}s` : `${item.reps} reps`));
      console.log(`      ${item.kind === 'rest' ? 'Rest' : item.name}  —  ${target}`);
    }
  }

  assert(blocks[0].id === 'warmup', `${band}: first block should be the warm up`);
  assert(blocks.at(-1).id === 'cooldown', `${band}: last block should be the cool down`);
  assert(
    blocks.some((b) => b.name === 'PRIMARY STRENGTH'),
    `${band}: expected a primary strength block`,
  );
  // Rest must be an explicit item wherever there is real work.
  for (const b of blocks) {
    if (b.id === 'warmup' || b.id === 'cooldown') continue;
    assert(
      b.items.some((i) => i.kind === 'rest'),
      `${band}: block ${b.id} has no explicit rest item`,
    );
  }
  // Every generated exercise must survive into a block.
  const inBlocks = new Set(
    blocks.flatMap((b) => b.items.filter((i) => i.kind === 'exercise').map((i) => i.exerciseId)),
  );
  for (const ex of session.exercises) {
    assert(inBlocks.has(ex.exerciseId), `${band}: ${ex.name} was dropped from the blocks`);
  }
}

console.log('\n=== run steps ===');
{
  const session = generateLiftSession({ location: 'Home', band: 'Yellow', library, seed: 8 });
  const { blocks } = buildBlocks(session);
  const steps = buildRunSteps(blocks);
  console.log(`  ${steps.length} steps from ${blocks.length} blocks`);

  assert(steps.length > 0, 'expected steps');
  assert(new Set(steps.map((s) => s.key)).size === steps.length, 'step keys must be unique');
  assert(steps.at(-1).kind !== 'rest', 'a session must not end on a rest step');

  // Each block should contribute rounds x (items - trailing rest) steps, plus
  // two steps (set + rest) per warm-up ramp set done before round 1.
  for (const block of blocks) {
    const mine = steps.filter((s) => s.blockId === block.id);
    const exerciseItems = block.items.filter((i) => i.kind !== 'rest').length;
    const restItems = block.items.filter((i) => i.kind === 'rest').length;
    const expected =
      2 * (block.rampItems?.length ?? 0) +
      block.rounds * exerciseItems +
      Math.max(0, block.rounds - 1) * restItems;
    assert(
      mine.length === expected,
      `block ${block.id}: expected ${expected} steps, got ${mine.length}`,
    );
  }

  // Rounds must be numbered within range.
  for (const s of steps) {
    assert(s.round >= 1 && s.round <= s.totalRounds, `step ${s.key} has round out of range`);
  }

  const sample = steps.slice(0, 8).map((s) => {
    const label = s.kind === 'rest' ? `Rest ${s.item.seconds}s` : s.item.name;
    return `    ${s.blockName} r${s.round}/${s.totalRounds}: ${label}`;
  });
  console.log(sample.join('\n'));
}

console.log('\n=== warm-up ramp ===');
{
  const entry = (over = {}) => ({
    exerciseId: 'x',
    name: 'X',
    emphasis: 'primary',
    tier: 'primary',
    seconds: null,
    suggestion: { weight: 190, equipment: { kind: 'barbellTotal', step: 5, cap: null } },
    ...over,
  });
  const inTenths = (w, step) => (w * 10) % (step * 10) === 0;

  // A heavy barbell lift gets the full three-set walk-up: ascending, loadable,
  // and every set strictly lighter than the working weight.
  const ramp = warmupRampFor(entry(), 'Work');
  console.log(`  190 lb barbell @ Work: ${ramp.map((s) => `${s.weight}×${s.reps}`).join(', ')}`);
  assert(ramp.length === 3, `expected 3 ramp sets, got ${ramp.length}`);
  ramp.forEach((s, i) => {
    assert(s.weight < 190, `ramp set ${i + 1} must be lighter than the working weight`);
    assert(inTenths(s.weight, 5), `ramp set ${i + 1} (${s.weight}) is not loadable in 5 lb steps`);
    assert(i === 0 || s.weight > ramp[i - 1].weight, `ramp must ascend`);
    assert(i === 0 || s.reps < ramp[i - 1].reps, `ramp reps must fall as load climbs`);
  });

  // Work barbell warm-ups never go below the 45 lb empty bar, and neighbours
  // that collapse into each other are dropped rather than duplicated.
  const light = warmupRampFor(entry({ suggestion: { ...entry().suggestion, weight: 65 } }), 'Work');
  console.log(`  65 lb barbell @ Work: ${light.map((s) => `${s.weight}×${s.reps}`).join(', ')}`);
  assert(light.length > 0 && light.length < 3, 'a light barbell lift should get a shortened ramp');
  assert(
    light.every((s) => s.weight >= 45 && s.weight < 65),
    'Work barbell ramp sets must sit between the empty bar and the working weight',
  );

  // Below the minimum worthwhile target there is no ramp at all.
  assert(
    warmupRampFor(entry({ suggestion: { ...entry().suggestion, weight: 55 } }), 'Work').length === 0,
    'a 55 lb barbell lift is below the ramp threshold',
  );

  // Dumbbells ramp only for primary-tier compounds; machines, timed work and
  // weightless suggestions never ramp.
  const db = (tier, weight, step = 5) =>
    entry({ tier, suggestion: { weight, equipment: { kind: 'dumbbellPerHand', step, cap: null } } });
  assert(needsRamp(db('primary', 50)), 'a heavy primary-tier dumbbell lift should ramp');
  assert(!needsRamp(db('secondary', 50)), 'secondary-tier dumbbell work must not ramp');
  assert(!needsRamp(db('primary', 25)), 'light dumbbell work is below the ramp threshold');
  assert(
    !needsRamp(entry({ suggestion: { weight: 120, equipment: { kind: 'machine', step: 10, cap: null } } })),
    'machines must not ramp',
  );
  assert(!needsRamp(entry({ seconds: 40 })), 'timed work must not ramp');
  assert(
    !needsRamp(entry({ suggestion: { weight: null, equipment: { kind: 'barbellTotal', step: 5, cap: null } } })),
    'no suggested weight means no ramp',
  );

  // Secondary-slot compounds get the shortened two-fraction ramp.
  const secondary = warmupRampFor(entry({ emphasis: 'secondary' }), 'Work');
  assert(secondary.length === 2, `secondary emphasis should ramp in 2 sets, got ${secondary.length}`);
  assert(secondary[0].fraction === 0.5, 'secondary ramp should start at 50%');

  // Home dumbbell ramps land on the 2.5 lb increments of the adjustables.
  const home = warmupRampFor(db('primary', 52.5, 2.5), 'Home');
  console.log(`  52.5 lb dumbbell @ Home: ${home.map((s) => `${s.weight}×${s.reps}`).join(', ')}`);
  assert(
    home.length > 0 && home.every((s) => inTenths(s.weight, 2.5)),
    'Home dumbbell ramp must land on 2.5 lb increments',
  );

  // Through the block/step layer: the ramp precedes round 1 of its own block,
  // each ramp set is followed by rest, and nothing about it is a work step.
  const session = {
    location: 'Work',
    band: 'Yellow',
    exercises: [
      {
        exerciseId: 'back-squat',
        name: 'Back Squat',
        pattern: 'squat',
        emphasis: 'primary',
        tier: 'primary',
        sets: 4,
        reps: 8,
        seconds: null,
        schemeId: 'straight',
        prescription: '4 × 8',
        suggestion: { weight: 190, equipment: { kind: 'barbellTotal', step: 5, cap: null } },
      },
      {
        exerciseId: 'goblet-squat',
        name: 'Goblet Squat',
        pattern: 'squat',
        emphasis: 'secondary',
        tier: 'secondary',
        sets: 3,
        reps: 10,
        seconds: null,
        schemeId: 'straight',
        prescription: '3 × 10',
        suggestion: { weight: 50, equipment: { kind: 'dumbbellPerHand', step: 5, cap: null } },
      },
    ],
  };
  const { blocks } = buildBlocks(session);
  const primary = blocks.find((b) => b.id === 'primary-0');
  assert(primary.rampItems.length === 3, 'primary block should carry its 3 ramp sets');
  const circuit = blocks.find((b) => b.id === 'accessory-0');
  assert((circuit.rampItems ?? []).length === 0, 'the goblet squat circuit must not ramp');

  const steps = buildRunSteps(blocks);
  assert(new Set(steps.map((s) => s.key)).size === steps.length, 'ramp step keys must be unique');
  const warmupSteps = steps.filter((s) => s.kind === 'warmup');
  assert(warmupSteps.length === 3, `expected 3 warm-up steps, got ${warmupSteps.length}`);
  const firstWork = steps.findIndex((s) => s.kind === 'exercise' && s.blockId === 'primary-0');
  for (const s of warmupSteps) {
    assert(steps.indexOf(s) < firstWork, 'every ramp set must precede the first working set');
    assert(steps[steps.indexOf(s) + 1].kind === 'rest', 'every ramp set must be followed by rest');
  }
}

console.log('\n=== finish stats ===');
{
  const history = [
    {
      id: 'old',
      type: 'Lift',
      date: '2026-07-01',
      exercises: [{ exerciseId: 'back-squat', name: 'Back Squat', sets: [{ reps: 5, weight: 185 }] }],
    },
  ];
  const performed = [
    { exerciseId: 'back-squat', name: 'Back Squat', reps: 5, weight: 205 },
    { exerciseId: 'back-squat', name: 'Back Squat', reps: 5, weight: 205 },
    { exerciseId: 'plank', name: 'Plank', reps: null, weight: null },
  ];
  const stats = summariseSession({ performed, library, history, sessionId: 'new' });
  console.log(`  volume: ${stats.volume} lb (expect 2050)`);
  console.log(`  sets: ${stats.workingSets}, exercises: ${stats.exerciseCount}`);
  console.log(`  records: ${JSON.stringify(stats.records)}`);
  console.log(`  top muscles: ${stats.muscles.slice(0, 4).map((m) => m.muscle).join(', ')}`);

  assert(stats.volume === 2050, `volume should be 2050, got ${stats.volume}`);
  assert(stats.records.length === 1 && stats.records[0].type === 'weight', 'expected a weight PR');
  assert(stats.muscles.length > 0, 'expected muscle breakdown');

  // A first-ever performance is not a record.
  const firstTime = findRecords(
    [{ exerciseId: 'front-squat', name: 'Front Squat', reps: 5, weight: 100 }],
    [],
    'new',
  );
  assert(firstTime.length === 0, 'a first-ever set must not count as a record');

  // Same weight, more reps => rep record.
  const repPR = findRecords(
    [{ exerciseId: 'back-squat', name: 'Back Squat', reps: 8, weight: 185 }],
    history,
    'new',
  );
  assert(repPR.length === 1 && repPR[0].type === 'reps', 'expected a rep record');
  console.log(`  rep-record case: ${JSON.stringify(repPR)}`);
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
