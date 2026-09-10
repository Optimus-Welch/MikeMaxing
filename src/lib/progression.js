// Progressive overload. Pure functions — no storage, no React — so the whole
// thing is testable and re-runnable (scripts/check-progression.mjs).
//
// The job: given what you actually logged, decide what to prescribe next
// time. Three steps, kept separate on purpose because they fail differently:
//
//   1. assess   was the last session easy, honest, or a grind?
//   2. adjust   turn that verdict into a prescription, respecting the range
//               and the equipment
//   3. explain  say why, in one line, because a number with no reason is
//               something you either follow blindly or ignore
//
// The philosophy is sustainable strength, not max strength. Progress is
// REPS-FIRST: a clean session adds a rep inside the working range (10–15),
// and the weight moves only after the TOP of the range has been held across
// consecutive sessions — then by exactly one equipment increment, with reps
// dropping back to the bottom of the range to rebuild. The range is also the
// effort ceiling: nothing here ever converts progress into low-rep loading or
// programs toward a 1-rep max, and a lift that runs out of both reps and
// loadable weight is pointed at a harder variation instead.
//
// It only ever suggests. Every number here is overridable in the preview and
// again in run mode.

import { LOCATION_LOAD_CAPS, LOCATION_LOAD_STEPS, loadKindFor } from './exercises.js';

export const PROGRESSION = {
  // How much a rep is "worth" in load, used when today's rep target differs
  // from the one you actually trained at. 2.5% per rep is the low end of the
  // usual coaching rules of thumb, chosen because being too light for a set is
  // a wasted set and being too heavy is a failed one.
  percentPerRep: 0.025,
  // ...clamped hard, so a Green day following an Orange day cannot produce a
  // wild jump off one data point.
  maxRepAdjust: 0.15,

  // Back-off size when the last session was a genuine grind.
  deloadPercent: 0.1,

  // Reps-first progression: weight moves only after the top of the working
  // range has been held for this many CONSECUTIVE sessions of the lift — and
  // then by a single equipment increment, never a jump. Two sessions rather
  // than one so a single good day cannot buy a load increase.
  topRangeSessionsForWeight: 2,

  // Only used when RPE was actually logged, which today it never is — see the
  // note on assessLastSession.
  rpeEasy: 7,
  rpeHard: 9,

  // Below this fraction of the prescribed reps, the session was not "close
  // enough" — it was missed, and the weight comes down rather than holding.
  missedVolumeRatio: 0.75,

  // A last set this far below the first reads as grinding even when the total
  // volume looks acceptable: 12, 10, 6 is not the same session as 9, 9, 10.
  fadeRatio: 0.6,

  // Starting points when there is no history at all for a movement, expressed
  // as a fraction of a related lift you HAVE logged. Never absolute numbers —
  // see suggestFor.
  sameGroupFactor: 0.9,
  samePatternFactor: 0.8,
};

// -- weight arithmetic -----------------------------------------------------
// Floating point and 2.5 lb steps do not mix: 3 * 2.5 is fine, 52.5 / 2.5 is
// 21.000000000000004. Everything goes through tenths of a pound as integers.

const toTenths = (n) => Math.round(n * 10);
const fromTenths = (n) => n / 10;

/** Nearest weight the equipment can actually make. */
export function roundToStep(weight, step) {
  if (!step) return Math.round(weight);
  const s = toTenths(step);
  return fromTenths(Math.round(toTenths(weight) / s) * s);
}

/** Largest makeable weight not exceeding `weight` — used against a cap. */
export function snapDownToStep(weight, step) {
  if (!step) return Math.floor(weight);
  const s = toTenths(step);
  return fromTenths(Math.floor(toTenths(weight) / s) * s);
}

/** The step and ceiling governing one exercise at one location. */
export function loadLimitsFor(exercise, location) {
  const kind = loadKindFor(exercise);
  if (!kind) return { kind: null, step: null, cap: null };
  return {
    kind,
    step: LOCATION_LOAD_STEPS[location]?.[kind] ?? null,
    cap: LOCATION_LOAD_CAPS[location]?.[kind] ?? null,
  };
}

/**
 * Make a weight real: snapped to the equipment's increments and never above
 * what the equipment goes up to.
 * Returns { weight, capped } — `capped` means the ceiling, not the athlete,
 * decided this number.
 */
