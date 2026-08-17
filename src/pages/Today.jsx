import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getProfile,
  getSessionHistory,
  getSettings,
  getExerciseLibrary,
  getReadinessLog,
  getActiveSession,
  setActiveSession,
  clearActiveSession,
  addSession,
  upsertReadinessEntry,
} from '../lib/db.js';
import {
  parseReadinessScore,
  scoreToBand,
  recommendSession,
  durationTargetFor,
} from '../lib/readiness.js';
import { useCollection } from '../lib/useCollection.js';
import { weeklyCounts, todayISO } from '../lib/weekly.js';
import { generateLiftSession, swapExerciseTo } from '../lib/liftGenerator.js';
import { buildBlocks, createRunState } from '../lib/blocks.js';
import HistoryList from '../components/HistoryList.jsx';
import BlockList from '../components/BlockList.jsx';
import ExercisePicker from '../components/ExercisePicker.jsx';
import SyncBadge from '../components/SyncBadge.jsx';
import { initAudio } from '../lib/chime.js';

const SESSION_TYPES = ['Lift', 'Cardio', 'Rest'];
const LOCATIONS = ['Work', 'Home'];

export default function Today() {
  const navigate = useNavigate();

  // Live reads: these follow the stored collections rather than snapshotting
  // them at mount, so a sync landing a moment after sign-in shows up here
  // instead of waiting for a reload. Still synchronous on first render.
  const profile = useCollection('profile', getProfile);
  const settings = useCollection('settings', getSettings);
  const library = useCollection('exerciseLibrary', getExerciseLibrary);
  const sessionHistory = useCollection('sessionHistory', getSessionHistory);
  const readinessLog = useCollection('readinessLog', getReadinessLog);

  // A workout in progress is device-local by design, so a snapshot is right.
  const [activeSession] = useState(getActiveSession);

  const today = useMemo(() => new Date(), []);
  const todayDate = todayISO(today);

  // Restore whatever readiness was already entered today, so reopening the app
  // does not collapse the screen back to "no suggestion".
  const todayEntry = useMemo(
    () => readinessLog.find((e) => e.date === todayDate) ?? null,
    [readinessLog, todayDate],
  );
  const [readinessInput, setReadinessInput] = useState(() =>
    todayEntry?.score != null ? String(todayEntry.score) : '',
  );

  // Adopt a score that arrived after mount — you read it off your watch and
  // entered it on your phone, and this browser has only just pulled it down.
  //
  // Keyed on the stored score CHANGING, not on the box being empty: typing here
  // saves as you type, so "empty box, stored score" is also what you get the
  // instant you clear the field, and re-filling it then would make the score
  // impossible to delete.
  const lastSeenScore = useRef(todayEntry?.score ?? null);
  useEffect(() => {
    const score = todayEntry?.score ?? null;
    if (score === lastSeenScore.current) return;
    lastSeenScore.current = score;
    if (score != null) setReadinessInput(String(score));
  }, [todayEntry]);

  const [manualLocation, setManualLocation] = useState(null);
  const [loggedType, setLoggedType] = useState(null);
  const [forceLiftOnRed, setForceLiftOnRed] = useState(false);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [justLogged, setJustLogged] = useState(false);
  // Exercises the user swapped in on the preview, keyed by SLOT INDEX in the
  // generated session. Index rather than exerciseId because swapping the same
  // slot twice would otherwise leave a stale key whose resolution depends on
  // object iteration order. Kept separate from generation so a swap never
  // re-runs the generator, and regenerating starts clean.
  const [swaps, setSwaps] = useState({});
  // Weight the user set themselves in the preview, overriding the suggestion.
  // Cleared by regenerating, same as swaps.
  const [weightOverrides, setWeightOverrides] = useState({});
  const [swapTarget, setSwapTarget] = useState(null);

  // Garmin's number, taken as given — no weighting, no combining.
  const readinessScore = useMemo(() => parseReadinessScore(readinessInput), [readinessInput]);

  const band = readinessScore != null ? scoreToBand(readinessScore, settings.bands) : null;

  // Persist readiness as it is entered, not only when a session is logged.
  useEffect(() => {
    if (readinessScore == null) return;
    upsertReadinessEntry({
      date: todayDate,
      source: 'garmin',
      score: readinessScore,
      band,
    });
  }, [readinessScore, band, todayDate]);

  const counts = useMemo(() => weeklyCounts(sessionHistory, today), [sessionHistory, today]);

  const recommendation = useMemo(() => {
    if (!band) return null;
    return recommendSession({ band, counts, goals: profile.goals, date: today, manualLocation });
  }, [band, counts, profile.goals, today, manualLocation]);

  const selectedType = loggedType ?? recommendation?.type ?? null;
  const selectedLocation = recommendation?.location ?? manualLocation;

  // Duration axis: how much session today's score buys.
  const duration = useMemo(
    () => durationTargetFor(band, settings.durationTargets),
    [band, settings.durationTargets],
  );

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
      exerciseCount: duration.liftExercises,
      seed,
    });
  }, [
    shouldGenerate,
    selectedLocation,
    generationBand,
    library,
    sessionHistory,
    settings.freshnessWindow,
    duration.liftExercises,
    seed,
  ]);

  // Apply any preview swaps on top of the generated session, then any weight
  // overrides on top of that. Overrides are keyed by exerciseId rather than
  // slot index because a swap changes what lives in a slot — a weight you set
  // for a Goblet Squat must not silently transfer to whatever replaces it.
  const plannedSession = useMemo(() => {
    if (!liftSession) return null;
    let out = liftSession;
    for (const [slot, chosen] of Object.entries(swaps)) {
      const idx = Number(slot);
      if (!out.exercises[idx]) continue;
      out = swapExerciseTo({
        session: out,
        index: idx,
        exercise: chosen,
        seed,
        sessionHistory,
      });
    }

    if (Object.keys(weightOverrides).length) {
      out = {
        ...out,
        exercises: out.exercises.map((ex) => {
          const override = weightOverrides[ex.exerciseId];
          if (override == null || !ex.suggestion) return ex;
          return {
            ...ex,
            suggestion: { ...ex.suggestion, weight: override, note: 'Set by you for today.' },
          };
        }),
      };
    }
    return out;
  }, [liftSession, swaps, seed, sessionHistory, weightOverrides]);

  const { blocks, estimatedMinutes } = useMemo(
    () => (plannedSession ? buildBlocks(plannedSession) : { blocks: [], estimatedMinutes: 0 }),
    [plannedSession],
  );

  // Nudge one exercise's suggested weight by a single real increment of the
  // equipment at this location, never past its ceiling. `direction` is +1/-1
  // rather than a weight so the caller never has to know the step size.
  function adjustWeight(item, direction) {
    const current = item.suggestion?.weight;
    if (current == null) return;

    const step = item.suggestion.equipment?.step ?? 5;
    const cap = item.suggestion.equipment?.cap ?? null;

    let next = current + direction * step;
    if (next < 0) next = 0;
    if (cap != null && next > cap) next = cap;
    if (next === current) return;

    setWeightOverrides((prev) => ({ ...prev, [item.exerciseId]: next }));
  }

  function startWorkout() {
    // Prime the audio context inside this tap. iOS Safari — including the
    // installed PWA — only allows later, timer-driven chimes if an
    // AudioContext was unlocked during a real user gesture, and this is the
    // one guaranteed tap before any rest timer can end.
    if (settings.soundEnabled !== false) initAudio();

    const runState = createRunState({
      session: plannedSession,
      location: selectedLocation,
      band,
      date: todayDate,
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
      date: todayDate,
      band,
      // Cardio has no generated plan yet, but the duration target is what the
      // readiness score bought today, so it is worth recording.
      ...(selectedType === 'Cardio' ? { targetMinutes: duration.cardioMinutes } : {}),
    };
    // No setState needed: addSession writes the collection, and the live read
    // above picks the new history straight back up.
    addSession(session);
    setJustLogged(true);
    setTimeout(() => setJustLogged(false), 2000);
  }

  return (
    <>
      <SyncBadge />

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
        <h2>Training Readiness</h2>
        <div className="field">
          <label htmlFor="readiness">Garmin score</label>
          <input
            id="readiness"
            type="number"
            min="0"
            max="100"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0–100"
            value={readinessInput}
            onChange={(e) => setReadinessInput(e.target.value)}
          />
          <p className="hint">
            Straight from your watch. Garmin already accounts for sleep, recovery time, HRV, acute
            load and recent rest.
          </p>
        </div>
      </section>

      {readinessScore == null && (
        <section className="card">
          <h2>No session yet</h2>
          <p className="hint">
            Enter today's Garmin Training Readiness score and MikeMaxing will build the session.
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

          <BlockList
            blocks={blocks}
            location={selectedLocation}
            onSwap={(item) => setSwapTarget(item)}
            onAdjustWeight={adjustWeight}
          />

          <button
            type="button"
            className="btn-secondary"
            style={{ width: '100%', marginBottom: 14 }}
            onClick={() => {
              setSwaps({});
              setWeightOverrides({});
              setSeed(Math.floor(Math.random() * 1e9));
            }}
          >
            Regenerate session
          </button>
        </>
      )}

      {/* Cardio has no generated plan yet, but readiness still sets its length. */}
      {recommendation && selectedType === 'Cardio' && (
        <>
          <div className="session-meta">
            <div className="meta-stat">
              <div className="meta-value">{duration.cardioMinutes}</div>
              <div className="meta-label">Target minutes</div>
            </div>
            <div className="meta-stat">
              <div className="meta-value">{band}</div>
              <div className="meta-label">Readiness</div>
            </div>
          </div>
          <p className="hint" style={{ marginBottom: 14 }}>
            Aim for {duration.cardioMinutes} minutes at a pace you could hold a conversation
            through. Specific cardio sessions are not generated yet.
          </p>
        </>
      )}

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

      {swapTarget && (
        <ExercisePicker
          current={swapTarget}
          location={selectedLocation}
          library={library}
          onPick={(chosen) => {
            // Resolve the slot against the *generated* session, whose indices
            // are stable regardless of what has already been swapped.
            const idx = liftSession.exercises.findIndex(
              (e, i) =>
                e.exerciseId === swapTarget.exerciseId ||
                plannedSession.exercises[i]?.exerciseId === swapTarget.exerciseId,
            );
            if (idx !== -1) setSwaps((prev) => ({ ...prev, [idx]: chosen }));
            setSwapTarget(null);
          }}
          onClose={() => setSwapTarget(null)}
        />
      )}
    </>
  );
}
