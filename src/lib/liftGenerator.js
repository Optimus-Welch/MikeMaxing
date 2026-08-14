// Lift session generation. Pure functions — nothing here touches storage, so
// the whole thing is easy to test and to re-run with a different seed.
//
// The pipeline for one session:
//   1. pick the template (A/B alternate off the last lift session)
//   2. for each template slot, build a candidate pool:
//        available at this location
//        -> not in a variationGroup used recently (freshness)
//        -> at Home on cap-sensitive patterns, prefer capFriendly options
//   3. pick one candidate with a seeded RNG
//   4. prescribe sets/reps/intensity from the readiness band + a scheme
//
// Every step degrades rather than failing: if freshness filtering empties the
// pool we relax it (least-recently-used wins), and if a pattern has nothing at
// all at this location the slot is dropped with a reason attached.

import {
  isAvailableAt,
  CAP_SENSITIVE_PATTERNS,
  PATTERN_LABELS,
  LOCATION_LOAD_CAPS,
} from './exercises.js';
import { suggestFor } from './progression.js';

// -- seeded RNG ------------------------------------------------------------
// mulberry32: tiny, fast, good enough for picking exercises. Seeded so a
// session is reproducible — "regenerate" just means "same inputs, new seed",
// which keeps generation a pure function of (inputs, seed).

export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

// -- templates -------------------------------------------------------------
// Each template is an ordered list of slots. Both templates are full-body,
// but they emphasise different patterns so back-to-back lift days do not
// hammer the same movements. Across one A->B cycle every pattern is covered.

export const TEMPLATES = [
  {
    id: 'A',
    name: 'A — Squat / Horizontal',
    focus: 'Squat and horizontal pressing and pulling',
    slots: [
      { pattern: 'squat', emphasis: 'primary' },
      { pattern: 'horizontalPush', emphasis: 'primary' },
      { pattern: 'horizontalPull', emphasis: 'secondary' },
      { pattern: 'hinge', emphasis: 'secondary' },
      { pattern: 'core', emphasis: 'accessory' },
      { pattern: 'carry', emphasis: 'accessory' },
    ],
  },
  {
    id: 'B',
    name: 'B — Hinge / Vertical',
    focus: 'Hinge and vertical pressing and pulling',
    slots: [
      { pattern: 'hinge', emphasis: 'primary' },
      { pattern: 'verticalPull', emphasis: 'primary' },
      { pattern: 'verticalPush', emphasis: 'secondary' },
      { pattern: 'unilateral', emphasis: 'secondary' },
      { pattern: 'core', emphasis: 'accessory' },
      { pattern: 'carry', emphasis: 'accessory' },
    ],
  },
];

// The most exercises any template can supply. A duration target above this is
// silently capped by slice(), so the Settings UI clamps to it rather than
// offering a number that quietly does nothing.
export const MAX_LIFT_EXERCISES = Math.max(...TEMPLATES.map((t) => t.slots.length));

// Alternate off whatever the last logged lift session used. Falls back to A.
export function nextTemplate(sessionHistory) {
  const lastLift = sessionHistory.find((s) => s.type === 'Lift' && s.templateId);
  if (!lastLift) return TEMPLATES[0];
  return TEMPLATES.find((t) => t.id !== lastLift.templateId) ?? TEMPLATES[0];
}

// -- readiness -> INTENSITY ------------------------------------------------
// Green trades reps for load, Yellow is the honest middle, Orange keeps the
// session but backs off. Red never reaches here (Today recommends Rest).
//
// This is the intensity axis only. How LONG the session is — how many
// exercises it contains — is the duration axis, configured per band in
// settings.durationTargets and passed in as `exerciseCount`.

