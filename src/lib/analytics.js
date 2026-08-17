// Analytics: everything the trends screen displays, computed from history.
//
// Pure functions over sessionHistory and readinessLog. Nothing here writes,
// and nothing here changes how a session is logged — this is a read layer over
// data that already exists.
//
// Two honesty rules run through the whole file:
//   1. Sparse history renders as sparse, never as hidden. One session is one
//      point on a chart, not an empty state telling you to come back later.
//   2. A number that cannot be computed from what was logged is reported as
//      absent, never estimated into existence. See CARDIO_GAPS.

import { parseLocalDate, startOfWeek, todayISO } from './weekly.js';
import { regionFor } from './muscleMap.js';

// -- shared ----------------------------------------------------------------

const liftSessions = (history) =>
  (history ?? []).filter((s) => s?.type === 'Lift' && Array.isArray(s.exercises));

const loadedSets = (entry) =>
  (entry?.sets ?? []).filter(
    (s) => s.weight != null && s.weight !== '' && s.reps != null && s.reps !== '',
  );

const dayKey = (d) => todayISO(d);

/** Sessions oldest-first. History is stored newest-first. */
function chronological(history) {
  return [...(history ?? [])].filter((s) => s?.date).sort((a, b) => a.date.localeCompare(b.date));
}

// -- 1. consistency --------------------------------------------------------

/**
 * One row per week, oldest first, covering `weeks` weeks up to and including
 * the week containing `reference`.
 *
 * Weeks with nothing logged are present with zeroes rather than missing. A gap
 * you took off is data — dropping the row would draw a chart that quietly
 * closes over it.
 */
export function weeklySeries(history, { weeks = 12, reference = new Date() } = {}) {
  const thisWeek = startOfWeek(reference);
  const rows = [];

  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    rows.push({
      weekStart: dayKey(start),
      label: `${start.getMonth() + 1}/${start.getDate()}`,
      isCurrent: i === 0,
      Lift: 0,
      Cardio: 0,
      Rest: 0,
    });
  }

  const firstStart = parseLocalDate(rows[0].weekStart);
  for (const session of history ?? []) {
    if (!session?.date) continue;
    const d = parseLocalDate(session.date);
    if (d < firstStart) continue;
    // Rounded, not floored. A week is only exactly 7 × 24 h when no DST
    // transition falls inside it; across one it is 167 or 169 hours, and
    // flooring 6.994 weeks gives 6 — quietly filing a session into the wrong
    // bucket twice a year. Week starts are always a whole number of weeks
    // apart, so rounding is exact rather than a fudge.
    const idx = Math.round((startOfWeek(d) - firstStart) / (7 * 24 * 3600 * 1000));
    const row = rows[idx];
    if (!row) continue;
    row[session.type] = (row[session.type] ?? 0) + 1;
  }

  return rows;
}

/**
 * How close the weeks came to the targets.
 *
 * Two deliberate choices, both worth knowing about:
 *
 * `percent` is credit-based, not pass/fail: the sum of min(done, target) over
 * the sum of targets. Three of four sessions in every week scores 75%, where a
 * "weeks fully met" measure would score 0% and tell you nothing useful about a
 * near miss.
 *
 * The CURRENT week is excluded from the percentage, because it is partly in
 * the future — counting Tuesday against a full week's target would drag the
 * number down every Monday and recover it every Sunday.
 */
export function consistency(series, goals, { reference = new Date() } = {}) {
  const target = (goals?.liftsPerWeek ?? 0) + (goals?.cardioPerWeek ?? 0);
  const completed = series.filter((w) => !w.isCurrent);

  let earned = 0;
  let possible = 0;
  let weeksMet = 0;
  for (const week of completed) {
    earned += Math.min(week.Lift, goals?.liftsPerWeek ?? 0);
    earned += Math.min(week.Cardio, goals?.cardioPerWeek ?? 0);
    possible += target;
    if (met(week, goals)) weeksMet++;
  }

  return {
    percent: possible > 0 ? Math.round((earned / possible) * 100) : null,
    weeksMet,
    weeksCounted: completed.length,
    streak: weekStreak(series, goals),
    totalSessions: series.reduce((n, w) => n + w.Lift + w.Cardio, 0),
    reference: dayKey(reference),
  };
}

const met = (week, goals) =>
  week.Lift >= (goals?.liftsPerWeek ?? 0) && week.Cardio >= (goals?.cardioPerWeek ?? 0);

/**
 * Consecutive weeks hitting both targets, counting back from now.
 *
 * The current week only counts if it has ALREADY met the targets. A week you
 * are three days into has not failed, so it must not break a streak — but it
 * has not succeeded either, so it must not pad one.
 */
export function weekStreak(series, goals) {
  let streak = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    const week = series[i];
    if (met(week, goals)) {
      streak++;
      continue;
    }
    if (week.isCurrent) continue; // in progress: neither breaks nor extends
    break;
  }
  return streak;
}

// -- 2. strength -----------------------------------------------------------

