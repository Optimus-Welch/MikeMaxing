// Helpers for tallying sessions within the current Monday-start week.

export function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const isoWeekday = d.getDay() === 0 ? 7 : d.getDay(); // Mon = 1 ... Sun = 7
  d.setDate(d.getDate() - (isoWeekday - 1));
  return d;
}

export function todayISO(date = new Date()) {
  // Local calendar date (not UTC), so "today" matches the user's clock.
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

// { Lift, Cardio, Rest } counts of sessions logged since the start of the
// current week, up to and including `referenceDate`.
export function weeklyCounts(sessionHistory, referenceDate = new Date()) {
  const weekStart = startOfWeek(referenceDate);
  const counts = { Lift: 0, Cardio: 0, Rest: 0 };
  for (const session of sessionHistory) {
    const sessionDate = new Date(session.date);
    if (sessionDate >= weekStart) {
      counts[session.type] = (counts[session.type] ?? 0) + 1;
    }
  }
  return counts;
}