export const BAND_PRESCRIPTION = {
  Green: {
    label: 'Heavy — low reps, high intensity',
    repRange: [4, 6],
    accessoryReps: [8, 10],
    sets: { primary: 5, secondary: 4, accessory: 3 },
    rpe: '8–9',
    note: 'Readiness is Green: push the load, keep reps low and crisp.',
  },
  Yellow: {
    label: 'Standard — moderate reps',
    repRange: [8, 12],
    accessoryReps: [12, 15],
    sets: { primary: 4, secondary: 3, accessory: 3 },
    rpe: '7–8',
    note: 'Readiness is Yellow: standard working sets, leave a rep or two in reserve.',
  },
  Orange: {
    label: 'Reduced volume — movement quality',
    repRange: [10, 12],
    accessoryReps: [12, 15],
    sets: { primary: 2, secondary: 2, accessory: 2 },
    rpe: '5–6',
    note: 'Readiness is Orange: cut the volume, stay well short of failure, focus on clean reps.',
  },
};

// -- set/rep schemes -------------------------------------------------------
// Variety so it is not 3x10 forever. `tiers` limits where a scheme can land —
// EMOM and drop sets have no business on a heavy primary lift.

export const SCHEMES = [
  {
    id: 'straight',
    name: 'Straight sets',
    tiers: ['primary', 'secondary', 'accessory'],
    describe: ({ sets, reps, rpe }) => ({
      prescription: `${sets} × ${reps}`,
      detail: `Straight sets at RPE ${rpe}. Rest fully between sets.`,
    }),
  },
  {
    id: 'tempo',
    name: 'Tempo',
    tiers: ['primary', 'secondary'],
    describe: ({ sets, reps, rpe }) => ({
      prescription: `${sets} × ${reps} @ 3-1-1`,
      detail: `3s down, 1s pause, controlled up. Expect to use less weight than usual — RPE ${rpe} on feel, not on the number.`,
    }),
  },
  {
    id: 'superset',
    name: 'Superset',
    tiers: ['secondary', 'accessory'],
    describe: ({ sets, reps, rpe }) => ({
      prescription: `${sets} × ${reps} (superset)`,
      detail: `Pair back-to-back with the next exercise, rest after the pair. RPE ${rpe}.`,
    }),
  },
  {
    id: 'dropSet',
    name: 'Drop set',
    tiers: ['accessory'],
    describe: ({ sets, reps, rpe }) => ({
      prescription: `${sets} × ${reps} + drop`,
      detail: `On the last set only, cut the weight ~30% and go again to near failure. RPE ${rpe} on the working sets.`,
    }),
  },
  {
    id: 'emom',
    name: 'EMOM',
    tiers: ['accessory'],
    describe: ({ sets, reps }) => ({
      prescription: `EMOM ${sets + 5} min × ${Math.max(3, Math.round(reps / 2))}`,
      detail: `Every minute on the minute, then rest what is left of the minute. Keep it submaximal.`,
    }),
  },
];

// -- freshness -------------------------------------------------------------

// variationGroups used in the last `window` lift sessions, newest first.
// sessionHistory is newest-first (see db.addSession).
export function recentVariationGroups(sessionHistory, window) {
  const lifts = sessionHistory.filter((s) => s.type === 'Lift' && Array.isArray(s.exercises));
  const groups = new Set();
  for (const session of lifts.slice(0, window)) {
    for (const entry of session.exercises) {
      if (entry.variationGroup) groups.add(entry.variationGroup);
    }
  }
  return groups;
}

// How many sessions ago a group was last used (Infinity = never). Used to
// break ties when freshness filtering has to be relaxed.
function groupRecency(sessionHistory) {
  const lifts = sessionHistory.filter((s) => s.type === 'Lift' && Array.isArray(s.exercises));
  const recency = new Map();
  lifts.forEach((session, index) => {
    for (const entry of session.exercises) {
      if (entry.variationGroup && !recency.has(entry.variationGroup)) {
        recency.set(entry.variationGroup, index);
      }
    }
  });
  return recency;
}

// -- candidate selection ---------------------------------------------------

const TIER_RANK = { primary: 3, secondary: 2, accessory: 1 };

