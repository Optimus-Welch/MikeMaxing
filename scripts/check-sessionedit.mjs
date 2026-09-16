// Editing a logged session. Run with `npm run check:sessionedit`.
//
// The point of this file is the CONSISTENCY claim: after an edit, everything
// that reads sessionHistory must see the corrected numbers — progression's
// history lookups, the finish-screen stats, the charts, the weekly tally — and
// the things an edit must NOT move (date, type, location, what was prescribed)
// must be provably unmoved.

import {
  applySessionEdit,
  draftFromSession,
  editChangesAnything,
  numberOrNull,
} from '../src/lib/sessionEdit.js';
import { mergeCollection } from '../src/lib/mergeCollections.js';
import { lastPerformanceAt, suggestFor } from '../src/lib/progression.js';
import { summariseSession } from '../src/lib/sessionStats.js';
import { weeklyCounts } from '../src/lib/weekly.js';
import { cardioSeries, cardioMinutesSeries, cardioFieldsPresent, CARDIO_GAPS } from '../src/lib/analytics.js';
import { seedExerciseLibrary } from '../src/lib/exercises.js';

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`  ASSERT FAILED: ${msg}`);
    failures++;
  }
};

const liftSession = () => ({
  id: 'sess-1',
  type: 'Lift',
  location: 'Work',
  date: '2026-09-14',
  band: 'Yellow',
  templateId: 'A',
  templateName: 'A — Squat / Horizontal',
  seed: 42,
  startedAt: 1,
  endedAt: 2,
  exercises: [
    {
      exerciseId: 'back-squat',
      name: 'Back Squat',
      pattern: 'squat',
      variationGroup: 'back-squat',
      emphasis: 'primary',
      prescription: '4 × 12',
      targetSets: 4,
      targetReps: 12,
      targetSeconds: null,
      suggestedWeight: 135,
      sets: [
        { reps: 12, weight: 1350, rpe: null }, // the fat-fingered one
        { reps: 12, weight: 135, rpe: null },
        { reps: 12, weight: 135, rpe: null },
        { reps: 12, weight: 135, rpe: null },
      ],
    },
  ],
});

// --- 1. normalisation ------------------------------------------------------
console.log('=== typed input becomes stored data ===');
{
  assert(numberOrNull('') === null, 'blank is "not recorded", not 0');
  assert(numberOrNull('  ') === null, 'whitespace is blank');
  assert(numberOrNull('0') === 0, '0 is a real value and must survive');
  assert(numberOrNull('52.5') === 52.5, 'decimals survive');
  assert(numberOrNull('-5') === null, 'negatives are refused');
  assert(numberOrNull('abc') === null, 'nonsense is refused');
  console.log('  blank stays distinguishable from zero; negatives and junk are refused');
}

// --- 2. what an edit may and may not touch ---------------------------------
console.log('\n=== the edit is a correction, not a move ===');
{
  const session = liftSession();
  const draft = draftFromSession(session);
  draft.exercises[0].sets[0].weight = '135';

  const edited = applySessionEdit(session, draft, { now: 1000 });

  assert(edited.exercises[0].sets[0].weight === 135, 'the typo is corrected');
  assert(edited.editedAt === 1000, 'the edit is stamped');

  for (const key of ['id', 'type', 'location', 'date', 'band', 'templateId', 'seed', 'startedAt']) {
    assert(
      JSON.stringify(edited[key]) === JSON.stringify(session[key]),
      `${key} must be untouched by an edit, got ${JSON.stringify(edited[key])}`,
    );
  }
  const before = session.exercises[0];
  const after = edited.exercises[0];
  for (const key of ['targetSets', 'targetReps', 'prescription', 'suggestedWeight', 'emphasis']) {
    assert(after[key] === before[key], `${key} (what was ASKED for) must survive an edit`);
  }
  console.log('  sets change; id/date/type/location and every target are byte-identical');

  // Emptying a row removes the set; adding a row adds one.
  const drop = draftFromSession(session);
  drop.exercises[0].sets[3] = { reps: '', weight: '', rpe: '' };
  assert(applySessionEdit(session, drop).exercises[0].sets.length === 3, 'an emptied row is dropped');

  const add = draftFromSession(session);
  add.exercises[0].sets.push({ reps: '10', weight: '135', rpe: '7' });
  const added = applySessionEdit(session, add).exercises[0].sets;
  assert(added.length === 5 && added[4].rpe === 7, 'a new row is kept, RPE included');

  // Saving an untouched draft must be a no-op, or every open-and-close would
  // restamp the session and re-queue an upload.
  assert(!editChangesAnything(session, draftFromSession(session)), 'an untouched draft is not a change');
  assert(editChangesAnything(session, draft), 'a real change is detected');
  console.log('  rows can be cleared and added; an untouched draft is not a change');
}

