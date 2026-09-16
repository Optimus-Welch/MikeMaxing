// Editing a session that has already been logged.
//
// Pure functions: given the stored session and a draft of what the user typed,
// produce the corrected session. No storage, no React, no generation — this
// fixes ENTERED DATA and nothing else.
//
// What is editable, and what deliberately is not:
//
//   editable    the numbers you performed — per-set weight/reps/RPE on a lift,
//               minutes and distance on anything else
//   frozen      date, type, location: they decide which week a session counts
//               in, which ledger progression reads it from, and which chart it
//               lands on. Changing them is a move, not a correction, and it is
//               not what this is for.
//   frozen      targetSets / targetReps / prescription / suggestedWeight: what
//               was ASKED for that day actually happened, and progression
//               judges a session against it. Rewriting the target to match
//               what you did would erase the miss rather than correct the log.
//
// Everything downstream recomputes from `sets` on read — progression's history
// lookups, the finish-screen stats, every chart on Trends — so correcting the
// sets here is all that is needed for those to agree. Weekly counts key off
// date and type, which this cannot touch, so they cannot drift either.

// Cardio/other-session fields. These names are not arbitrary: analytics.js
// already declares them in CARDIO_GAPS and checks for them in
// cardioFieldsPresent(), so filling them in here is what makes the Trends
// screen stop listing them as "not logged".
export const META_FIELDS = [
  { key: 'actualMinutes', label: 'Minutes', step: '1', hint: 'How long it actually took.' },
  { key: 'distance', label: 'Distance', step: '0.01', hint: 'Miles, if the session had one.' },
];

/** Blank means "not recorded" — and must stay distinguishable from zero. */
export function numberOrNull(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Only lift sessions carry per-set data worth editing. */
export const isLiftSession = (session) =>
  session?.type === 'Lift' && Array.isArray(session.exercises);

/**
 * The editable draft for a session, as strings — the shape the form binds to.
 * Built from what was logged, so opening the editor and saving without typing
 * is a no-op rather than a rewrite.
 */
export function draftFromSession(session) {
  const meta = {};
  for (const { key } of META_FIELDS) {
    meta[key] = session?.[key] != null ? String(session[key]) : '';
  }

  if (!isLiftSession(session)) return { meta, exercises: [] };

  return {
    meta,
    exercises: session.exercises.map((entry) => ({
      exerciseId: entry.exerciseId,
      name: entry.name,
      sets: (entry.sets ?? []).map((set) => ({
        reps: set.reps != null ? String(set.reps) : '',
        weight: set.weight != null ? String(set.weight) : '',
        rpe: set.rpe != null ? String(set.rpe) : '',
      })),
    })),
  };
}

/** A blank set row, for "I did one more than I logged". */
export const emptySetRow = () => ({ reps: '', weight: '', rpe: '' });

/** A set with nothing in it at all is not a set — it is an empty row. */
const setHasContent = (set) =>
  numberOrNull(set.reps) != null || numberOrNull(set.weight) != null || numberOrNull(set.rpe) != null;

/**
 * Apply a draft to the stored session, returning the corrected session.
 *
 * The stored session is the base, so every field this editor does not own —
 * id, date, type, location, band, templateId, targets, rampBack, timestamps —
 * survives untouched by construction rather than by being listed.
 *
 * `editedAt` is stamped so the sync merge can tell which copy of a session is
 * the corrected one (see mergeCollections.js): without it, a device holding
 * the pre-edit copy could win the id clash purely by having synced later.
 */
export function applySessionEdit(session, draft, { now = Date.now() } = {}) {
  if (!session) return session;

  const next = { ...session, editedAt: now };

  for (const { key } of META_FIELDS) {
    const value = numberOrNull(draft?.meta?.[key]);
    if (value == null) delete next[key];
    else next[key] = value;
  }

  if (isLiftSession(session) && Array.isArray(draft?.exercises)) {
    next.exercises = session.exercises.map((entry, i) => {
      const edited = draft.exercises[i];
      // An exercise the draft does not describe keeps exactly what it had.
      if (!edited || !Array.isArray(edited.sets)) return entry;

      return {
        ...entry,
        sets: edited.sets.filter(setHasContent).map((set) => ({
          reps: numberOrNull(set.reps),
          weight: numberOrNull(set.weight),
          rpe: numberOrNull(set.rpe),
        })),
      };
    });
  }

  return next;
}

/**
 * Did this draft actually change anything? Used to keep Save honest — an
 * untouched session should not be restamped, re-queued for upload, or
 * promoted over another device's copy in a merge.
 */
export function editChangesAnything(session, draft) {
  const { editedAt: _ignored, ...applied } = applySessionEdit(session, draft, { now: 0 });
  const { editedAt: _also, ...current } = session ?? {};
  return JSON.stringify(applied) !== JSON.stringify(current);
}