// Minimum tier we would *like* in a slot of each emphasis. A primary slot is
// the day's main lift, so an isolation movement (a fly, a lateral raise) has
// no business there — without this a 5x5 "heavy" slot can land on a cable fly.
const TIER_FLOOR = { primary: 3, secondary: 2, accessory: 1 };

// Narrow to the subset if it is non-empty, otherwise keep what we had.
// Every preference below is a soft filter — availability always wins.
const prefer = (pool, predicate) => {
  const subset = pool.filter(predicate);
  return subset.length ? subset : pool;
};

// Prefer the best tier available for this emphasis, stepping down until
// something matches.
function preferByTier(pool, emphasis) {
  for (let floor = TIER_FLOOR[emphasis] ?? 1; floor >= 1; floor--) {
    const subset = pool.filter((ex) => (TIER_RANK[ex.tier] ?? 1) >= floor);
    if (subset.length) return subset;
  }
  return pool;
}

/**
 * Build the ordered candidate pool for one slot.
 * Returns { candidates, relaxed } — `relaxed` is true when freshness had to be
 * loosened because nothing fresh was available.
 */
export function candidatesForSlot({
  pattern,
  location,
  library,
  recentGroups,
  recency,
  emphasis = 'secondary',
  excludeGroups = new Set(),
  excludeIds = new Set(),
}) {
  const atLocation = library.filter(
    (ex) => ex.movementPattern === pattern && isAvailableAt(ex, location) && !excludeIds.has(ex.id),
  );
  if (atLocation.length === 0) return { candidates: [], relaxed: false };

  // Never reuse a group already picked earlier in THIS session.
  const notInSession = atLocation.filter((ex) => !excludeGroups.has(ex.variationGroup));
  let pool = notInSession.length ? notInSession : atLocation;

  // Match the movement's weight class to the slot's job.
  pool = preferByTier(pool, emphasis);

  // Cap-aware preference: at a location with load caps, cap-sensitive
  // patterns prefer variations flagged as staying hard under the cap.
  const caps = LOCATION_LOAD_CAPS[location] ?? {};
  const capped = caps.dumbbellPerHand != null || caps.barbellTotal != null;
  const preferred =
    capped && CAP_SENSITIVE_PATTERNS.includes(pattern)
      ? prefer(pool, (ex) => ex.capFriendly)
      : pool;

  // Freshness: drop anything whose group appeared in the recent window.
  const fresh = preferred.filter((ex) => !recentGroups.has(ex.variationGroup));
  if (fresh.length) return { candidates: fresh, relaxed: false };

  // Nothing fresh — fall back to least-recently-used groups first. This is the
  // Home vertical-pull case: only one group exists, so it must repeat.
  const byStaleness = [...preferred].sort(
    (a, b) => (recency.get(b.variationGroup) ?? Infinity) - (recency.get(a.variationGroup) ?? Infinity),
  );
  const stalest = recency.get(byStaleness[0]?.variationGroup) ?? Infinity;
  const tied = byStaleness.filter((ex) => (recency.get(ex.variationGroup) ?? Infinity) === stalest);
  return { candidates: tied, relaxed: true };
}

// -- prescription ----------------------------------------------------------

