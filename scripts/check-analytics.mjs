// Analytics checks. Pure computation over synthetic history — no storage, no
// DOM. Run with `npm run check:analytics`.

import {
  weeklySeries,
  consistency,
  weekStreak,
  estimate1RM,
  loggedExercises,
  strengthSeries,
  progressionOutcome,
  progressionSummary,
  cardioSeries,
  cardioFieldsPresent,
  CARDIO_GAPS,
  muscleVolume,
  readinessSeries,
  readinessVsTraining,
  EST_1RM_MAX_REPS,
} from '../src/lib/analytics.js';

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`  ASSERT FAILED: ${msg}`);
    failures++;
  }
};

// A fixed reference so the windowing is deterministic. 2026-08-14 is a Friday.
const REF = new Date('2026-08-14T12:00:00');
const GOALS = { liftsPerWeek: 2, cardioPerWeek: 2 };

const lift = (date, location, exercises) => ({ id: date, type: 'Lift', date, location, exercises });
const cardio = (date, location, targetMinutes) => ({
  id: `c${date}`,
  type: 'Cardio',
  date,
  location,
  targetMinutes,
  band: 'Yellow',
});
const entry = (id, name, sets, extra = {}) => ({
  exerciseId: id,
  name,
  variationGroup: 'g',
  pattern: 'squat',
  sets,
  ...extra,
});
const s = (reps, weight) => ({ reps, weight, rpe: null });

// --- 1. weekly buckets ----------------------------------------------------
console.log('=== weekly buckets ===');
{
  const history = [
    lift('2026-08-10', 'Work', [entry('a', 'A', [s(10, 100)])]), // Mon, this week
    cardio('2026-08-12', 'Home', 30), // Wed, this week
    lift('2026-08-03', 'Work', [entry('a', 'A', [s(10, 95)])]), // previous week
  ];

  const series = weeklySeries(history, { weeks: 12, reference: REF });
  assert(series.length === 12, `expected 12 weeks, got ${series.length}`);
  assert(series[11].isCurrent, 'the last row must be the current week');

  const current = series[11];
  assert(current.Lift === 1 && current.Cardio === 1, `this week: ${JSON.stringify(current)}`);
  assert(series[10].Lift === 1, 'the previous week must hold the 2026-08-03 lift');

  // Monday is the first day of the week. Under UTC-midnight parsing, a Monday
  // session lands in the PREVIOUS week — the bug that made cardio read 1/2.
  const monday = weeklySeries([lift('2026-08-10', 'Work', [])], { weeks: 2, reference: REF });
  assert(monday[1].Lift === 1, 'a Monday session belongs to the week it starts');

  // Empty weeks are present as zeroes, not dropped. A gap is data.
  const sparse = weeklySeries([lift('2026-08-10', 'Work', [])], { weeks: 12, reference: REF });
  assert(sparse.length === 12, 'weeks with nothing logged must still be rows');
  assert(
    sparse.filter((w) => w.Lift === 0).length === 11,
    'the other eleven weeks must be present and zero',
  );
  console.log('  12 rows, Monday-correct, empty weeks kept as zeroes');

  // Across a DST transition a week is 167 or 169 hours, not 168. Bucketing by
  // millisecond division and FLOORING files a session a week early every
  // spring: spring-forward makes the span an hour SHORT, so 6.994 weeks floors
  // to 6. (Autumn is harmless — an hour long floors to the right week anyway,
  // which is why this test has to straddle March and not November.)
  const dstRef = new Date('2026-04-10T12:00:00');
  const spanning = weeklySeries(
    [
      lift('2026-03-16', 'Work', []), // Monday after spring-forward
      lift('2026-02-23', 'Work', []), // Monday before it
    ],
    { weeks: 12, reference: dstRef },
  );
  const placed = spanning.filter((w) => w.Lift > 0).map((w) => w.weekStart);
  assert(
    placed.includes('2026-03-16') && placed.includes('2026-02-23'),
    `sessions must land in their own weeks across a DST change, got ${placed.join(', ')}`,
  );
  console.log('  weeks bucket correctly across a DST transition');
}