export function fitToEquipment(weight, { step, cap }) {
  if (weight == null) return { weight: null, capped: false };
  let fitted = roundToStep(Math.max(0, weight), step);
  if (cap != null && fitted > cap) {
    return { weight: snapDownToStep(cap, step), capped: true };
  }
  return { weight: fitted, capped: false };
}

// -- history lookup --------------------------------------------------------

/**
 * The most recent logged performance of an exercise AT A GIVEN LOCATION.
 *
 * Location matters more than it looks. Home caps dumbbells at 52.5 and the
 * barbell at 80; Work has neither. A Home session is not evidence about what
 * you can lift at Work, and a Work session read at Home produces a suggestion
 * the equipment cannot make. db.getLastPerformance() ignores location and is
 * still used for the "last time" line in run mode; progression uses this.
 */
export function lastPerformanceAt(sessionHistory, exerciseId, location) {
  for (const session of sessionHistory ?? []) {
    if (session.type !== 'Lift') continue;
    if (location && session.location !== location) continue;
    if (!Array.isArray(session.exercises)) continue;

    const entry = session.exercises.find((e) => e.exerciseId === exerciseId);
    if (!entry || !Array.isArray(entry.sets) || entry.sets.length === 0) continue;

    const sets = entry.sets.filter((s) => s.reps != null || s.weight != null);
    if (!sets.length) continue;

    return {
      date: session.date,
      location: session.location,
      sets,
      // Recorded from the generated prescription since this feature landed.
      // Sessions logged before it have neither, and assessLastSession says so
      // rather than guessing.
      targetSets: entry.targetSets ?? null,
      targetReps: entry.targetReps ?? null,
      // The heaviest set carrying a weight is the one worth progressing from.
      topSet: sets
        .filter((s) => s.weight != null && s.weight !== '')
        .reduce((a, b) => (Number(b.weight) > Number(a?.weight ?? -Infinity) ? b : a), null),
    };
  }
  return null;
}

/**
 * How many consecutive recent sessions of this exercise, at this location,
 * finished at or above `ceiling` target reps with every set completed.
 *
 * This is the gate on weight increases: reps climb first, and only a streak
 * of full sessions AT the top of the range earns one equipment increment.
 * Sessions that simply do not contain the exercise are skipped rather than
 * breaking the streak — training something else on Tuesday says nothing about
 * your bench.
 */
export function topOfRangeStreak(sessionHistory, exerciseId, location, ceiling) {
  if (ceiling == null) return 0;
  let streak = 0;
  for (const session of sessionHistory ?? []) {
    if (session.type !== 'Lift') continue;
    if (location && session.location !== location) continue;
    if (!Array.isArray(session.exercises)) continue;

    const entry = session.exercises.find((e) => e.exerciseId === exerciseId);
    if (!entry || !Array.isArray(entry.sets) || entry.sets.length === 0) continue;

    const repped = entry.sets.map((s) => Number(s.reps)).filter((n) => Number.isFinite(n) && n > 0);
    const met =
      entry.targetReps != null &&
      entry.targetReps >= ceiling &&
      repped.length >= (entry.targetSets ?? repped.length) &&
      repped.every((r) => r >= entry.targetReps);
    if (!met) break;
    streak++;
  }
  return streak;
}

/** Any logged performance in the same movement family, at this location. */
function relatedPerformance(sessionHistory, { variationGroup, pattern }, location) {
  const byGroup = [];
  const byPattern = [];

  for (const session of sessionHistory ?? []) {
    if (session.type !== 'Lift') continue;
    if (location && session.location !== location) continue;
    if (!Array.isArray(session.exercises)) continue;

    for (const entry of session.exercises) {
      const top = (entry.sets ?? [])
        .filter((s) => s.weight != null && s.weight !== '')
        .reduce((a, b) => (Number(b.weight) > Number(a?.weight ?? -Infinity) ? b : a), null);
      if (!top) continue;

      const hit = { name: entry.name, weight: Number(top.weight), reps: top.reps };
      if (variationGroup && entry.variationGroup === variationGroup) byGroup.push(hit);
      else if (pattern && entry.pattern === pattern) byPattern.push(hit);
    }
  }

  if (byGroup.length) {
    return { ...byGroup[0], factor: PROGRESSION.sameGroupFactor, relation: 'group' };
  }
  if (byPattern.length) {
    return { ...byPattern[0], factor: PROGRESSION.samePatternFactor, relation: 'pattern' };
  }
  return null;
}

// -- assessment ------------------------------------------------------------

