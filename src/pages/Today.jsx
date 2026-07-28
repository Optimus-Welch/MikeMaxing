import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getProfile,
  getSessionHistory,
  getSettings,
  getExerciseLibrary,
  getLastPerformance,
  addSession,
  upsertReadinessEntry,
} from '../lib/db.js';
import { computeReadiness, scoreToBand, recommendSession } from '../lib/readiness.js';
import { weeklyCounts, todayISO } from '../lib/weekly.js';
import { generateLiftSession, swapExercise } from '../lib/liftGenerator.js';
import HistoryList from '../components/HistoryList.jsx';
import SessionPlan from '../components/SessionPlan.jsx';

const LOAD_OPTIONS = [1, 2, 3, 4, 5];
const ENERGY_OPTIONS = [1, 2, 3, 4, 5];
const SESSION_TYPES = ['Lift', 'Cardio', 'Rest'];
const LOCATIONS = ['Work', 'Home'];

// One blank log row for an exercise, with the weight pre-filled from the last
// time it was logged.
//
// `touched` is what separates "prescribed" from "actually performed". The
// weight is pre-filled (matching last session is the common case and editing a
// number beats typing one), which means a row is NOT evidence that the set
// happened. Only rows the user edited get persisted — otherwise merely opening
// a generated session would record a full workout nobody did.
function blankRow(ex, last) {
  return {
    reps: '',
    repsPlaceholder: ex.reps != null ? String(ex.reps) : '',
    weight: last?.weight != null ? String(last.weight) : '',
    weightPlaceholder: last?.weight != null ? String(last.weight) : '',
    rpe: '',
    touched: false,
    lastPerformance: last,
  };
}

function buildRows(ex) {
  const last = getLastPerformance(ex.exerciseId);
  return Array.from({ length: ex.sets ?? 3 }, () => blankRow(ex, last));
}

function buildLog(session) {
  const log = {};
  for (const ex of session.exercises) log[ex.exerciseId] = buildRows(ex);
  return log;
}