// Epley. Reliable in the rep ranges this app actually prescribes and wildly
// optimistic above them — a 20-rep set would "estimate" a 1RM nobody could
// lift. Anything over this many reps reports no estimate rather than a bad one.
export const EST_1RM_MAX_REPS = 12;

export function estimate1RM(weight, reps) {
  if (weight == null || reps == null) return null;
  const w = Number(weight);
  const r = Number(reps);
  if (!Number.isFinite(w) || !Number.isFinite(r) || r < 1 || w <= 0) return null;
  if (r > EST_1RM_MAX_REPS) return null;
  return Math.round(w * (1 + r / 30));
}

/** Exercises you have actually logged, most-logged first. */
export function loggedExercises(history) {
  const counts = new Map();
  for (const session of liftSessions(history)) {
    for (const entry of session.exercises) {
      if (!loadedSets(entry).length) continue;
      const current = counts.get(entry.exerciseId) ?? {
        exerciseId: entry.exerciseId,
        name: entry.name,
        sessions: 0,
        lastDate: null,
      };
      current.sessions++;
      current.name = current.name ?? entry.name;
      if (!current.lastDate || session.date > current.lastDate) current.lastDate = session.date;
      counts.set(entry.exerciseId, current);
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.sessions - a.sessions || String(b.lastDate).localeCompare(String(a.lastDate)),
  );
}

/**
 * One point per session for a single exercise, oldest first.
 *
 * Location travels with each point and is NOT normalised away. Home caps
 * dumbbells at 52.5 and the barbell at 80, so a Home point sitting below a
 * Work point is usually the equipment talking, not you. Any attempt to bridge
 * the two would be inventing a number; the chart marks which is which and
 * leaves the reading to you.
 */
export function strengthSeries(history, exerciseId) {
  const points = [];

  for (const session of chronological(liftSessions(history))) {
    const entry = session.exercises.find((e) => e.exerciseId === exerciseId);
    if (!entry) continue;
    const sets = loadedSets(entry);
    if (!sets.length) continue;

    const top = sets.reduce((a, b) =>
      Number(b.weight) > Number(a.weight) ||
      (Number(b.weight) === Number(a.weight) && Number(b.reps) > Number(a.reps))
        ? b
        : a,
    );

    const volume = sets.reduce((sum, s) => sum + Number(s.weight) * Number(s.reps), 0);

    points.push({
      date: session.date,
      location: session.location ?? null,
      topWeight: Number(top.weight),
      topReps: Number(top.reps),
      est1RM: estimate1RM(top.weight, top.reps),
      volume,
      sets: sets.length,
      // Recorded only since progressive overload shipped. Null on anything
      // logged before that, which is why the summary counts what it can rather
      // than assuming a missing suggestion means one was ignored.
      suggestedWeight: entry.suggestedWeight ?? null,
      progression: progressionOutcome(entry.suggestedWeight, Number(top.weight)),
    });
  }

  return points;
}

/**
 * Did the suggested increase actually land?
 *
 *   'met'     you worked at or above what was suggested
 *   'under'   you worked below it
 *   null      no suggestion was recorded for that session
 *
 * "Under" is not failure. A suggestion is a suggestion, and overriding one is
 * a supported action — this measures whether progression is tracking reality,
 * which is exactly as informative when the answer is no.
 */
export function progressionOutcome(suggested, actual) {
  if (suggested == null || !Number.isFinite(Number(actual))) return null;
  return Number(actual) >= Number(suggested) ? 'met' : 'under';
}

/** How often suggestions are landing, across every exercise. */
export function progressionSummary(history) {
  let met = 0;
  let under = 0;
  let unrecorded = 0;

  for (const session of liftSessions(history)) {
    for (const entry of session.exercises) {
      const sets = loadedSets(entry);
      if (!sets.length) continue;
      const topWeight = Math.max(...sets.map((s) => Number(s.weight)));
      const outcome = progressionOutcome(entry.suggestedWeight, topWeight);
      if (outcome === 'met') met++;
      else if (outcome === 'under') under++;
      else unrecorded++;
    }
  }

  const judged = met + under;
  return { met, under, unrecorded, judged, rate: judged ? Math.round((met / judged) * 100) : null };
}

// -- 3. cardio -------------------------------------------------------------

/**
 * What cardio logging does NOT capture. Surfaced in the UI rather than
 * silently omitted, because a "Cardio trends" screen that shows no distance is
 * otherwise indistinguishable from one that thinks you never ran.
 *
 * A cardio session is logged as { type, location, date, band, targetMinutes }.
 * There is no generator for cardio yet, so nothing ever asked for a structure,
 * a modality or a distance, and nothing recorded one. Adding them is a logging
 * change, which this screen deliberately is not.
 */
export const CARDIO_GAPS = [
  { field: 'distance', label: 'Distance' },
  { field: 'structure', label: 'Structure (base / tempo / intervals / recovery)' },
  { field: 'modality', label: 'Run vs bike' },
  { field: 'actualMinutes', label: 'Minutes actually done (only the target is stored)' },
];

/**
 * One point per cardio session, oldest first.
 *
 * `targetMinutes` is what readiness prescribed that day, not what you did —
 * they are usually the same thing, but the chart says "target" because that is
 * what the number honestly is.
 */
export function cardioSeries(history) {
  return chronological(history)
    .filter((s) => s.type === 'Cardio')
    .map((s) => ({
      date: s.date,
      location: s.location ?? null,
      band: s.band ?? null,
      targetMinutes: s.targetMinutes ?? null,
    }));
}

/** Which of the gap fields, if any, have turned up in the data after all. */
export function cardioFieldsPresent(history) {
  const present = new Set();
  for (const s of history ?? []) {
    if (s?.type !== 'Cardio') continue;
    for (const { field } of CARDIO_GAPS) {
      if (s[field] != null && s[field] !== '') present.add(field);
    }
  }
  return present;
}

// -- 4. volume by muscle group --------------------------------------------

/**
 * Load-volume and working sets per body region over a rolling window.
 *
 * An exercise's volume is SPLIT evenly across its primary muscles rather than
 * counted in full against each. Counting in full would make a bench press
 * contribute its whole tonnage to chest AND triceps, so the totals would sum
 * to more than you lifted and every compound-heavy region would look inflated.
 *
 * Sets are counted alongside volume and are the more honest signal for the
 * regions this library trains without external load — core work and carries
 * contribute no tonnage at all, so a volume-only view says your core is being
 * neglected while you plank three times a week.
 */
export function muscleVolume(history, library, { weeks = 8, reference = new Date() } = {}) {
  const since = new Date(startOfWeek(reference));
  since.setDate(since.getDate() - (weeks - 1) * 7);

  const byRegion = new Map();
  const bump = (region, volume, sets) => {
    const row = byRegion.get(region) ?? { region, volume: 0, sets: 0 };
    row.volume += volume;
    row.sets += sets;
    byRegion.set(region, row);
  };

  for (const session of liftSessions(history)) {
    if (parseLocalDate(session.date) < since) continue;

    for (const entry of session.exercises) {
      const exercise = (library ?? []).find((e) => e.id === entry.exerciseId);
      const muscles = exercise?.primaryMuscles ?? [];
      if (!muscles.length) continue;

      const regions = [...new Set(muscles.map(regionFor).filter(Boolean))];
      if (!regions.length) continue;

      const sets = entry.sets ?? [];
      const volume = loadedSets(entry).reduce(
        (sum, s) => sum + Number(s.weight) * Number(s.reps),
        0,
      );

      for (const region of regions) bump(region, volume / regions.length, sets.length / regions.length);
    }
  }

  return [...byRegion.values()]
    .map((r) => ({ ...r, volume: Math.round(r.volume), sets: Math.round(r.sets * 10) / 10 }))
    .sort((a, b) => b.volume - a.volume || b.sets - a.sets);
}

// -- 5. readiness ----------------------------------------------------------

/**
 * Readiness by day, with what was actually trained that day beside it.
 *
 * The question this answers is whether the recommendations track how you
 * actually felt — so the session is joined ON THE DAY, and days with a score
 * and no session are kept. A rest day following a low score is the correlation
 * working, and dropping those rows would hide exactly the evidence you want.
 */
export function readinessSeries(readinessLog, history, { days = 60, reference = new Date() } = {}) {
  const since = new Date(reference);
  since.setDate(since.getDate() - days);
  const sinceKey = dayKey(since);

  const sessionsByDate = new Map();
  for (const session of history ?? []) {
    if (!session?.date) continue;
    const list = sessionsByDate.get(session.date) ?? [];
    list.push(session);
    sessionsByDate.set(session.date, list);
  }

  return [...(readinessLog ?? [])]
    .filter((e) => e?.date && e.date >= sinceKey && e.score != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => {
      const sessions = sessionsByDate.get(entry.date) ?? [];
      // A day with both a lift and cardio reads as the lift: it is the harder
      // session and the one readiness was mainly deciding about.
      const lift = sessions.find((s) => s.type === 'Lift');
      const done = lift ?? sessions[0] ?? null;
      return {
        date: entry.date,
        score: Number(entry.score),
        band: entry.band ?? null,
        sessionType: done?.type ?? null,
        location: done?.location ?? null,
      };
    });
}

/**
 * Did harder days follow better scores?
 *
 * Reported as plain averages per session type rather than a correlation
 * coefficient. With a few dozen points a Pearson r is a number people read far
 * more confidence into than it earns; "your average score on lift days was 74
 * against 51 on rest days" is the same finding without the false precision.
 */
export function readinessVsTraining(series) {
  const buckets = new Map();
  for (const point of series) {
    const key = point.sessionType ?? 'None';
    const row = buckets.get(key) ?? { type: key, days: 0, total: 0 };
    row.days++;
    row.total += point.score;
    buckets.set(key, row);
  }

  const order = { Lift: 0, Cardio: 1, Rest: 2, None: 3 };
  return [...buckets.values()]
    .map((r) => ({ ...r, average: Math.round(r.total / r.days) }))
    .sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
}