/**
 * Was the last session easy, honest, or a grind?
 *
 * WITHOUT RPE, which is the situation in practice. Run mode logs reps and
 * weight; there is no RPE input, so `rpe` is null on every set ever recorded.
 * The RPE branch below is live for the day one is added, but everything real
 * goes through the rep evidence:
 *
 *   - every set met its prescribed reps            -> room to spare
 *   - close, but short somewhere                   -> hold
 *   - well short, or a hard fade across the sets   -> back off
 *
 * "Fade" is the honest proxy for grinding. Prescribed 3x10 and you logged
 * 10, 10, 10 is a different session from 10, 9, 6, even though both average
 * out respectably. The second one tells you the weight won.
 */
export function assessLastSession(performance) {
  if (!performance) return { verdict: 'none', reason: 'No history for this lift here yet.' };

  const { sets, targetSets, targetReps } = performance;
  const repped = sets.map((s) => Number(s.reps)).filter((n) => Number.isFinite(n) && n > 0);

  // `s.rpe` is null on every set ever logged, and Number(null) is 0 — a finite
  // number, and the lowest possible RPE. Filtering on Number.isFinite alone
  // therefore read "no RPE recorded" as "RPE 0, trivially easy" and added
  // weight to every lift regardless of how it went. Check for null first.
  const rpes = sets
    .filter((s) => s.rpe != null && s.rpe !== '')
    .map((s) => Number(s.rpe))
    .filter((n) => Number.isFinite(n));
  if (rpes.length) {
    const avg = rpes.reduce((a, b) => a + b, 0) / rpes.length;
    if (avg <= PROGRESSION.rpeEasy) {
      return { verdict: 'progress', reason: `Last time averaged RPE ${avg.toFixed(1)} — room to spare.` };
    }
    if (avg >= PROGRESSION.rpeHard) {
      return { verdict: 'deload', reason: `Last time averaged RPE ${avg.toFixed(1)} — that was a grind.` };
    }
    return { verdict: 'hold', reason: `Last time averaged RPE ${avg.toFixed(1)} — about right.` };
  }

  if (!repped.length) {
    return { verdict: 'hold', reason: 'Last time has no reps recorded — holding steady.' };
  }

  // Sessions logged before this feature carry no prescription, so there is
  // nothing to have met or missed. Hold rather than invent a yardstick; one
  // completed session fixes it.
  if (targetReps == null) {
    return {
      verdict: 'hold',
      reason: 'Last time was logged without its target — holding until there is one to compare.',
    };
  }

  const first = repped[0];
  const last = repped[repped.length - 1];
  const faded = repped.length > 1 && last < first * PROGRESSION.fadeRatio;

  const prescribedVolume = (targetSets ?? repped.length) * targetReps;
  const achievedVolume = repped.reduce((a, b) => a + b, 0);
  const ratio = prescribedVolume > 0 ? achievedVolume / prescribedVolume : 1;

  if (ratio < PROGRESSION.missedVolumeRatio) {
    return {
      verdict: 'deload',
      reason: `Last time you got ${achievedVolume} of ${prescribedVolume} prescribed reps.`,
    };
  }
  if (faded) {
    return {
      verdict: 'deload',
      reason: `Last time faded from ${first} reps to ${last} — the weight won.`,
    };
  }

  const metEverySet =
    repped.length >= (targetSets ?? repped.length) && repped.every((r) => r >= targetReps);
  if (metEverySet) {
    return {
      verdict: 'progress',
      reason: `Last time you hit all ${repped.length} × ${targetReps}.`,
    };
  }

  return {
    verdict: 'hold',
    reason: `Last time you were just short of ${targetSets ?? repped.length} × ${targetReps}.`,
  };
}

// -- suggestion ------------------------------------------------------------

/**
 * What to load today.
 *
 * @param exercise       the library exercise (for its equipment)
 * @param location       'Work' | 'Home'
 * @param sessionHistory newest-first
 * @param target         today's prescription: { sets, reps, seconds }
 * @param entry          the session entry, for variationGroup/pattern fallback
 *
 * @returns {{ weight, reps, note, verdict, capped, source, atRepCeiling }}
 *          `weight` is null when the movement has no external load, or when
 *          there is nothing to base a number on — see below.
 */
