// Validates the block/step layer that run mode walks through.
// Run with `npm run check:blocks`.

import { seedExerciseLibrary } from '../src/lib/exercises.js';
import { generateLiftSession } from '../src/lib/liftGenerator.js';
import { buildBlocks, buildRunSteps } from '../src/lib/blocks.js';
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
  const session = generateLiftSession({ location: 'Work', band, library, seed: 21 });
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

  // Each block should contribute rounds x (items - trailing rest) steps.
  for (const block of blocks) {
    const mine = steps.filter((s) => s.blockId === block.id);
    const exerciseItems = block.items.filter((i) => i.kind !== 'rest').length;
    const restItems = block.items.filter((i) => i.kind === 'rest').length;
    const expected = block.rounds * exerciseItems + Math.max(0, block.rounds - 1) * restItems;
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