function prescribeFor({ exercise, emphasis, band, rng, schemeOverride }) {
  const plan = BAND_PRESCRIPTION[band] ?? BAND_PRESCRIPTION.Yellow;
  const sets = plan.sets[emphasis];

  const isTimeBased = exercise.metric === 'time';
  const [lo, hi] =
    emphasis === 'accessory' || exercise.tier === 'accessory' ? plan.accessoryReps : plan.repRange;
  const reps = lo + Math.floor(rng() * (hi - lo + 1));

  // Time-based work (planks, carries) always uses straight sets — EMOM/drop
  // sets on a carry is nonsense.
  if (isTimeBased) {
    const seconds = band === 'Orange' ? 30 : band === 'Green' ? 45 : 40;
    return {
      schemeId: 'straight',
      schemeName: 'Straight sets',
      prescription: `${sets} × ${seconds}s`,
      detail:
        exercise.movementPattern === 'carry'
          ? 'Walk for time, upright and braced. Heavy enough that grip is working.'
          : 'Hold with ribs down and glutes squeezed. Stop the set when the position breaks.',
      sets,
      reps: null,
      seconds,
      rpe: plan.rpe,
      repCeiling: null,
    };
  }

  // Exercises whose name already prescribes a tempo ("Tempo Goblet Squat
  // (4s down)") must not also draw the tempo scheme — that would print two
  // contradictory tempos for the same movement.
  const namesOwnTempo = exercise.capStrategy === 'tempo';
  // A drop set needs external load to drop. "Dead Bug 3 x 10 + drop" is
  // meaningless, so bodyweight-only movements never draw that scheme.
  const isLoaded = exercise.equipment.some((t) =>
    ['dumbbells', 'barbell', 'machine', 'cable'].includes(t),
  );

  const allowed = SCHEMES.filter(
    (s) =>
      s.tiers.includes(emphasis) &&
      !(namesOwnTempo && s.id === 'tempo') &&
      !(!isLoaded && s.id === 'dropSet'),
  );
  const scheme =
    (schemeOverride && SCHEMES.find((s) => s.id === schemeOverride)) ?? pick(allowed, rng);
  const { prescription, detail } = scheme.describe({ sets, reps, rpe: plan.rpe });

  return {
    schemeId: scheme.id,
    schemeName: scheme.name,
    prescription,
    detail,
    sets,
    reps,
    seconds: null,
    rpe: plan.rpe,
    // The top of today's band range. Progression needs it to know when reps
    // have nowhere left to go and the movement itself has to get harder.
    repCeiling: hi,
  };
}

// -- generation ------------------------------------------------------------

/**
 * Generate a full lift session.
 *
 * @param {object}   args
 * @param {string}   args.location       'Work' | 'Home'
 * @param {string}   args.band           'Green' | 'Yellow' | 'Orange'
 * @param {object[]} args.library        exercise library
 * @param {object[]} args.sessionHistory newest-first
 * @param {number}   args.freshnessWindow how many past lift sessions to avoid repeating
 * @param {number}   args.exerciseCount  how many exercises to include (duration)
 * @param {number}   args.seed           RNG seed; change it to regenerate
 * @param {object}   [args.template]     force a template (otherwise alternates)
 */
export function generateLiftSession({
  location,
  band,
  library,
  sessionHistory = [],
  freshnessWindow = 3,
  exerciseCount = 5,
  seed = 1,
  template: forcedTemplate,
}) {
  const plan = BAND_PRESCRIPTION[band] ?? BAND_PRESCRIPTION.Yellow;
  const template = forcedTemplate ?? nextTemplate(sessionHistory);
  const rng = makeRng(seed);

  const recentGroups = recentVariationGroups(sessionHistory, freshnessWindow);
  const recency = groupRecency(sessionHistory);

  // Duration: trim from the BACK of the template so the primary strength work
  // always survives — a short session should lose its carry and core finisher,
  // not its main lift. At least one slot always remains.
  const slots = template.slots.slice(0, Math.max(1, exerciseCount));

  const usedGroups = new Set();
  const usedIds = new Set();
  const exercises = [];
  const skipped = [];

  for (const slot of slots) {
    const { candidates, relaxed } = candidatesForSlot({
      pattern: slot.pattern,
      location,
      library,
      recentGroups,
      recency,
      emphasis: slot.emphasis,
      excludeGroups: usedGroups,
      excludeIds: usedIds,
    });

    if (candidates.length === 0) {
      skipped.push({
        pattern: slot.pattern,
        reason: `No ${PATTERN_LABELS[slot.pattern]} exercise is possible at ${location}.`,
      });
      continue;
    }

    const exercise = pick(candidates, rng);
    usedGroups.add(exercise.variationGroup);
    usedIds.add(exercise.id);

    // Shared with both swap paths, so a generated lift and a swapped-in one
    // are prescribed — and progressed — identically.
    exercises.push(
      makeSessionExercise({
        exercise,
        emphasis: slot.emphasis,
        band,
        rng,
        relaxed, // surfaced in the UI as "limited options here"
        location,
        sessionHistory,
      }),
    );
  }

  // Mark superset pairs so the UI can bracket them. A superset slot pairs with
  // whatever follows it; if it is last, demote it to straight sets.
  for (let i = 0; i < exercises.length; i++) {
    if (exercises[i].schemeId !== 'superset') continue;
    if (i === exercises.length - 1) {
      exercises[i].schemeId = 'straight';
      exercises[i].schemeName = 'Straight sets';
      exercises[i].prescription = `${exercises[i].sets} × ${exercises[i].reps}`;
      exercises[i].detail = `Straight sets at RPE ${exercises[i].rpe}.`;
    } else {
      exercises[i].supersetWith = exercises[i + 1].name;
    }
  }

  return {
    templateId: template.id,
    templateName: template.name,
    location,
    band,
    seed,
    freshnessWindow,
    intensityLabel: plan.label,
    bandNote: plan.note,
    exercises,
    skipped,
  };
}

