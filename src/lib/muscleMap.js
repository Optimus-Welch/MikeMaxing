// Mapping from the library's muscle names onto the regions the body diagram
// can actually draw, plus the roll-up used to shade them.
//
// Kept out of the component file so MuscleMap.jsx exports only its component
// (React Fast Refresh requires that).

const MUSCLE_TO_REGION = {
  quads: 'quads',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  adductors: 'quads',
  calves: 'calves',
  chest: 'chest',
  'upper chest': 'chest',
  triceps: 'arms',
  biceps: 'arms',
  forearms: 'arms',
  'front delts': 'shoulders',
  'side delts': 'shoulders',
  'rear delts': 'shoulders',
  shoulders: 'shoulders',
  lats: 'back',
  'mid back': 'back',
  'upper back': 'back',
  traps: 'traps',
  'spinal erectors': 'lowerback',
  core: 'core',
  obliques: 'core',
  'hip flexors': 'core',
};

export const REGION_LABELS = {
  chest: 'Chest',
  shoulders: 'Shoulders',
  arms: 'Arms',
  back: 'Back',
  traps: 'Traps',
  lowerback: 'Lower back',
  core: 'Core',
  glutes: 'Glutes',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  calves: 'Calves',
};

/** The drawable region a library muscle name belongs to, or null. */
export function regionFor(muscle) {
  return MUSCLE_TO_REGION[muscle] ?? null;
}

/** Roll a muscleBreakdown() result up into 0..1 intensity per drawable region. */
export function regionIntensities(muscles) {
  const totals = {};
  for (const { muscle, score } of muscles) {
    const region = MUSCLE_TO_REGION[muscle];
    if (!region) continue;
    totals[region] = (totals[region] ?? 0) + score;
  }
  const max = Math.max(1, ...Object.values(totals));
  const out = {};
  for (const [region, score] of Object.entries(totals)) out[region] = score / max;
  return out;
}
