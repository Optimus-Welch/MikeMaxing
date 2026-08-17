import { useMemo, useState } from 'react';
import { getProfile, getSessionHistory, getExerciseLibrary, getReadinessLog } from '../lib/db.js';
import { useCollection } from '../lib/useCollection.js';
import { REGION_LABELS } from '../lib/muscleMap.js';
import {
  weeklySeries,
  consistency,
  loggedExercises,
  strengthSeries,
  progressionSummary,
  cardioSeries,
  cardioFieldsPresent,
  CARDIO_GAPS,
  muscleVolume,
  readinessSeries,
  readinessVsTraining,
  EST_1RM_MAX_REPS,
} from '../lib/analytics.js';
import { LineChart, BarChart, RankedBars } from '../components/Chart.jsx';

// Trends over time. A read layer — nothing here writes, and nothing here
// changes how a session is logged.
//
// Sections render whatever exists rather than gating on a data threshold. A
// single logged session is a legitimate chart with one point on it; hiding it
// behind "not enough data" would mean the screen is emptiest exactly when you
// are most curious whether the thing is working.

const WEEKS = 12;
const MUSCLE_WEEKS = 8;

const shortDate = (iso) => {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
};

export default function Analytics() {
  const profile = useCollection('profile', getProfile);
  const sessionHistory = useCollection('sessionHistory', getSessionHistory);
  const readinessLog = useCollection('readinessLog', getReadinessLog);
  const library = useCollection('exerciseLibrary', getExerciseLibrary);

  const today = useMemo(() => new Date(), []);

  return (
    <>
      <h1 className="page-title">Trends</h1>
      <p className="page-sub">
        {sessionHistory.length} session{sessionHistory.length === 1 ? '' : 's'} logged
      </p>

      <Consistency history={sessionHistory} goals={profile.goals} reference={today} />
      <Strength history={sessionHistory} />
      <Cardio history={sessionHistory} />
      <MuscleVolume history={sessionHistory} library={library} reference={today} />
      <Readiness log={readinessLog} history={sessionHistory} reference={today} />
    </>
  );
}

// -- 1. consistency --------------------------------------------------------

function Consistency({ history, goals, reference }) {
  const series = useMemo(
    () => weeklySeries(history, { weeks: WEEKS, reference }),
    [history, reference],
  );
  const stats = useMemo(() => consistency(series, goals, { reference }), [series, goals, reference]);

  const rows = series.map((week) => ({
    label: week.label,
    values: [
      { key: 'Lift', value: week.Lift, tone: 'accent' },
      { key: 'Cardio', value: week.Cardio, tone: 'muted' },
    ],
  }));

  return (
    <section className="card">
      <h2>Consistency</h2>
      <p className="hint">
        Last {WEEKS} weeks against {goals.liftsPerWeek} lifts + {goals.cardioPerWeek} cardio.
      </p>

      <BarChart rows={rows} label="Sessions per week" target={goals.liftsPerWeek} />

      <div className="chart-legend">
        <span className="lg-item">
          <span className="lg-swatch is-accent" /> Lifts
        </span>
        <span className="lg-item">
          <span className="lg-swatch is-muted" /> Cardio
        </span>
        <span className="lg-item">
          <span className="lg-swatch is-target" /> Weekly lift target
        </span>
      </div>

      <div className="stat-row">
        <Stat value={stats.streak} label={`Week streak${stats.streak === 0 ? '' : ' 🔥'}`} />
        <Stat value={stats.percent == null ? '—' : `${stats.percent}%`} label="Consistency" />
        <Stat value={`${stats.weeksMet}/${stats.weeksCounted}`} label="Weeks fully met" />
      </div>

      <p className="hint">
        Consistency gives partial credit — three of four sessions in a week counts as 75%, not as a
        miss. The current week is excluded until it is over, so a Tuesday does not read as a failed
        week.
      </p>
    </section>
  );
}