// --- 3. everything downstream sees the correction --------------------------
console.log('\n=== readers agree with the corrected data ===');
{
  const session = liftSession();
  const draft = draftFromSession(session);
  draft.exercises[0].sets[0].weight = '135';
  const edited = applySessionEdit(session, draft);

  // progression: the top set drove the suggestion, and 1350 lb was it.
  const before = lastPerformanceAt([session], 'back-squat', 'Work');
  const after = lastPerformanceAt([edited], 'back-squat', 'Work');
  assert(Number(before.topSet.weight) === 1350, 'precondition: the typo was the top set');
  assert(Number(after.topSet.weight) === 135, `progression must read 135, got ${after.topSet.weight}`);

  const suggestion = suggestFor({
    exercise: { id: 'back-squat', equipment: ['barbell'] },
    location: 'Work',
    sessionHistory: [edited],
    target: { sets: 4, reps: 12, repFloor: 10, repCeiling: 15 },
    entry: { exerciseId: 'back-squat', variationGroup: 'back-squat', pattern: 'squat' },
  });
  assert(
    suggestion.weight === 135,
    `the next suggestion must come off the corrected 135, got ${suggestion.weight}`,
  );

  // finish-screen stats / volume
  const performed = (s) =>
    s.exercises.flatMap((ex) => ex.sets.map((set) => ({ ...set, exerciseId: ex.exerciseId, name: ex.name })));
  const stats = summariseSession({
    performed: performed(edited),
    library: seedExerciseLibrary,
    history: [edited],
    sessionId: edited.id,
  });
  assert(stats.volume === 4 * 12 * 135, `volume must be 6480 from corrected sets, got ${stats.volume}`);

  // weekly counts key off date and type, which an edit cannot reach
  const week = weeklyCounts([edited], new Date('2026-09-16T12:00:00'));
  assert(week.Lift === 1, 'the session still counts once toward the week');
  console.log(`  progression 135, volume ${stats.volume}, weekly tally unchanged`);
}

// --- 4. cardio minutes and distance ----------------------------------------
console.log('\n=== cardio gains the numbers Trends was missing ===');
{
  const ride = {
    id: 'c1', type: 'Cardio', location: 'Home', date: '2026-09-15',
    band: 'Yellow', targetMinutes: 30,
  };
  const draft = draftFromSession(ride);
  assert(draft.exercises.length === 0, 'a cardio session has no set rows to edit');

  draft.meta.actualMinutes = '38';
  draft.meta.distance = '7.2';
  const edited = applySessionEdit(ride, draft);

  assert(edited.actualMinutes === 38 && edited.distance === 7.2, 'minutes and distance are stored');
  assert(edited.targetMinutes === 30, 'the prescribed target is not overwritten by the actual');

  const present = cardioFieldsPresent([edited]);
  assert(present.has('actualMinutes') && present.has('distance'),
    'analytics must now see both fields as present');
  const stillMissing = CARDIO_GAPS.filter((g) => !present.has(g.field)).map((g) => g.field);
  assert(stillMissing.join() === 'structure,modality',
    `only structure and modality should remain unlogged, got ${stillMissing.join()}`);

  const series = cardioMinutesSeries(cardioSeries([edited]));
  assert(series.rows[0].minutes === 38 && series.label === 'actual',
    `the chart must use the actual 38 and say so, got ${series.rows[0].minutes}/${series.label}`);

  const mixed = cardioMinutesSeries(cardioSeries([edited, { ...ride, id: 'c2', date: '2026-09-10' }]));
  assert(mixed.label === 'actual where recorded, otherwise target', `mixed series must say so, got ${mixed.label}`);

  // Clearing a field removes it rather than storing null, so the gap list is
  // honest again.
  const cleared = applySessionEdit(edited, { ...draft, meta: { actualMinutes: '', distance: '' } });
  assert(!('actualMinutes' in cleared) && !('distance' in cleared), 'cleared fields are removed');
  console.log('  38 min / 7.2 mi recorded, target preserved, gap list shrinks to structure+modality');
}

// --- 5. an edit survives sync ----------------------------------------------
console.log('\n=== the correction wins the merge ===');
{
  const stale = liftSession();
  const fixed = applySessionEdit(stale, (() => {
    const d = draftFromSession(stale);
    d.exercises[0].sets[0].weight = '135';
    return d;
  })(), { now: 5000 });

  const topWeight = (value) =>
    Number(value.find((s) => s.id === 'sess-1').exercises[0].sets[0].weight);

  // The edit is on the older-stamped side: another device logged something
  // afterwards, so its whole collection is newer — but it holds the stale copy.
  const remoteNewer = mergeCollection(
    'sessionHistory',
    { value: [fixed], updatedAt: 100 },
    { value: [stale, { id: 'other', type: 'Cardio', date: '2026-09-15' }], updatedAt: 999 },
  );
  assert(topWeight(remoteNewer.value) === 135,
    `the edited copy must win even when the other collection is newer, got ${topWeight(remoteNewer.value)}`);
  assert(remoteNewer.value.length === 2, 'and the other device\'s session is still kept');

  // ...and the same in the other direction.
  const localNewer = mergeCollection(
    'sessionHistory',
    { value: [stale], updatedAt: 999 },
    { value: [fixed], updatedAt: 100 },
  );
  assert(topWeight(localNewer.value) === 135, `symmetric case failed, got ${topWeight(localNewer.value)}`);

  // Two edits of the same session: the later one wins.
  const later = { ...fixed, editedAt: 9000, exercises: [{ ...fixed.exercises[0], sets: [{ reps: 11, weight: 140, rpe: null }] }] };
  const twoEdits = mergeCollection(
    'sessionHistory',
    { value: [fixed], updatedAt: 999 },
    { value: [later], updatedAt: 1 },
  );
  assert(topWeight(twoEdits.value) === 140, `the later edit must win, got ${topWeight(twoEdits.value)}`);

  // An unedited session pair still follows side order, as before.
  const untouched = mergeCollection(
    'sessionHistory',
    { value: [{ id: 'x', date: '2026-09-01', note: 'local' }], updatedAt: 999 },
    { value: [{ id: 'x', date: '2026-09-01', note: 'remote' }], updatedAt: 1 },
  );
  assert(untouched.value[0].note === 'local', 'unedited clashes still prefer the newer side');
  console.log('  an edit beats a stale copy in both directions; later edit beats earlier');
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
