// Finish-screen maths. Pure — takes the run results plus prior history and
// works out what was achieved.

// Volume = reps x weight, summed. Bodyweight and time-based work contributes
// no tonnage, which is honest: a 45s plank is not "0 lb of effort", it just
// is not load-volume, and the finish screen counts it separately.
export function totalVolume(performed) {
  return performed.reduce((sum, s) => {
    if (s.weight == null || s.reps == null) return sum;
    return sum + s.weight * s.reps;
  }, 0);
}

/**
 * Muscle groups worked, ranked by how many sets hit them.
 * Primary muscles count double — the point of the lift beats what merely
 * assists it.
 */
export function muscleBreakdown(performed, library) {
  const scores = new Map();
  const bump = (muscle, weight) => scores.set(muscle, (scores.get(muscle) ?? 0) + weight);

  for (const set of performed) {
    const ex = library.find((e) => e.id === set.exerciseId);
    if (!ex) continue;
    for (const m of ex.primaryMuscles ?? []) bump(m, 2);
    for (const m of ex.secondaryMuscles ?? []) bump(m, 1);
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([muscle, score]) => ({ muscle, score }));
}

/**
 * Best previously-recorded set for an exercise across all history, ignoring
 * the session currently being finished.
 */
export function previousBest(exerciseId, history, excludeSessionId) {
  let best = null;
  for (const session of history) {
    if (session.id === excludeSessionId) continue;
    if (!Array.isArray(session.exercises)) continue;
    const entry = session.exercises.find((e) => e.exerciseId === exerciseId);
    if (!entry?.sets) continue;

    for (const set of entry.sets) {
      if (set.weight == null || set.reps == null) continue;
      if (!best || set.weight > best.weight || (set.weight === best.weight && set.reps > best.reps)) {
        best = { weight: set.weight, reps: set.reps, date: session.date };
      }
    }
  }
  return best;
}

/**
 * Records beaten this session.
 *
 * Two kinds, deliberately kept apart:
 *   'weight' — heavier than anything logged before for this exercise
 *   'reps'   — same top weight, but more reps than before
 *
 * An exercise with no prior history is NOT a record. Calling your first ever
 * set a personal best is noise, and it would fire for six exercises on day one.
 */
export function findRecords(performed, history, excludeSessionId) {
  const records = [];
  const byExercise = new Map();

  for (const set of performed) {
    if (set.weight == null || set.reps == null) continue;
    const current = byExercise.get(set.exerciseId);
    if (!current || set.weight > current.weight || (set.weight === current.weight && set.reps > current.reps)) {
      byExercise.set(set.exerciseId, { ...set });
    }
  }

  for (const [exerciseId, top] of byExercise) {
    const prior = previousBest(exerciseId, history, excludeSessionId);
    if (!prior) continue; // first time doing it — not a record

    if (top.weight > prior.weight) {
      records.push({
        type: 'weight',
        exerciseId,
        name: top.name,
        value: top.weight,
        previous: prior.weight,
        unit: 'lb',
      });
    } else if (top.weight === prior.weight && top.reps > prior.reps) {
      records.push({
        type: 'reps',
        exerciseId,
        name: top.name,
        value: top.reps,
        previous: prior.reps,
        unit: 'reps',
        atWeight: top.weight,
      });
    }
  }

  return records;
}

/** Everything the finish screen needs, in one call. */
export function summariseSession({ performed, library, history, sessionId, startedAt, endedAt }) {
  const workingSets = performed.length;
  const exercises = [...new Set(performed.map((s) => s.exerciseId))];
  const durationMinutes =
    startedAt && endedAt ? Math.max(1, Math.round((endedAt - startedAt) / 60000)) : null;

  return {
    volume: totalVolume(performed),
    workingSets,
    exerciseCount: exercises.length,
    muscles: muscleBreakdown(performed, library),
    records: findRecords(performed, history, sessionId),
    durationMinutes,
  };
}
