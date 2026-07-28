// Exercises the generator across bands, locations and consecutive sessions.
// Not a unit-test framework — just a fast way to eyeball real output and to
// assert the invariants that matter. Run with `npm run check:generator`.

import { seedExerciseLibrary } from '../src/lib/exercises.js';
import {
  generateLiftSession,
  swapExercise,
  recentVariationGroups,
} from '../src/lib/liftGenerator.js';

const library = seedExerciseLibrary;
let failures = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error(`  ASSERT FAILED: ${msg}`);
    failures++;
  }
}

function show(session) {
  console.log(`  [${session.templateName}] ${session.location} / ${session.band} — ${session.intensityLabel}`);
  for (const ex of session.exercises) {
    const flags = [
      ex.capStrategy ? `cap:${ex.capStrategy}` : null,
      ex.repeatedGroup ? 'REPEAT' : null,
      ex.supersetWith ? `+${ex.supersetWith}` : null,
    ]
      .filter(Boolean)
      .join(' ');
    console.log(
      `    ${ex.patternLabel.padEnd(20)} ${ex.name.padEnd(42)} ${ex.prescription.padEnd(16)} ${flags}`,
    );
  }
  if (session.skipped.length) {
    for (const s of session.skipped) console.log(`    SKIPPED ${s.pattern}: ${s.reason}`);
  }
}

// --- 1. every band x location produces a sane session ---------------------
console.log('\n=== bands x locations ===');
for (const location of ['Work', 'Home']) {
  for (const band of ['Green', 'Yellow', 'Orange']) {
    const s = generateLiftSession({ location, band, library, seed: 42 });
    console.log();
    show(s);

    assert(s.exercises.length > 0, `${location}/${band}: produced no exercises`);
    assert(
      s.exercises.length === new Set(s.exercises.map((e) => e.exerciseId)).size,
      `${location}/${band}: duplicate exercise in one session`,
    );
    assert(
      s.exercises.length === new Set(s.exercises.map((e) => e.variationGroup)).size,
      `${location}/${band}: duplicate variationGroup in one session`,
    );
    // Orange must be lower volume than Green.
    if (band === 'Orange') {
      assert(s.exercises.length <= 4, `Orange should trim to <=4 slots, got ${s.exercises.length}`);
    }

    // A primary slot should not be filled by an isolation movement when a
    // real compound is available for that pattern at this location.
    for (const ex of s.exercises) {
      if (ex.emphasis !== 'primary') continue;
      const full = library.find((l) => l.id === ex.exerciseId);
      assert(
        full.tier !== 'accessory',
        `${location}/${band}: accessory "${ex.name}" used in a primary slot`,
      );
    }

    // Drop sets need external load to drop.
    for (const ex of s.exercises) {
      const full = library.find((l) => l.id === ex.exerciseId);
      const loaded = full.equipment.some((t) =>
        ['dumbbells', 'barbell', 'machine', 'cable'].includes(t),
      );
      assert(
        !(ex.schemeId === 'dropSet' && !loaded),
        `${location}/${band}: drop set prescribed on bodyweight "${ex.name}"`,
      );
    }

    // Never print two contradictory tempos for one movement.
    for (const ex of s.exercises) {
      const full = library.find((l) => l.id === ex.exerciseId);
      assert(
        !(full.capStrategy === 'tempo' && ex.schemeId === 'tempo'),
        `${location}/${band}: "${ex.name}" got a tempo scheme on top of its own tempo`,
      );
    }
  }
}

// --- 2. Home cap-sensitive patterns prefer cap-friendly options ------------
console.log('\n=== Home cap-awareness (30 seeds) ===');
const capSensitive = ['squat', 'hinge', 'unilateral'];
let capChecked = 0;
let capFriendlyCount = 0;
for (let seed = 1; seed <= 30; seed++) {
  for (const band of ['Green', 'Yellow']) {
    const s = generateLiftSession({ location: 'Home', band, library, seed });
    for (const ex of s.exercises) {
      if (!capSensitive.includes(ex.pattern)) continue;
      capChecked++;
      const full = library.find((l) => l.id === ex.exerciseId);
      if (full.capFriendly) capFriendlyCount++;
      else console.log(`    non-cap-friendly at Home: ${ex.name} (${ex.pattern})`);
    }
  }
}
console.log(`  ${capFriendlyCount}/${capChecked} cap-sensitive picks were capFriendly`);
assert(
  capFriendlyCount === capChecked,
  'every Home pick on a cap-sensitive pattern should be capFriendly',
);

