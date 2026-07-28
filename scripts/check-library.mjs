// Dev sanity check for the exercise library: validates tagging, then prints
// coverage per location so gaps (a pattern with no options somewhere) are
// obvious. Run with `npm run check:library`.

import {
  seedExerciseLibrary,
  validateLibrary,
  isAvailableAt,
  MOVEMENT_PATTERNS,
  PATTERN_LABELS,
} from '../src/lib/exercises.js';

const problems = validateLibrary();
if (problems.length) {
  console.error('Library problems:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}

console.log(`Library OK — ${seedExerciseLibrary.length} exercises\n`);

for (const location of ['Work', 'Home']) {
  const available = seedExerciseLibrary.filter((e) => isAvailableAt(e, location));
  console.log(`${location}: ${available.length} available`);

  for (const pattern of MOVEMENT_PATTERNS) {
    const forPattern = available.filter((e) => e.movementPattern === pattern);
    const groups = new Set(forPattern.map((e) => e.variationGroup));
    const capFriendly = forPattern.filter((e) => e.capFriendly).length;
    const flag = forPattern.length === 0 ? '  <-- NO OPTIONS' : groups.size < 2 ? '  <-- single group' : '';
    console.log(
      `  ${PATTERN_LABELS[pattern].padEnd(20)} ${String(forPattern.length).padStart(2)} exercises, ` +
        `${groups.size} group(s), ${capFriendly} cap-friendly${flag}`,
    );
  }
  console.log();
}