export function suggestFor({ exercise, location, sessionHistory, target, entry }) {
  const limits = loadLimitsFor(exercise, location);
  const targetReps = target?.reps ?? null;
  const repCeiling = target?.repCeiling ?? null;

  // Carried on every suggestion so the UI can offer a stepper without
  // re-deriving which equipment governs the lift — it has the session entry,
  // not the library exercise.
  const equipment = { step: limits.step, cap: limits.cap, kind: limits.kind };

  // Timed work (planks, carries) has no rep progression to speak of and its
  // load is "heavy enough that grip is working". Left alone deliberately.
  if (target?.seconds != null) {
    return {
      weight: null,
      reps: null,
      note: null,
      verdict: 'none',
      capped: false,
      source: 'timed',
      atRepCeiling: false,
      equipment,
    };
  }

  const performance = lastPerformanceAt(sessionHistory, entry?.exerciseId ?? exercise?.id, location);
  const assessment = assessLastSession(performance);

  // -- no history for this lift here ---------------------------------------
  if (!performance || !performance.topSet) {
    // Bodyweight: nothing to seed, and nothing to seed it from.
    if (!limits.kind) {
      return {
        weight: null,
        reps: targetReps,
        note: 'First time — log what you do and it will build from there.',
        verdict: 'none',
        capped: false,
        source: 'none',
        atRepCeiling: false,
      };
    }

    const related = relatedPerformance(
      sessionHistory,
      { variationGroup: entry?.variationGroup, pattern: entry?.pattern },
      location,
    );

    // Deliberately no absolute fallback number. Inventing a starting load for
    // a movement with nothing to infer it from is the one place in this file
    // where being wrong is a safety question rather than a UX one, so it asks
    // instead of guessing.
    if (!related) {
      return {
        weight: null,
        reps: targetReps,
        note: 'First time here — pick a weight you could stop 2 reps short with.',
        verdict: 'none',
        capped: false,
        source: 'none',
        atRepCeiling: false,
      };
    }

    const { weight, capped } = fitToEquipment(related.weight * related.factor, limits);
    return {
      weight,
      reps: targetReps,
      note: `Starting from your ${related.name} (${related.weight} lb)${capped ? ', capped by the equipment here' : ''}.`,
      verdict: 'none',
      capped,
      source: related.relation,
      atRepCeiling: false,
      equipment,
    };
  }

  // -- there is history ----------------------------------------------------
  const lastWeight = Number(performance.topSet.weight);
  const lastReps = Number(performance.topSet.reps);

  // Bodyweight movements progress by reps only.
  if (!limits.kind) {
    return {
      weight: null,
      reps: targetReps,
      note: assessment.reason,
      verdict: assessment.verdict,
      capped: false,
      source: 'history',
      atRepCeiling: false,
      equipment,
    };
  }

  const repFloor = target?.repFloor ?? targetReps;
  const ceiling = repCeiling ?? targetReps;

  // Step 1: place the lift inside today's working range. Continuity beats the
  // generator's fresh draw: progression carries on from last session's target
  // rather than jumping to a random point in the range.
  //
  // A last target OUTSIDE the range (a 5×5 logged under the old heavy
  // philosophy, or a differently-ranged scheme) is pulled to the nearest edge
  // and the rep difference is converted to load, clamped — a weight held for
  // 5 is not the weight for 10, and carrying it over unchanged would turn a
  // moderate set into a grind. Compared against last session's TARGET, not
  // what was achieved: achieved reps already decided the verdict, and using
  // them here would charge for the same miss twice.
  const lastTarget = performance.targetReps ?? lastReps;

  let proposed = lastWeight;
  let baseReps = Number.isFinite(lastTarget) ? lastTarget : targetReps;
  let repAdjusted = false;
  if (
    Number.isFinite(lastTarget) &&
    repFloor != null &&
    ceiling != null &&
    (lastTarget < repFloor || lastTarget > ceiling)
  ) {
    baseReps = Math.min(ceiling, Math.max(repFloor, lastTarget));
    const raw = 1 + PROGRESSION.percentPerRep * (lastTarget - baseReps);
    const factor = Math.min(1 + PROGRESSION.maxRepAdjust, Math.max(1 - PROGRESSION.maxRepAdjust, raw));
    proposed *= factor;
    repAdjusted = true;
  }

  // Step 2: the verdict moves the prescription — reps first, weight second.
  //
  //   progress, below the ceiling   -> same weight, one more rep
  //   progress, AT the ceiling      -> hold it there until the top of the
  //                                    range has been held for consecutive
  //                                    sessions, then ONE equipment step up
  //                                    and reps back to the floor
  //   hold                          -> everything stays put
  //   deload                        -> weight comes down, reps stay
  //
  // The range is the effort ceiling: reps never push past its top, and weight
  // never moves by more than a single increment. A transition session (the
  // rep-adjust above) just settles into the range without also progressing.
  let reps = baseReps;
  let addedWeight = false;
  let banked = false; // at the top of the range, streak not yet long enough
  if (assessment.verdict === 'progress' && !repAdjusted && ceiling != null) {
    if (baseReps < ceiling) {
      reps = baseReps + 1;
    } else {
      const streak = topOfRangeStreak(
        sessionHistory,
        entry?.exerciseId ?? exercise?.id,
        location,
        ceiling,
      );
      if (streak >= PROGRESSION.topRangeSessionsForWeight) {
        // One increment, measured from the grid: a weight logged elsewhere
        // (Home's 2.5s at Work's 5s) snaps DOWN first, so rounding can never
        // stretch "one step" into a bigger jump than the equipment's own.
        const step = limits.step ?? 5;
        proposed = snapDownToStep(lastWeight, step) + step;
        reps = repFloor ?? baseReps;
        addedWeight = true;
      } else {
        banked = true;
      }
    }
  } else if (assessment.verdict === 'deload') {
    proposed = proposed * (1 - PROGRESSION.deloadPercent);
  }

  const { weight, capped } = fitToEquipment(proposed, limits);

  // Step 3: the equipment ceiling closes the weight route. Rep progression is
  // already the default, so the cap only truly bites when the reps have ALSO
  // topped out — and then the honest answer is a harder variation, never
  // pushing past the range or grinding the capped weight.
  // Judged on the weight already being lifted, not on whether the final
  // number happened to land under the cap on paper.
  const capBinding = limits.cap != null && lastWeight >= limits.cap;
  let atRepCeiling = false;
  if (addedWeight && (capped || capBinding)) {
    addedWeight = false;
    reps = ceiling;
    atRepCeiling = true;
  }

  return {
    weight,
    reps,
    note: buildNote({
      assessment,
      lastWeight,
      lastTarget,
      weight,
      reps,
      baseReps,
      ceiling,
      addedWeight,
      banked,
      atRepCeiling,
      repAdjusted,
      capBinding,
      location,
    }),
    verdict: assessment.verdict,
    capped,
    source: 'history',
    atRepCeiling,
    equipment,
  };
}