function Stat({ value, label }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// -- 2. strength -----------------------------------------------------------

const METRICS = [
  { id: 'est1RM', label: 'Est. 1RM', unit: ' lb' },
  { id: 'volume', label: 'Volume', unit: ' lb' },
  { id: 'topWeight', label: 'Top set', unit: ' lb' },
];

function Strength({ history }) {
  const exercises = useMemo(() => loggedExercises(history), [history]);
  const [chosen, setChosen] = useState(null);
  const [metric, setMetric] = useState('est1RM');

  const exerciseId = chosen ?? exercises[0]?.exerciseId ?? null;
  const points = useMemo(
    () => (exerciseId ? strengthSeries(history, exerciseId) : []),
    [history, exerciseId],
  );
  const summary = useMemo(() => progressionSummary(history), [history]);

  const active = METRICS.find((m) => m.id === metric) ?? METRICS[0];
  const locations = [...new Set(points.map((p) => p.location).filter(Boolean))];

  const chartPoints = points.map((p) => ({
    x: shortDate(p.date),
    y: p[metric],
    // The dot says whether the suggested load was met that session. Grey means
    // there was no suggestion recorded — most history predates progression.
    tone: p.progression === 'met' ? 'accent' : p.progression === 'under' ? 'warn' : 'muted',
  }));

  const withoutEstimate = metric === 'est1RM' ? points.filter((p) => p.est1RM == null).length : 0;

  return (
    <section className="card">
      <h2>Strength progress</h2>

      {exercises.length === 0 ? (
        <p className="hint">
          No lifts logged with a weight yet. Finish a lift session and its exercises appear here.
        </p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="an-exercise">Exercise</label>
            <select
              id="an-exercise"
              value={exerciseId ?? ''}
              onChange={(e) => setChosen(e.target.value)}
            >
              {exercises.map((ex) => (
                <option key={ex.exerciseId} value={ex.exerciseId}>
                  {ex.name} · {ex.sessions} session{ex.sessions === 1 ? '' : 's'}
                </option>
              ))}
            </select>
            <p className="hint">Most-logged first.</p>
          </div>

          <div className="pill-group" role="group" aria-label="Metric">
            {METRICS.map((m) => (
              <button
                key={m.id}
                type="button"
                className="pill"
                aria-pressed={metric === m.id}
                onClick={() => setMetric(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <LineChart points={chartPoints} label={active.label} unit={active.unit} />

          <div className="chart-legend">
            <span className="lg-item">
              <span className="lg-swatch is-accent" /> Met the suggestion
            </span>
            <span className="lg-item">
              <span className="lg-swatch is-warn" /> Went under it
            </span>
            <span className="lg-item">
              <span className="lg-swatch is-muted" /> No suggestion recorded
            </span>
          </div>

          {locations.length > 0 && (
            <p className="hint">
              Logged at {locations.join(' and ')}.
              {locations.length > 1 &&
                ' Home caps dumbbells at 52.5 lb and the barbell at 80, so a lower Home point is usually the equipment, not you — these are not normalised against each other.'}
            </p>
          )}

          {withoutEstimate > 0 && (
            <p className="hint">
              {withoutEstimate} session{withoutEstimate === 1 ? '' : 's'} had no 1RM estimate — the
              formula is only honest up to {EST_1RM_MAX_REPS} reps. Switch to Volume or Top set to
              see {withoutEstimate === 1 ? 'it' : 'them'}.
            </p>
          )}

          <div className="stat-row">
            <Stat
              value={summary.rate == null ? '—' : `${summary.rate}%`}
              label="Suggestions met"
            />
            <Stat value={summary.judged} label="Sessions judged" />
            <Stat value={summary.unrecorded} label="Before progression" />
          </div>
          <p className="hint">
            Going under a suggestion is not a failure — overriding one is a supported move. This is
            here to show whether progression is tracking reality, which it tells you either way.
          </p>
        </>
      )}
    </section>
  );
}

// -- 3. cardio -------------------------------------------------------------

function Cardio({ history }) {
  const points = useMemo(() => cardioSeries(history), [history]);
  const present = useMemo(() => cardioFieldsPresent(history), [history]);
  const missing = CARDIO_GAPS.filter((g) => !present.has(g.field));

  const byLocation = points.reduce((acc, p) => {
    const key = p.location ?? 'Unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="card">
      <h2>Cardio</h2>

      <LineChart
        points={points.map((p) => ({ x: shortDate(p.date), y: p.targetMinutes }))}
        label="Cardio target minutes"
        unit=" min"
      />
      <p className="hint">
        Target minutes — what readiness prescribed that day. It is labelled &quot;target&quot;
        because that is honestly what is stored; nothing records what was actually done.
      </p>

      {Object.keys(byLocation).length > 0 && (
        <RankedBars
          rows={Object.entries(byLocation).map(([label, value]) => ({ label, value }))}
          unit=" sessions"
        />
      )}

      {missing.length > 0 && (
        <>
          <h3 className="sub-head">Not charted, because it is not logged</h3>
          <ul className="gap-list">
            {missing.map((g) => (
              <li key={g.field}>{g.label}</li>
            ))}
          </ul>
          <p className="hint">
            Cardio is logged with a single tap — there is no cardio generator yet, so nothing ever
            asked for these and nothing recorded them. Charting them needs a change to how sessions
            are logged, which this screen deliberately is not.
          </p>
        </>
      )}
    </section>
  );
}

// -- 4. volume by muscle group --------------------------------------------

function MuscleVolume({ history, library, reference }) {
  const [metric, setMetric] = useState('volume');
  const rows = useMemo(
    () => muscleVolume(history, library, { weeks: MUSCLE_WEEKS, reference }),
    [history, library, reference],
  );

  return (
    <section className="card">
      <h2>Volume by muscle group</h2>
      <p className="hint">Rolling {MUSCLE_WEEKS} weeks.</p>

      <div className="pill-group" role="group" aria-label="Muscle metric">
        <button
          type="button"
          className="pill"
          aria-pressed={metric === 'volume'}
          onClick={() => setMetric('volume')}
        >
          Load volume
        </button>
        <button
          type="button"
          className="pill"
          aria-pressed={metric === 'sets'}
          onClick={() => setMetric('sets')}
        >
          Working sets
        </button>
      </div>

      <RankedBars
        rows={rows.map((r) => ({
          label: REGION_LABELS[r.region] ?? r.region,
          value: metric === 'volume' ? r.volume : r.sets,
          sub: metric === 'volume' ? `· ${r.sets} sets` : null,
        }))}
        unit={metric === 'volume' ? ' lb' : ''}
        emptyText="No lift sessions in this window yet."
      />

      <p className="hint">
        Volume is split evenly across an exercise&apos;s primary muscles rather than counted in full
        against each, so the totals add up to what you actually lifted. Bodyweight and timed work
        carries no load volume at all — check Working sets before concluding your core is being
        neglected.
      </p>
    </section>
  );
}

// -- 5. readiness ----------------------------------------------------------

const TONE_BY_TYPE = { Lift: 'accent', Cardio: 'muted', Rest: 'warn' };

function Readiness({ log, history, reference }) {
  const series = useMemo(
    () => readinessSeries(log, history, { days: 90, reference }),
    [log, history, reference],
  );
  const buckets = useMemo(() => readinessVsTraining(series), [series]);

  return (
    <section className="card">
      <h2>Readiness</h2>
      <p className="hint">Garmin Training Readiness, last 90 days.</p>

      <LineChart
        points={series.map((p) => ({
          x: shortDate(p.date),
          y: p.score,
          tone: TONE_BY_TYPE[p.sessionType] ?? 'dim',
        }))}
        label="Training readiness"
      />

      <div className="chart-legend">
        <span className="lg-item">
          <span className="lg-swatch is-accent" /> Lift
        </span>
        <span className="lg-item">
          <span className="lg-swatch is-muted" /> Cardio
        </span>
        <span className="lg-item">
          <span className="lg-swatch is-warn" /> Rest
        </span>
        <span className="lg-item">
          <span className="lg-swatch is-dim" /> Nothing logged
        </span>
      </div>

      {buckets.length > 0 && (
        <>
          <h3 className="sub-head">Average score by what you did</h3>
          <RankedBars
            rows={buckets.map((b) => ({
              label: b.type === 'None' ? 'Nothing logged' : b.type,
              value: b.average,
              sub: `· ${b.days} day${b.days === 1 ? '' : 's'}`,
            }))}
          />
          <p className="hint">
            If the recommendations are tracking, lift days should average higher than rest days.
            Shown as plain averages rather than a correlation — with a few dozen days a correlation
            coefficient reads far more confident than it has earned.
          </p>
        </>
      )}
    </section>
  );
}