/**
 * Replace a single slot with a different exercise, leaving the rest of the
 * session untouched. Excludes everything already in the session so the swap
 * actually gives you something new.
 */
export function swapExercise({
  session,
  index,
  library,
  sessionHistory = [],
  freshnessWindow = 3,
  seed,
}) {
  const target = session.exercises[index];
  if (!target) return session;

  const recentGroups = recentVariationGroups(sessionHistory, freshnessWindow);
  const recency = groupRecency(sessionHistory);

  const usedGroups = new Set(
    session.exercises.filter((_, i) => i !== index).map((e) => e.variationGroup),
  );
  // Exclude the current exercise itself so a swap always changes something.
  const usedIds = new Set(session.exercises.map((e) => e.exerciseId));

  const { candidates, relaxed } = candidatesForSlot({
    pattern: target.pattern,
    location: session.location,
    library,
    recentGroups,
    recency,
    emphasis: target.emphasis,
    excludeGroups: usedGroups,
    excludeIds: usedIds,
  });

  // Nothing else exists for this pattern here — keep what we have.
  if (candidates.length === 0) return session;

  const rng = makeRng(seed);
  const exercise = pick(candidates, rng);

  return replaceExerciseAt(session, index, exercise, { relaxed, rng, sessionHistory });
}

// -- explicit swap ---------------------------------------------------------

/**
 * Build the session-entry shape for one exercise in one slot. Shared by
 * generation, random swap and pick-from-list swap so all three produce
 * identical objects — a swapped-in lift is prescribed exactly as if the
 * generator had chosen it.
 */
export function makeSessionExercise({
  exercise,
  emphasis,
  band,
  rng,
  relaxed = false,
  location = null,
  sessionHistory = [],
}) {
  const prescription = prescribeFor({ exercise, emphasis, band, rng });

  const entry = {
    exerciseId: exercise.id,
    name: exercise.name,
    pattern: exercise.movementPattern,
    patternLabel: PATTERN_LABELS[exercise.movementPattern],
    variationGroup: exercise.variationGroup,
    emphasis,
    primaryMuscles: exercise.primaryMuscles,
    loadNotes: exercise.loadNotes ?? null,
    capStrategy: exercise.capStrategy ?? null,
    repeatedGroup: relaxed,
    ...prescription,
  };

  // What to actually load, from what you logged here before. Attached to the
  // entry so it flows through blocks -> run steps untouched, and so a swapped
  // exercise gets its own suggestion rather than inheriting the old one's.
  const suggestion = suggestFor({
    exercise,
    location,
    sessionHistory,
    target: prescription,
    entry,
  });

  // Progression can push the reps up when the load is capped out at Home. If
  // it does, the printed prescription has to follow — "4 × 10" beside a
  // suggestion of 11 reps is the kind of small inconsistency that makes the
  // whole screen untrustworthy.
  const finalReps = suggestion.reps ?? entry.reps;
  if (finalReps !== entry.reps && entry.reps != null) {
    const scheme = SCHEMES.find((s) => s.id === entry.schemeId);
    const redescribed = scheme?.describe({
      sets: entry.sets,
      reps: finalReps,
      rpe: entry.rpe,
    });
    if (redescribed) {
      entry.prescription = redescribed.prescription;
      entry.detail = redescribed.detail;
    }
    entry.reps = finalReps;
  }

  return { ...entry, suggestion };
}

