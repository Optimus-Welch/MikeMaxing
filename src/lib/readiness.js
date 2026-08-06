// Pure functions turning today's readiness score into a band, a session
// recommendation, and a duration target. Nothing here touches storage.
//
// The score itself is Garmin's Training Readiness, entered by hand. Garmin
// already folds in sleep, recovery time, HRV, acute load, recent sleep and
// recent rest, so there is nothing left for this app to weight or combine —
// it takes the number as given.

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** Normalise a manually-entered Training Readiness score, or null if unusable. */
export function parseReadinessScore(raw) {
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round(clamp(n, 0, 100));
}

export function scoreToBand(score, bands) {
  if (score >= bands.green) return 'Green';
  if (score >= bands.yellow) return 'Yellow';
  if (score >= bands.orange) return 'Orange';
  return 'Red';
}

// Monday-start ISO weekday: Monday = 1 ... Sunday = 7.
function isoWeekday(date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

// How many days remain in the current Mon-Sun week, counting today.
function daysLeftInWeek(date) {
  return 8 - isoWeekday(date);
}

export function defaultLocationFor(date) {
  const weekday = isoWeekday(date); // 1 = Mon ... 7 = Sun
  return weekday <= 5 ? 'Work' : 'Home';
}

/**
 * Duration target for a band — how LONG today's session should be, as opposed
 * to how hard. Higher readiness buys a longer session.
 *
 * Intensity (reps, RPE, sets per exercise) is a separate axis handled by
 * BAND_PRESCRIPTION in liftGenerator.js. This one controls size: how many
 * exercises a lift contains, and how many minutes of cardio to aim for.
 *
 * Falls back to the Yellow defaults if a band is missing from settings, so a
 * half-configured settings object can never produce an empty session.
 */
export function durationTargetFor(band, durationTargets) {
  return (
    durationTargets?.[band] ??
    durationTargets?.Yellow ?? { liftExercises: 5, cardioMinutes: 30 }
  );
}

// Decide session TYPE + LOCATION for today. Does not pick exercises.
//
// Heuristic:
// - Red readiness always means Rest/Recovery.
// - Orange means Rest/Recovery too, unless the week is nearly out of days
//   to hit both targets, in which case do the lighter of the two missing
//   session types.
// - Green/Yellow: do whichever of lift/cardio is still owed. If both are
//   owed, Green leans toward lifting (higher readiness handles the harder
//   session) and Yellow leans toward cardio, unless the week is running out
//   of days, which forces whichever type has the least room left.
// - If both weekly targets are already met, recommend Rest regardless of
//   band (Red/Orange messaging takes priority when it also applies).
export function recommendSession({ band, counts, goals, date, manualLocation }) {
  const remainingLifts = Math.max(0, goals.liftsPerWeek - (counts.Lift ?? 0));
  const remainingCardio = Math.max(0, goals.cardioPerWeek - (counts.Cardio ?? 0));
  const daysLeft = daysLeftInWeek(date);
  const targetsMet = remainingLifts === 0 && remainingCardio === 0;

  const defaultLocation = defaultLocationFor(date);
  const location = manualLocation ?? defaultLocation;

  const timePressured = daysLeft <= remainingLifts + remainingCardio;

  let type;
  let rationale;

  if (targetsMet) {
    type = 'Rest';
    rationale = "This week's lift and cardio targets are already met — recover today.";
  } else if (band === 'Red') {
    type = 'Rest';
    rationale = 'Readiness is Red — recovery comes first, regardless of the weekly plan.';
  } else if (band === 'Orange') {
    if (timePressured) {
      type = remainingCardio > 0 ? 'Cardio' : 'Lift';
      rationale = `Readiness is Orange, but only ${daysLeft} day(s) are left to fit the remaining sessions, so a lighter ${type.toLowerCase()} keeps the week on track.`;
    } else {
      type = 'Rest';
      rationale = 'Readiness is Orange and the week still has room — recover today and catch up later.';
    }
  } else if (remainingLifts > 0 && remainingCardio > 0) {
    if (band === 'Yellow') {
      type = timePressured && remainingLifts > remainingCardio ? 'Lift' : 'Cardio';
      rationale = 'Readiness is Yellow — a lighter cardio session fits better than a hard lift today.';
    } else {
      type = 'Lift';
      rationale = 'Readiness is Green and a lift is still owed this week.';
    }
  } else if (remainingLifts > 0) {
    type = 'Lift';
    rationale = `Readiness is ${band} and ${remainingLifts} lift session(s) are still owed this week.`;
  } else {
    type = 'Cardio';
    rationale = `Readiness is ${band} and ${remainingCardio} cardio session(s) are still owed this week.`;
  }

  return { type, location, defaultLocation, rationale, remainingLifts, remainingCardio };
}
