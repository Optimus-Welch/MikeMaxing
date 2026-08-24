// Warm-up ramping for heavy compound lifts.
//
// The generator prescribes ONE working weight per exercise. Jumping straight
// to it is fine for a lateral raise; it is not fine for a heavy squat. This
// module builds the walk-up: a light high-rep set, then increasing fractions
// of the working weight at falling reps, so the first working set is the
// first HARD set rather than the first set.
//
// Same rules as everything else in this codebase: pure functions, decisions
// made from data the session entry already carries (equipment kind, tier,
// the progression suggestion), and every weight rounded to what the
// location's equipment can actually load.
//
// What gets a ramp — and what deliberately does not:
//   - barbell lifts        always (every barbell movement in the library is a
//                          heavy compound: squats, deadlifts, presses, rows)
//   - dumbbell lifts       only tier 'primary' (DB bench, DB overhead press,
//                          one-arm row, Bulgarian split squat). Secondary and
//                          accessory dumbbell work (goblet squats, flys,
//                          lateral raises) starts at the working weight.
//   - machines / cables    never — pin the stack and go
//   - bodyweight / timed   never — nothing to ramp
//   - no suggested weight  never — first time on a lift you are finding the
//                          weight, not ramping to it
//
// A ramp set is guidance, not work: it is never logged, never counts toward
// progression, and run mode treats it like prep, not like a set.

import { roundToStep } from './progression.js';

// Fractions of the WORKING weight (not a 1RM), reps falling as load climbs.
// Primary slots get the full three-set walk-up; secondary slots skip the
// lightest set — their loads are more modest and the session has to fit.
export const RAMP_SCHEME = [
  { fraction: 0.3, reps: 10 },
  { fraction: 0.5, reps: 6 },
  { fraction: 0.75, reps: 3 },
];
const SECONDARY_SCHEME = RAMP_SCHEME.slice(1);

// Rest between ramp sets. Short on purpose — nothing here is near failure.
export const WARMUP_REST_SECONDS = 45;

// Below these working weights a ramp is ceremony: you can jump straight in.
// Keeps 25 lb dumbbell presses and empty-bar-adjacent lifts friction-free.
export const MIN_RAMP_TARGET = { barbellTotal: 60, dumbbellPerHand: 30 };

// The lightest load worth setting up, per location. Work's fixed barbell
// weighs 45 lb empty; Home's adjustable bar is assumed ~20 lb. A ramp set
// that rounds below this is raised to it (and deduped against its neighbour).
export const WARMUP_FLOORS = {
  Work: { barbellTotal: 45, dumbbellPerHand: 5 },
  Home: { barbellTotal: 20, dumbbellPerHand: 5 },
};

/** Should this session entry ramp up to its working weight at all? */
export function needsRamp(entry) {
  const suggestion = entry?.suggestion;
  if (!suggestion || suggestion.weight == null) return false;
  if (entry.seconds != null) return false;

  const kind = suggestion.equipment?.kind;
  if (kind !== 'barbellTotal' && kind !== 'dumbbellPerHand') return false;
  if (kind === 'dumbbellPerHand' && entry.tier !== 'primary') return false;

  return suggestion.weight >= (MIN_RAMP_TARGET[kind] ?? Infinity);
}

/**
 * Build the ramp for one session entry: an ascending list of warm-up sets,
 * each strictly lighter than the working weight and loadable at `location`.
 * Returns [] when the entry should not ramp — callers need no second check.
 */
export function warmupRampFor(entry, location) {
  if (!needsRamp(entry)) return [];

  const target = entry.suggestion.weight;
  const { kind, step } = entry.suggestion.equipment;
  const floor = WARMUP_FLOORS[location]?.[kind] ?? 0;
  const scheme = entry.emphasis === 'primary' ? RAMP_SCHEME : SECONDARY_SCHEME;

  const sets = [];
  let previous = 0;
  for (const { fraction, reps } of scheme) {
    const weight = Math.max(roundToStep(target * fraction, step ?? 5), floor);
    // Each set must actually add something: heavier than the last ramp set,
    // lighter than the work. Rounding on light targets collapses neighbours
    // into each other, and that is the ramp shrinking itself — by design.
    if (weight <= previous || weight >= target) continue;
    sets.push({
      kind: 'warmup',
      exerciseId: entry.exerciseId,
      name: entry.name,
      setNumber: sets.length + 1,
      weight,
      reps,
      fraction,
      workingWeight: target,
    });
    previous = weight;
  }
  return sets;
}