function reresolveSupersets(exercises) {
  return exercises.map((ex, i) => {
    if (ex.schemeId === 'superset' && i < exercises.length - 1) {
      return { ...ex, supersetWith: exercises[i + 1].name };
    }
    return ex.supersetWith ? { ...ex, supersetWith: undefined } : ex;
  });
}

function replaceExerciseAt(session, index, exercise, { relaxed = false, rng, sessionHistory = [] }) {
  const target = session.exercises[index];
  const replacement = makeSessionExercise({
    exercise,
    emphasis: target.emphasis,
    band: session.band,
    rng,
    relaxed,
    location: session.location,
    sessionHistory,
  });
  const exercises = reresolveSupersets(
    session.exercises.map((e, i) => (i === index ? replacement : e)),
  );
  return { ...session, exercises };
}

/**
 * Swap a slot to a specific exercise the user picked from the alternatives
 * list. Unlike swapExercise() this makes no choice of its own.
 */
export function swapExerciseTo({ session, index, exercise, seed = 1, sessionHistory = [] }) {
  if (!session.exercises[index] || !exercise) return session;
  return replaceExerciseAt(session, index, exercise, { rng: makeRng(seed), sessionHistory });
}

/**
 * Alternatives for a slot, for the user to choose between.
 *
 * Filters, in order:
 *   1. shares a PRIMARY muscle with the current exercise — the point is to
 *      train the same thing, so movement pattern alone is too loose (a carry
 *      and a row are both "pull") and too tight (a goblet squat and a leg
 *      press are different patterns but the same job)
 *   2. possible with the equipment at this location
 *   3. at a capped location, cap-sensitive patterns keep only capFriendly
 *      options — the same rule generation already applies, so the list can
 *      never offer something the generator would refuse to pick
 *
 * Sorted with same-pattern options first, then by tier, so the closest
 * like-for-like swaps are at the top. The current exercise is excluded.
 */
export function alternativesFor({ exercise, location, library, excludeIds = [] }) {
  if (!exercise) return [];

  const current = library.find((e) => e.id === exercise.exerciseId) ?? exercise;
  const currentPrimary = new Set(current.primaryMuscles ?? []);
  const skip = new Set([current.id ?? exercise.exerciseId, ...excludeIds]);

  const caps = LOCATION_LOAD_CAPS[location] ?? {};
  const capped = caps.dumbbellPerHand != null || caps.barbellTotal != null;
  const capSensitive = capped && CAP_SENSITIVE_PATTERNS.includes(current.movementPattern);

  return library
    .filter((candidate) => {
      if (skip.has(candidate.id)) return false;
      if (!isAvailableAt(candidate, location)) return false;
      if (!(candidate.primaryMuscles ?? []).some((m) => currentPrimary.has(m))) return false;
      // Honour the Home weight cap exactly as generation does.
      if (capSensitive && CAP_SENSITIVE_PATTERNS.includes(candidate.movementPattern)) {
        return candidate.capFriendly === true;
      }
      return true;
    })
    .sort((a, b) => {
      const samePattern = (x) => (x.movementPattern === current.movementPattern ? 0 : 1);
      if (samePattern(a) !== samePattern(b)) return samePattern(a) - samePattern(b);
      return (TIER_RANK[b.tier] ?? 0) - (TIER_RANK[a.tier] ?? 0);
    });
}