export default function Today() {
  // Loaded once — these collections only change via the actions below, so
  // we update local state directly instead of re-reading localStorage.
  const [profile] = useState(getProfile);
  const [settings] = useState(getSettings);
  const [library] = useState(getExerciseLibrary);
  const [sessionHistory, setSessionHistory] = useState(getSessionHistory);

  const [sleepScore, setSleepScore] = useState('');
  const [load, setLoad] = useState(null);
  const [energy, setEnergy] = useState(null);
  const [manualLocation, setManualLocation] = useState(null);
  const [loggedType, setLoggedType] = useState(null); // overrides the recommended type when set
  const [justLogged, setJustLogged] = useState(false);

  // Generated lift session + what actually got done.
  const [liftSession, setLiftSession] = useState(null);
  const [log, setLog] = useState({});
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  // Set when the user insists on lifting despite a Red readiness score.
  const [forceLiftOnRed, setForceLiftOnRed] = useState(false);
  // Once today's session is logged, freeze the plan. Without this, appending
  // to sessionHistory would re-run generation and swap the plan out from under
  // the user the instant they saved it.
  const [planLocked, setPlanLocked] = useState(false);

  const today = useMemo(() => new Date(), []);

  const readinessScore = useMemo(
    () =>
      computeReadiness(
        { sleepScore: sleepScore === '' ? null : Number(sleepScore), load, energy },
        settings.readinessWeights,
      ),
    [sleepScore, load, energy, settings.readinessWeights],
  );

  const band = readinessScore != null ? scoreToBand(readinessScore, settings.bands) : null;

  const counts = useMemo(() => weeklyCounts(sessionHistory, today), [sessionHistory, today]);

  const recommendation = useMemo(() => {
    if (!band) return null;
    return recommendSession({ band, counts, goals: profile.goals, date: today, manualLocation });
  }, [band, counts, profile.goals, today, manualLocation]);

  const selectedType = loggedType ?? recommendation?.type ?? null;
  const selectedLocation = recommendation?.location ?? manualLocation;

  // A lift plan is shown when the session is a Lift and readiness is not Red.
  // Red gets a recovery message instead, with an explicit override.
  const shouldGenerate =
    selectedType === 'Lift' && selectedLocation && band && (band !== 'Red' || forceLiftOnRed);

  // Red-forced sessions borrow the Orange prescription — reduced volume, low
  // intensity — rather than pretending the readiness score said something else.
  const generationBand = band === 'Red' ? 'Orange' : band;

  // Regenerate whenever the inputs that define the session change. Keyed on
  // `seed` so "Regenerate" is just a new seed.
  useEffect(() => {
    if (planLocked) return;
    if (!shouldGenerate) {
      setLiftSession(null);
      setLog({});
      return;
    }
    const next = generateLiftSession({
      location: selectedLocation,
      band: generationBand,
      library,
      sessionHistory,
      freshnessWindow: settings.freshnessWindow,
      seed,
    });
    setLiftSession(next);
    setLog(buildLog(next));
  }, [
    shouldGenerate,
    selectedLocation,
    generationBand,
    library,
    sessionHistory,
    settings.freshnessWindow,
    seed,
    planLocked,
  ]);

  const handleSetChange = useCallback((exerciseId, setIndex, field, value) => {
    setLog((prev) => {
      const rows = prev[exerciseId] ?? [];
      const next = rows.map((row, i) =>
        i === setIndex ? { ...row, [field]: value, touched: true } : row,
      );
      return { ...prev, [exerciseId]: next };
    });
  }, []);

  // A manually added set is by definition one the user is doing, so it counts
  // as touched even before they type into it.
  const handleAddSet = useCallback((exerciseId) => {
    setLog((prev) => {
      const rows = prev[exerciseId] ?? [];
      const template = rows[rows.length - 1] ?? { reps: '', weight: '', rpe: '' };
      return {
        ...prev,
        [exerciseId]: [...rows, { ...template, rpe: '', touched: true }],
      };
    });
  }, []);

  const handleRemoveSet = useCallback((exerciseId, setIndex) => {
    setLog((prev) => {
      const rows = prev[exerciseId] ?? [];
      if (rows.length <= 1) return prev;
      return { ...prev, [exerciseId]: rows.filter((_, i) => i !== setIndex) };
    });
  }, []);

  // Swap one exercise, keeping the rest of the session and any sets already
  // logged against the exercises that did not change.
  const handleSwap = useCallback(
    (index) => {
      if (!liftSession) return;
      const swapSeed = Math.floor(Math.random() * 1e9);
      const next = swapExercise({
        session: liftSession,
        index,
        library,
        sessionHistory,
        freshnessWindow: settings.freshnessWindow,
        seed: swapSeed,
      });
      setLiftSession(next);

      const replaced = next.exercises[index];
      const previousId = liftSession.exercises[index].exerciseId;
      setLog((prev) => {
        // Drop the outgoing exercise's rows, keep everything already logged
        // against the slots that did not change.
        const rest = Object.fromEntries(
          Object.entries(prev).filter(([id]) => id !== previousId),
        );
        return { ...rest, [replaced.exerciseId]: buildRows(replaced) };
      });
    },
    [liftSession, library, sessionHistory, settings.freshnessWindow],
  );

  // Regenerating after logging is an explicit "give me another one" — unlock
  // the plan so the effect runs again.
  const handleRegenerate = useCallback(() => {
    setPlanLocked(false);
    setSeed(Math.floor(Math.random() * 1e9));
  }, []);

  function handleLogSession() {
    if (!selectedType || !selectedLocation) return;

    const dateISO = todayISO(today);

    if (readinessScore != null) {
      upsertReadinessEntry({
        date: dateISO,
        sleepScore: sleepScore === '' ? null : Number(sleepScore),
        load,
        energy,
        score: readinessScore,
        band,
      });
    }

    const session = {
      id: crypto.randomUUID(),
      type: selectedType,
      location: selectedLocation,
      date: dateISO,
    };

    // Attach the plan and the logged sets so this session feeds freshness
    // (via variationGroup) and weight pre-fill (via sets) next time.
    if (selectedType === 'Lift' && liftSession) {
      session.templateId = liftSession.templateId;
      session.templateName = liftSession.templateName;
      session.band = liftSession.band;
      session.seed = liftSession.seed;
      session.exercises = liftSession.exercises.map((ex) => ({
        exerciseId: ex.exerciseId,
        name: ex.name,
        pattern: ex.pattern,
        variationGroup: ex.variationGroup,
        emphasis: ex.emphasis,
        prescription: ex.prescription,
        // Only sets the user actually touched — a pre-filled row is a
        // suggestion, not a record that the set happened.
        sets: (log[ex.exerciseId] ?? [])
          .filter((r) => r.touched)
          .map((r) => ({
            reps: r.reps === '' ? null : Number(r.reps),
            weight: r.weight === '' ? null : Number(r.weight),
            rpe: r.rpe === '' ? null : Number(r.rpe),
          })),
      }));
    }

    if (selectedType === 'Lift' && liftSession) setPlanLocked(true);

    setSessionHistory(addSession(session));
    setJustLogged(true);
    setTimeout(() => setJustLogged(false), 2000);
  }

  return (
    <>
      <h1 className="page-title">Today</h1>

      <section className="card">
        <h2>Readiness</h2>
        <div className="field">
          <label htmlFor="sleep">Sleep score (0-100)</label>
          <input
            id="sleep"
            type="number"
            min="0"
            max="100"
            inputMode="numeric"
            placeholder="e.g. 82"
            value={sleepScore}
            onChange={(e) => setSleepScore(e.target.value)}
          />
        </div>

        <div className="field">
          <label>Training load this week (1 = easy, 5 = very hard)</label>
          <div className="pill-group" role="group" aria-label="Training load">
            {LOAD_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                className="pill"
                aria-pressed={load === n}
                onClick={() => setLoad(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Energy (optional)</label>
          <div className="pill-group" role="group" aria-label="Energy rating">
            {ENERGY_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                className="pill"
                aria-pressed={energy === n}
                onClick={() => setEnergy(energy === n ? null : n)}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="hint">Tap a number again to clear it.</p>
        </div>
      </section>

      {readinessScore != null && (
        <section className="card">
          <div className={`band-banner band-${band}`}>
            <span className="score">{readinessScore}</span>
            <span className="band-label">{band}</span>
          </div>

          {recommendation && (
            <div className="recommendation">
              <div className="type">
                {recommendation.type} · {selectedLocation}
              </div>
              <p className="rationale">{recommendation.rationale}</p>

              <div className="field">
                <label>Location</label>
                <div className="pill-group" role="group" aria-label="Location">
                  {LOCATIONS.map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      className="pill"
                      aria-pressed={selectedLocation === loc}
                      onClick={() => setManualLocation(loc)}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
                {manualLocation && manualLocation !== recommendation.defaultLocation && (
                  <p className="hint">Default for today is {recommendation.defaultLocation}.</p>
                )}
              </div>

              <div className="field">
                <label>Session actually done</label>
                <div className="pill-group" role="group" aria-label="Session type to log">
                  {SESSION_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="pill"
                      aria-pressed={selectedType === type}
                      onClick={() => setLoggedType(type)}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <button type="button" className="btn-primary" onClick={handleLogSession}>
                {justLogged ? 'Logged ✓' : 'Log session'}
              </button>
            </div>
          )}
        </section>
      )}

      {/* Red + Lift: lead with recovery, but do not block someone who has
          decided to train anyway. */}
      {selectedType === 'Lift' && band === 'Red' && !forceLiftOnRed && (
        <section className="card">
          <h2>Recovery recommended</h2>
          <p className="hint">
            Readiness is Red. No lift is generated by default — sleep, food and an easy walk will do
            more for you today than a session will.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setForceLiftOnRed(true)}
          >
            Generate a reduced session anyway
          </button>
        </section>
      )}

      {liftSession && (
        <>
          {band === 'Red' && (
            <p className="hint warn">
              Readiness is Red — this session uses reduced volume and low intensity. Stop early if it
              feels wrong.
            </p>
          )}
          <SessionPlan
            session={liftSession}
            log={log}
            onSetChange={handleSetChange}
            onAddSet={handleAddSet}
            onRemoveSet={handleRemoveSet}
            onSwap={handleSwap}
            onRegenerate={handleRegenerate}
          />
        </>
      )}

      <section className="card">
        <h2>This week</h2>
        <p className="hint">
          Lifts {counts.Lift}/{profile.goals.liftsPerWeek} · Cardio {counts.Cardio}/
          {profile.goals.cardioPerWeek}
        </p>
      </section>

      <section className="card">
        <h2>Recent sessions</h2>
        <HistoryList sessions={sessionHistory} />
      </section>
    </>
  );
}