// --- 2. consistency and streak -------------------------------------------
console.log('\n=== consistency ===');
{
  // Build four completed weeks that each fully meet 2 + 2, plus a partial
  // current week.
  const history = [];
  for (let w = 1; w <= 4; w++) {
    const monday = new Date('2026-08-10T12:00:00');
    monday.setDate(monday.getDate() - w * 7);
    const iso = (offset) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    history.push(lift(iso(0), 'Work', []), lift(iso(2), 'Work', []));
    history.push(cardio(iso(1), 'Home', 30), cardio(iso(3), 'Home', 30));
  }

  const series = weeklySeries(history, { weeks: 12, reference: REF });
  const stats = consistency(series, GOALS, { reference: REF });

  assert(stats.weeksMet === 4, `four full weeks expected, got ${stats.weeksMet}`);
  assert(stats.weeksCounted === 11, `the current week must be excluded, got ${stats.weeksCounted}`);

  // Partial credit: 16 of 44 possible sessions across 11 completed weeks.
  assert(stats.percent === Math.round((16 / 44) * 100), `credit-based percent, got ${stats.percent}`);
  console.log(`  ${stats.percent}% with partial credit, ${stats.weeksMet} weeks fully met`);

  // A three-of-four week scores 75%, not 0. This is the whole reason the
  // measure is credit-based rather than pass/fail.
  const nearMiss = weeklySeries(
    [
      lift('2026-08-03', 'Work', []),
      lift('2026-08-05', 'Work', []),
      cardio('2026-08-06', 'Home', 30),
    ],
    { weeks: 2, reference: REF },
  );
  const nm = consistency(nearMiss, GOALS, { reference: REF });
  assert(nm.percent === 75, `three of four should be 75%, got ${nm.percent}`);
  assert(nm.weeksMet === 0, 'and it is still not a fully-met week');
  console.log('  a three-of-four week reads as 75%, not as a failure');

  // The in-progress week neither breaks nor pads a streak.
  const streakHistory = [...history];
  const withEmptyCurrent = weeklySeries(streakHistory, { weeks: 12, reference: REF });
  assert(
    weekStreak(withEmptyCurrent, GOALS) === 4,
    `an empty current week must not break a 4-week streak, got ${weekStreak(withEmptyCurrent, GOALS)}`,
  );

  streakHistory.push(
    lift('2026-08-10', 'Work', []),
    lift('2026-08-11', 'Work', []),
    cardio('2026-08-12', 'Home', 30),
    cardio('2026-08-13', 'Home', 30),
  );
  const withFullCurrent = weeklySeries(streakHistory, { weeks: 12, reference: REF });
  assert(
    weekStreak(withFullCurrent, GOALS) === 5,
    `a completed current week must extend it, got ${weekStreak(withFullCurrent, GOALS)}`,
  );
  console.log('  an in-progress week neither breaks nor pads the streak');
}

// --- 3. estimated 1RM -----------------------------------------------------
console.log('\n=== estimated 1RM ===');
{
  assert(estimate1RM(100, 1) === 103, `Epley at 1 rep, got ${estimate1RM(100, 1)}`);
  assert(estimate1RM(100, 10) === 133, `Epley at 10 reps, got ${estimate1RM(100, 10)}`);

  // Epley runs away above about a dozen reps: a 20-rep set would "estimate"
  // a 1RM of 167 off 100 lb. Report nothing rather than nonsense.
  assert(estimate1RM(100, EST_1RM_MAX_REPS + 1) === null, 'must refuse beyond the honest rep range');
  assert(estimate1RM(100, 20) === null, 'a 20-rep set has no credible 1RM estimate');
  assert(estimate1RM(null, 5) === null && estimate1RM(100, null) === null, 'missing data -> null');
  assert(estimate1RM(0, 5) === null, 'a bodyweight set has no 1RM estimate');
  console.log(`  Epley up to ${EST_1RM_MAX_REPS} reps, null above it`);
}

