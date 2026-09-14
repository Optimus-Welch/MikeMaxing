// Returning from a break.
//
// A gap of RAMP_BACK.minGapDays or more since the last logged lift or cardio
// session means detraining has started, and the first sessions back should be
// deliberately easier than what progression would otherwise prescribe: lighter
// weights, fewer sets, the same moderate 10–15 rep philosophy. This module is
// the pure logic — detection from history, and the reduction maths. Applying
// it lives in liftGenerator (prescription) and Today (the offer + the skip).
//
// The state is DERIVED, not stored: "am I in a ramp-back?" is answered by
// scanning history for the most recent qualifying gap and counting the lift
// sessions logged since it. The only thing persisted is the user's choice to
// skip (settings.rampBackSkipped, keyed by the break itself) and the length
// (settings.rampBackSessions).
//
// Sessions performed AS ramp-back are logged with `rampBack: true`, and
// progression ignores them as evidence (see progression.js) — so after the
// ramp-back, the rep-first walk resumes exactly where it left off before the
// break, rather than restarting from the deliberately-light numbers.

export const RAMP_BACK = {
  // A gap this long (days without any lift or cardio session) counts as a
  // break. Logged Rest days do not reset the clock — they are not training.
  minGapDays: 10,
  // Default number of easier sessions; editable as settings.rampBackSessions.
  defaultSessions: 2,
  // Per-session weight reduction below the normal suggestion, expressed as a
  // fraction per remaining ramp-back session, and a floor so a long ramp-back
  // can never cut deeper than this. See rampBackWeightFactor.
  reductionPerSession: 0.05,
  minWeightFactor: 0.85,
  // Sets are reduced by the number of ramp-back sessions remaining (session 1
  // of 2 drops two sets, session 2 drops one), but never below this.
  minSets: 2,
};

// Working-weight multiplier for ramp-back session `sessionNumber` of `total`:
// each remaining session is worth 5%, so with the default 2 sessions the walk
// is 90% then 95% of the normal suggestion — "a step or two back, not to
// zero". Clamped so even a long configured ramp-back starts no lower than 85%.
export function rampBackWeightFactor(sessionNumber, total) {
  const remaining = Math.max(1, total - sessionNumber + 1);
  return Math.max(RAMP_BACK.minWeightFactor, 1 - RAMP_BACK.reductionPerSession * remaining);
}

// Whole days between two ISO dates (YYYY-MM-DD). Both parse as UTC midnight,
// so the difference is an exact multiple of a day.
const daysBetween = (older, newer) =>
  Math.round((Date.parse(newer) - Date.parse(older)) / 86400000);

/**
 * Is a ramp-back in effect today, and how far through it are we?
 *
 * Scans newest-first for the most recent gap of `minGapDays`+ days between
 * training sessions (lift or cardio — a cardio session ends a break just as a
 * lift does), including the gap between today and the newest session. The
 * ramp-back covers the first `sessions` LIFT sessions after that gap; once
 * that many have been logged the offer expires on its own.
 *
 * Returns null when there is no break to ramp back from — including a
 * completely empty history, where there is no prior training to have detrained
 * from and no progression history to reduce.
 *
 * Otherwise: {
 *   gapDays,          length of the detected break
 *   lastActiveDate,   the last training day before it — also the stable key
 *                     the skip choice is stored against
 *   sessionNumber,    which ramp-back session TODAY would be (1-based)
 *   sessionsTotal,
 * }
 */
export function rampBackStatus({ sessionHistory, today, sessions = RAMP_BACK.defaultSessions }) {
  if (!sessions || sessions < 1) return null;

  const activity = (sessionHistory ?? [])
    .filter((s) => (s.type === 'Lift' || s.type === 'Cardio') && s.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (activity.length === 0) return null;

  let newer = today;
  let liftsSince = 0; // lift sessions newer than the boundary being examined

  for (const session of activity) {
    const gap = daysBetween(session.date, newer);
    if (gap >= RAMP_BACK.minGapDays) {
      // The most recent qualifying gap. Either its ramp-back window still has
      // sessions left, or it has been trained through — and any older gap is
      // history either way, so this is the only one that can matter.
      if (liftsSince < sessions) {
        return {
          gapDays: gap,
          lastActiveDate: session.date,
          sessionNumber: liftsSince + 1,
          sessionsTotal: sessions,
        };
      }
      return null;
    }
    if (session.type === 'Lift') liftsSince++;
    // Enough normal-programming-relevant lifts since any possible gap: no
    // older break can still be inside its window.
    if (liftsSince >= sessions) return null;
    newer = session.date;
  }
  return null;
}