// --- 2b. scheme sanity across many seeds ----------------------------------
console.log('\n=== scheme sanity sweep (200 sessions) ===');
const schemeCounts = {};
let sweptExercises = 0;
for (let seed = 1; seed <= 100; seed++) {
  for (const location of ['Work', 'Home']) {
    const s = generateLiftSession({ location, band: 'Yellow', library, seed });
    for (const ex of s.exercises) {
      sweptExercises++;
      schemeCounts[ex.schemeId] = (schemeCounts[ex.schemeId] ?? 0) + 1;
      const full = library.find((l) => l.id === ex.exerciseId);
      const loaded = full.equipment.some((t) =>
        ['dumbbells', 'barbell', 'machine', 'cable'].includes(t),
      );
      assert(
        !(ex.schemeId === 'dropSet' && !loaded),
        `seed ${seed}/${location}: drop set on bodyweight "${ex.name}"`,
      );
      assert(
        !(full.capStrategy === 'tempo' && ex.schemeId === 'tempo'),
        `seed ${seed}/${location}: double tempo on "${ex.name}"`,
      );
      assert(
        !(ex.emphasis === 'primary' && full.tier === 'accessory'),
        `seed ${seed}/${location}: accessory "${ex.name}" in a primary slot`,
      );
    }
  }
}
console.log(`  ${sweptExercises} exercise slots checked`);
console.log(`  scheme mix: ${Object.entries(schemeCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
assert(Object.keys(schemeCounts).length >= 3, 'expected a mix of set/rep schemes, not just one');

// --- 3. A/B alternation over consecutive sessions -------------------------
console.log('\n=== A/B alternation + freshness over 4 sessions ===');
let history = [];
const templateIds = [];
for (let i = 0; i < 4; i++) {
  const s = generateLiftSession({
    location: 'Work',
    band: 'Yellow',
    library,
    sessionHistory: history,
    freshnessWindow: 3,
    seed: 100 + i,
  });
  templateIds.push(s.templateId);
  console.log();
  show(s);

  // Freshness: nothing in this session should reuse a group from the window.
  const recent = recentVariationGroups(history, 3);
  for (const ex of s.exercises) {
    if (ex.repeatedGroup) continue; // legitimately relaxed
    assert(
      !recent.has(ex.variationGroup),
      `session ${i}: ${ex.name} reuses group ${ex.variationGroup} inside the window`,
    );
  }

  history = [
    {
      id: `s${i}`,
      type: 'Lift',
      location: 'Work',
      date: `2026-07-${20 + i}`,
      templateId: s.templateId,
      exercises: s.exercises.map((e) => ({
        exerciseId: e.exerciseId,
        variationGroup: e.variationGroup,
        sets: [],
      })),
    },
    ...history,
  ];
}
console.log(`\n  template order: ${templateIds.join(' -> ')}`);
assert(
  templateIds.every((t, i) => i === 0 || t !== templateIds[i - 1]),
  'consecutive sessions must alternate templates',
);

// --- 4. swap actually changes the exercise --------------------------------
console.log('\n=== swap ===');
const base = generateLiftSession({ location: 'Work', band: 'Yellow', library, seed: 7 });
for (let i = 0; i < base.exercises.length; i++) {
  const swapped = swapExercise({ session: base, index: i, library, seed: 999 + i });
  const before = base.exercises[i];
  const after = swapped.exercises[i];
  console.log(`  slot ${i} (${before.patternLabel}): ${before.name} -> ${after.name}`);
  assert(after.exerciseId !== before.exerciseId, `swap at slot ${i} returned the same exercise`);
  assert(after.pattern === before.pattern, `swap at slot ${i} changed the movement pattern`);
  // Other slots untouched.
  for (let j = 0; j < base.exercises.length; j++) {
    if (j === i) continue;
    assert(
      swapped.exercises[j].exerciseId === base.exercises[j].exerciseId,
      `swap at slot ${i} disturbed slot ${j}`,
    );
  }
}

// --- 5. regenerate with a new seed gives a different session --------------
console.log('\n=== regenerate ===');
const a = generateLiftSession({ location: 'Work', band: 'Yellow', library, seed: 1 });
const b = generateLiftSession({ location: 'Work', band: 'Yellow', library, seed: 2 });
const sameIds = a.exercises.map((e) => e.exerciseId).join() === b.exercises.map((e) => e.exerciseId).join();
console.log(`  seed 1: ${a.exercises.map((e) => e.name).join(', ')}`);
console.log(`  seed 2: ${b.exercises.map((e) => e.name).join(', ')}`);
assert(!sameIds, 'different seeds should produce a different selection');

// determinism
const a2 = generateLiftSession({ location: 'Work', band: 'Yellow', library, seed: 1 });
assert(
  JSON.stringify(a) === JSON.stringify(a2),
  'same seed must produce an identical session (determinism)',
);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