// --- 4. strength series ---------------------------------------------------
console.log('\n=== strength series ===');
{
  const history = [
    lift('2026-08-12', 'Home', [
      entry('sq', 'Squat', [s(10, 50), s(10, 50)], { suggestedWeight: 52.5 }),
    ]),
    lift('2026-08-05', 'Work', [
      entry('sq', 'Squat', [s(10, 135), s(10, 135), s(8, 135)], { suggestedWeight: 135 }),
    ]),
    lift('2026-07-29', 'Work', [entry('sq', 'Squat', [s(10, 130)])]),
    lift('2026-07-22', 'Work', [entry('row', 'Row', [s(10, 100)])]),
  ];

  const points = strengthSeries(history, 'sq');
  assert(points.length === 3, `three sessions expected, got ${points.length}`);
  assert(points[0].date === '2026-07-29', 'points must run oldest first');

  // Location travels with the point and is NOT normalised away.
  assert(points[2].location === 'Home', 'the Home session must be marked as Home');
  assert(points[1].location === 'Work', 'the Work session must be marked as Work');
  assert(
    points[2].topWeight === 50 && points[1].topWeight === 135,
    'no normalisation may be applied across locations',
  );

  // Volume is per session, over loaded sets only.
  assert(points[1].volume === 135 * 28, `volume for 10+10+8 at 135, got ${points[1].volume}`);

  // Progression annotation.
  assert(points[1].progression === 'met', 'worked at the suggested weight -> met');
  assert(points[2].progression === 'under', '50 against a suggested 52.5 -> under');
  assert(points[0].progression === null, 'a session with no recorded suggestion -> null');
  console.log('  oldest-first, location preserved, progression annotated');

  // Ranking for the picker.
  const ranked = loggedExercises(history);
  assert(ranked[0].exerciseId === 'sq', `most-logged first, got ${ranked[0]?.exerciseId}`);
  assert(ranked[0].sessions === 3, `squat logged 3 times, got ${ranked[0].sessions}`);
  assert(ranked.length === 2, `two exercises with load, got ${ranked.length}`);

  // Bodyweight-only entries never appear — there is no weight to trend.
  const withBodyweight = loggedExercises([
    ...history,
    lift('2026-08-13', 'Home', [entry('plank', 'Plank', [{ reps: null, weight: null, rpe: null }])]),
  ]);
  assert(!withBodyweight.some((e) => e.exerciseId === 'plank'), 'unloaded work has nothing to trend');
  console.log('  picker ranks by session count and skips unloaded movements');

  // One session is a legitimate series, not an empty state.
  const single = strengthSeries([lift('2026-08-12', 'Work', [entry('x', 'X', [s(5, 100)])])], 'x');
  assert(single.length === 1, 'a single session must produce a single point');
  console.log('  one logged session is one point, not an empty state');
}

// --- 5. progression summary ----------------------------------------------
console.log('\n=== progression summary ===');
{
  assert(progressionOutcome(100, 105) === 'met', 'above the suggestion is met');
  assert(progressionOutcome(100, 100) === 'met', 'exactly the suggestion is met');
  assert(progressionOutcome(100, 95) === 'under', 'below it is under');
  assert(progressionOutcome(null, 100) === null, 'no suggestion is not a judgement');

  const summary = progressionSummary([
    lift('2026-08-12', 'Work', [
      entry('a', 'A', [s(10, 105)], { suggestedWeight: 100 }),
      entry('b', 'B', [s(10, 90)], { suggestedWeight: 100 }),
      entry('c', 'C', [s(10, 50)]),
    ]),
  ]);
  assert(summary.met === 1 && summary.under === 1, `1 met / 1 under, got ${JSON.stringify(summary)}`);
  assert(summary.unrecorded === 1, 'entries with no suggestion are counted separately');
  assert(summary.rate === 50, `rate over judged entries only, got ${summary.rate}`);
  console.log('  rate is over entries that HAD a suggestion, not over all history');
}

// --- 6. cardio, including what is missing --------------------------------
console.log('\n=== cardio ===');
{
  const history = [cardio('2026-08-12', 'Home', 30), cardio('2026-08-05', 'Work', 45)];
  const points = cardioSeries(history);
  assert(points.length === 2, `two cardio sessions, got ${points.length}`);
  assert(points[0].date === '2026-08-05', 'oldest first');
  assert(points[0].targetMinutes === 45, 'target minutes carried through');

  // The gap is reported, not papered over. Nothing logs distance, structure,
  // modality or actual duration, and inventing any of them would be fiction.
  const present = cardioFieldsPresent(history);
  assert(present.size === 0, 'none of the gap fields exist in real cardio data');
  for (const gap of CARDIO_GAPS) {
    assert(
      history.every((h) => h[gap.field] == null),
      `${gap.field} must genuinely be absent, or the gap list is wrong`,
    );
  }
  assert(
    CARDIO_GAPS.some((g) => g.field === 'structure'),
    'structure type must be declared as a known gap',
  );
  console.log(`  ${CARDIO_GAPS.length} fields declared missing and genuinely absent from the data`);

  // If logging ever starts recording one, the screen stops calling it missing.
  const later = cardioFieldsPresent([{ ...history[0], distance: 3.1 }]);
  assert(later.has('distance'), 'a field that starts being logged must stop being reported missing');
  console.log('  a field that starts being logged is detected automatically');
}

