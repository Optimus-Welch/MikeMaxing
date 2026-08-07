// Helpers for tallying sessions within the current Monday-start week.

/**
 * Parse a stored 'YYYY-MM-DD' as a LOCAL calendar date.
 *
 * `new Date('2026-08-03')` is NOT this. The ECMAScript spec parses the
 * date-only ISO form as UTC midnight, so west of UTC it lands on the previous
 * evening in local time — 2026-08-03 becomes Sun Aug 2, 20:00 in New York.
 * Comparing that against a local-midnight week boundary silently drops any
 * session logged on the first day of the week.
 *
 * Appending a time component forces local-time parsing, which is what every
 * date in this app means: a calendar day on the user's own clock.
 */
export function parseLocalDate(iso) {
  return new Date(`${iso}T00:00:00`);
}

export function startOfWeek(date) {
  // Accept either a Date or a stored 'YYYY-MM-DD' string.
  const d = typeof date === 'string' ? parseLocalDate(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  const isoWeekday = d.getDay() === 0 ? 7 : d.getDay(); // Mon = 1 ... Sun = 7
  d.setDate(d.getDate() - (isoWeekday - 1));
  return d;
}

/** Exclusive upper bound: local midnight on the Monday after `date`. */
export function endOfWeek(date) {
  const d = startOfWeek(date);
  d.setDate(d.getDate() + 7);
  return d;
}

export function todayISO(date = new Date()) {
  // Local calendar date (not UTC), so "today" matches the user's clock.
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

// { Lift, Cardio, Rest } counts of sessions logged during the current
// Monday-start week, in the user's own timezone.
export function weeklyCounts(sessionHistory, referenceDate = new Date()) {
  const weekStart = startOfWeek(referenceDate);
  const weekEnd = endOfWeek(referenceDate);

  const counts = { Lift: 0, Cardio: 0, Rest: 0 };
  for (const session of sessionHistory) {
    if (!session?.date) continue;
    const sessionDate = parseLocalDate(session.date);
    // Half-open [weekStart, weekEnd) so a stray future-dated entry cannot be
    // counted against this week's targets.
    if (sessionDate >= weekStart && sessionDate < weekEnd) {
      counts[session.type] = (counts[session.type] ?? 0) + 1;
    }
  }
  return counts;
}
