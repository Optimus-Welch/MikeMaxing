// Pure functions for turning today's readiness inputs into a 0-100 score,
// a band, and a session recommendation. Nothing here touches storage —
// that keeps it easy to unit-test and to reuse (e.g. Settings screen can
// preview how a change to the weights would score a sample day).

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// Convert each raw input onto a common 0-100 "higher is more ready" scale.
// - sleepScore is already 0-100.
// - load is a 1-5 pick (1 = easy week so far, 5 = very hard) and gets
//   inverted, since a heavy training load lowers readiness.
// - energy is an optional 1-5 subjective rating.
function toComponents({ sleepScore, load, energy }) {
  const components = {};
  if (sleepScore != null) components.sleep = clamp(sleepScore, 0, 100);
  if (load != null) components.load = clamp(((5 - load) / 4) * 100, 0, 100);
  if (energy != null) components.energy = clamp(((energy - 1) / 4) * 100, 0, 100);
  return components;
}

// Weighted average of whichever components were actually provided, with
// the remaining weights renormalized so they still sum to 1. Returns null
// if nothing was entered yet.
export function computeReadiness(inputs, weights) {
  const components = toComponents(inputs);
  const keys = Object.keys(components);
  if (keys.length === 0) return null;

  const totalWeight = keys.reduce((sum, k) => sum + (weights[k] ?? 0), 0);
  if (totalWeight === 0) return null;

  const score = keys.reduce((sum, k) => sum + components[k] * (weights[k] ?? 0), 0) / totalWeight;
  return Math.round(clamp(score, 0, 100));
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