// --- 7. muscle volume -----------------------------------------------------
console.log('\n=== muscle volume ===');
{
  const library = [
    { id: 'bench', primaryMuscles: ['chest', 'triceps'] },
    { id: 'squat', primaryMuscles: ['quads'] },
    { id: 'plank', primaryMuscles: ['core'] },
  ];
  const history = [
    lift('2026-08-12', 'Work', [
      entry('bench', 'Bench', [s(10, 100)]), // 1000 lb across chest + arms
      entry('squat', 'Squat', [s(10, 200)]), // 2000 lb to quads
      entry('plank', 'Plank', [{ reps: null, weight: null, rpe: null }]), // no load
    ]),
  ];

  const rows = muscleVolume(history, library, { weeks: 8, reference: REF });
  const find = (region) => rows.find((r) => r.region === region);

  assert(find('quads').volume === 2000, `quads, got ${find('quads')?.volume}`);
  // Split, not duplicated: 1000 lb across two regions is 500 each, so the
  // totals still add up to the 3000 lb actually lifted.
  assert(find('chest').volume === 500, `chest should be half the bench, got ${find('chest')?.volume}`);
  assert(find('arms').volume === 500, `arms should be the other half, got ${find('arms')?.volume}`);
  const total = rows.reduce((n, r) => n + r.volume, 0);
  assert(total === 3000, `totals must equal what was lifted (3000), got ${total}`);
  console.log('  volume splits across primary muscles; totals equal what was lifted');

  // Unloaded work contributes no volume but must still show as sets, or a
  // volume-only view says the core is neglected while you plank every week.
  assert(find('core').volume === 0, 'a plank carries no load volume');
  assert(find('core').sets === 1, `but it is still a working set, got ${find('core')?.sets}`);
  console.log('  unloaded work counts as sets even at zero volume');

  // Outside the window, nothing counts.
  const old = muscleVolume([lift('2026-01-01', 'Work', [entry('squat', 'Squat', [s(10, 200)])])], library, {
    weeks: 8,
    reference: REF,
  });
  assert(old.length === 0, 'sessions outside the rolling window must not be counted');
  console.log('  the rolling window actually rolls');
}

// --- 8. readiness vs what was done ---------------------------------------
console.log('\n=== readiness ===');
{
  const log = [
    { date: '2026-08-12', score: 82, band: 'Green' },
    { date: '2026-08-11', score: 40, band: 'Orange' },
    { date: '2026-08-10', score: 75, band: 'Yellow' },
  ];
  const history = [
    lift('2026-08-12', 'Work', []),
    lift('2026-08-10', 'Home', []),
    cardio('2026-08-10', 'Home', 30),
  ];

  const series = readinessSeries(log, history, { days: 90, reference: REF });
  assert(series.length === 3, `three scored days, got ${series.length}`);
  assert(series[0].date === '2026-08-10', 'oldest first');

  // A day with a score and NO session is kept — a rest day after a low score
  // is the correlation working, and dropping it hides the evidence.
  assert(series[1].sessionType === null, 'a scored day with no session must survive');
  assert(series[1].score === 40, 'and keep its score');

  // A day with both reads as the lift: the harder session is the one readiness
  // was mainly deciding about.
  assert(series[0].sessionType === 'Lift', `a lift+cardio day reads as Lift, got ${series[0].sessionType}`);

  const buckets = readinessVsTraining(series);
  const lifts = buckets.find((b) => b.type === 'Lift');
  const none = buckets.find((b) => b.type === 'None');
  assert(lifts.days === 2 && lifts.average === Math.round((82 + 75) / 2), 'lift-day average');
  assert(none.days === 1 && none.average === 40, 'untrained-day average');
  assert(lifts.average > none.average, 'the ordering that says recommendations are tracking');
  console.log(`  lift days averaged ${lifts.average}, untrained days ${none.average}`);

  // Entries without a score are not plotted as zero.
  const withBlank = readinessSeries([...log, { date: '2026-08-09', score: null }], history, {
    days: 90,
    reference: REF,
  });
  assert(withBlank.length === 3, 'a scoreless entry must not become a zero on the chart');
  console.log('  a scoreless entry is omitted, never plotted as zero');
}

// --- 9. nothing at all ----------------------------------------------------
// The screen renders on day one, before anything has been logged.
console.log('\n=== empty history ===');
{
  const series = weeklySeries([], { weeks: 12, reference: REF });
  const stats = consistency(series, GOALS, { reference: REF });
  assert(series.length === 12, 'the weekly chart still has its weeks');
  assert(stats.percent === 0, `an empty but counted window is 0%, got ${stats.percent}`);
  assert(stats.streak === 0, 'no streak');
  assert(loggedExercises([]).length === 0, 'no exercises to pick');
  assert(strengthSeries([], 'x').length === 0, 'no strength points');
  assert(cardioSeries([]).length === 0, 'no cardio points');
  assert(muscleVolume([], [], { reference: REF }).length === 0, 'no muscle rows');
  assert(readinessSeries([], [], { reference: REF }).length === 0, 'no readiness points');
  assert(readinessVsTraining([]).length === 0, 'no buckets');
  assert(progressionSummary([]).rate === null, 'no rate to report, rather than 0%');
  console.log('  every computation handles a completely empty history');
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
