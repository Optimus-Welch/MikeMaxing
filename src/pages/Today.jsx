import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getProfile,
  getSessionHistory,
  getSettings,
  getExerciseLibrary,
  getReadinessEntryForDate,
  getActiveSession,
  setActiveSession,
  clearActiveSession,
  addSession,
  upsertReadinessEntry,
} from '../lib/db.js';
import { computeReadiness, scoreToBand, recommendSession } from '../lib/readiness.js';
import { weeklyCounts, todayISO } from '../lib/weekly.js';
import { generateLiftSession } from '../lib/liftGenerator.js';
import { buildBlocks, createRunState } from '../lib/blocks.js';
import HistoryList from '../components/HistoryList.jsx';
import BlockList from '../components/BlockList.jsx';

const LOAD_OPTIONS = [1, 2, 3, 4, 5];
const ENERGY_OPTIONS = [1, 2, 3, 4, 5];
const SESSION_TYPES = ['Lift', 'Cardio', 'Rest'];
const LOCATIONS = ['Work', 'Home'];

export default function Today() {
  const navigate = useNavigate();

  const [profile] = useState(getProfile);
  const [settings] = useState(getSettings);
  const [library] = useState(getExerciseLibrary);
  const [sessionHistory, setSessionHistory] = useState(getSessionHistory);
  const [activeSession] = useState(getActiveSession);

  // Restore whatever readiness was already entered today, so reopening the app
  // does not collapse the screen back to "no suggestion".
  const [todayEntry] = useState(() => getReadinessEntryForDate(todayISO(new Date())));
  const [sleepScore, setSleepScore] = useState(
    todayEntry?.sleepScore != null ? String(todayEntry.sleepScore) : '',
  );
  const [load, setLoad] = useState(todayEntry?.load ?? null);
  const [energy, setEnergy] = useState(todayEntry?.energy ?? null);

  const [manualLocation, setManualLocation] = useState(null);
  const [loggedType, setLoggedType] = useState(null);
  const [forceLiftOnRed, setForceLiftOnRed] = useState(false);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [justLogged, setJustLogged] = useState(false);

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

  // Persist readiness as it is entered, not only when a session is logged.
  useEffect(() => {
    if (readinessScore == null) return;
    upsertReadinessEntry({
      date: todayISO(today),
      sleepScore: sleepScore === '' ? null : Number(sleepScore),
      load,
      energy,
      score: readinessScore,
      band,
    });
  }, [readinessScore, band, sleepScore, load, energy, today]);

  const counts = useMemo(() => weeklyCounts(sessionHistory, today), [sessionHistory, today]);

  const recommendation = useMemo(() => {
    if (!band) return null;
    return recommendSession({ band, counts, goals: profile.goals, date: today, manualLocation });
  }, [band, counts, profile.goals, today, manualLocation]);

  const selectedType = loggedType ?? recommendation?.type ?? null;
  const selectedLocation = recommendation?.location ?? manualLocation;

  const shouldGenerate =
    selectedType === 'Lift' && selectedLocation && band && (band !== 'Red' || forceLiftOnRed);
  const generationBand = band === 'Red' ? 'Orange' : band;

  // Generation is pure, so it can just be derived rather than held in state.
  const liftSession = useMemo(() => {
    if (!shouldGenerate) return null;
    return generateLiftSession({
      location: selectedLocation,
      band: generationBand,
      library,
      sessionHistory,
      freshnessWindow: settings.freshnessWindow,
      seed,
    });
  }, [
    shouldGenerate,
    selectedLocation,
    generationBand,
    library,
    sessionHistory,
    settings.freshnessWindow,
    seed,
  ]);

  const { blocks, estimatedMinutes } = useMemo(
    () => (liftSession ? buildBlocks(liftSession) : { blocks: [], estimatedMinutes: 0 }),
    [liftSession],
  );

  function startWorkout() {
    const runState = createRunState({
      session: liftSession,
      location: selectedLocation,
      band,
      date: todayISO(today),
    });
    setActiveSession(runState);
    navigate('/run');
  }

  // Non-lift sessions (Cardio, Rest) have no generated plan to run, so they
  // are still logged with a single tap.
  function logSimpleSession() {
    const session = {
      id: crypto.randomUUID(),
      type: selectedType,
      location: selectedLocation,
      date: todayISO(today),
    };
    setSessionHistory(addSession(session));
    setJustLogged(true);
    setTimeout(() => setJustLogged(false), 2000);
  }

  return (
    <>
      <h1 className="page-title">Today</h1>
      <p className="page-sub">
        {today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      </p>

      {/* An unfinished workout beats anything else on this screen. */}
      {activeSession && (
        <div className="resume-banner">
          <div>
            <div className="rb-title">Workout in progress</div>
            <div className="rb-sub">
              {activeSession.templateName} · {activeSession.location}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                clearActiveSession();
                window.location.reload();
              }}
            >
              Discard
            </button>
            <button type="button" className="btn-secondary" onClick={() => navigate('/run')}>
              Resume
            </button>
          </div>
        </div>
      )}

      <section className="card">
        <h2>Readiness</h2>
        <div className="field">
          <label htmlFor="sleep">Sleep score</label>
          <input
            id="sleep"
            type="number"
            min="0"
            max="100"
            inputMode="numeric"
            placeholder="0–100"
            value={sleepScore}
            onChange={(e) => setSleepScore(e.target.value)}
          />
        </div>

        <div className="field">
          <label>Training load</label>
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
          <p className="hint">1 = easy week so far, 5 = very hard.</p>
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
        </div>
      </section>

      {readinessScore == null && (
        <section className="card">
          <h2>No session yet</h2>
          <p className="hint">
            Enter a sleep score or tap a training load and Autopilot will build today's session.
          </p>
        </section>
      )}

      {readinessScore != null && recommendation && (
        <section className="card">
          <div className={`band-banner band-${band}`}>
            <span className="score">{readinessScore}</span>
            <span className="band-label">{band}</span>
          </div>

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
            </div>

            <div className="field">
              <label>Session type</label>
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
          </div>
        </section>
      )}

      {selectedType === 'Lift' && band === 'Red' && !forceLiftOnRed && (
        <section className="card">
          <h2>Recovery recommended</h2>
          <p className="hint">
            Readiness is Red. Sleep, food and an easy walk will do more for you today than a session
            will.
          </p>
          <button
            type="button"
            className="btn-secondary"
            style={{ marginTop: 14 }}
            onClick={() => setForceLiftOnRed(true)}
          >
            Build a reduced session anyway
          </button>
        </section>
      )}

      {liftSession && blocks.length > 0 && (
        <>
          <button type="button" className="btn-start" onClick={startWorkout}>
            Start workout
          </button>

          <div className="session-meta">
            <div className="meta-stat">
              <div className="meta-value">~{estimatedMinutes}</div>
              <div className="meta-label">Minutes</div>
            </div>
            <div className="meta-stat">
              <div className="meta-value">{liftSession.exercises.length}</div>
              <div className="meta-label">Exercises</div>
            </div>
            <div className="meta-stat">
              <div className="meta-value">{blocks.length}</div>
              <div className="meta-label">Blocks</div>
            </div>
          </div>

          {band === 'Red' && (
            <p className="hint warn">
              Readiness is Red — reduced volume and low intensity. Stop early if it feels wrong.
            </p>
          )}

          <BlockList blocks={blocks} />

          <button
            type="button"
            className="btn-secondary"
            style={{ width: '100%', marginBottom: 14 }}
            onClick={() => setSeed(Math.floor(Math.random() * 1e9))}
          >
            Regenerate session
          </button>
        </>
      )}

      {/* Cardio and Rest have no generated plan yet — log them directly. */}
      {recommendation && selectedType !== 'Lift' && (
        <button type="button" className="btn-primary" onClick={logSimpleSession}>
          {justLogged ? 'Logged ✓' : `Log ${selectedType.toLowerCase()} session`}
        </button>
      )}

      <section className="card" style={{ marginTop: 14 }}>
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