/** One line saying where the number came from. */
function buildNote({
  assessment,
  lastWeight,
  lastTarget,
  weight,
  reps,
  baseReps,
  ceiling,
  addedWeight,
  banked,
  atRepCeiling,
  repAdjusted,
  capBinding,
  location,
}) {
  if (atRepCeiling) {
    return `Capped at ${weight} lb here and at the top of the rep range — swap to a harder variation.`;
  }
  if (addedWeight) {
    return `+${trim(weight - lastWeight)} lb — you held ${ceiling} reps across back-to-back sessions. Reps drop to ${reps} to rebuild.`;
  }
  if (banked) {
    return `Hold ${weight} lb × ${ceiling} once more — hit it again and a small weight step follows. ${assessment.reason}`;
  }
  if (reps != null && baseReps != null && reps > baseReps) {
    // Reps-first progress. At an equipment ceiling this is also the only
    // route, and saying so stops the flat weight looking like a bug.
    return capBinding
      ? `${weight} lb is the ceiling at ${location} — progress is reps now: ${reps}. ${assessment.reason}`
      : `Same weight, ${reps} reps (up from ${baseReps}). ${assessment.reason}`;
  }

  const delta = weight - lastWeight;

  // A shift can look arbitrary without the reason for it. Settling an old
  // 5-rep weight into today's 10–15 range is most of the change — say that,
  // rather than leaving it looking like the app moved the number on a whim.
  const becauseReps =
    repAdjusted && lastTarget != null && reps != null
      ? ` Today is ${reps} reps, not ${lastTarget}.`
      : '';

  if (delta > 0) return `+${trim(delta)} lb from last time.${becauseReps} ${assessment.reason}`;
  if (delta < 0) return `${trim(delta)} lb from last time.${becauseReps} ${assessment.reason}`;

  // Same weight, but say WHY it is the same — a rep-range change that happens
  // to land back on the old number is not the same as holding steady.
  if (repAdjusted && reps != null) {
    return `Same weight as last time, adjusted for today's ${reps}-rep target. ${assessment.reason}`;
  }
  return `Same as last time. ${assessment.reason}`;
}

const trim = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
