import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getActiveSession,
  setActiveSession,
  clearActiveSession,
  getExerciseLibrary,
  getSessionHistory,
  getLastPerformance,
  getSettings,
  addSession,
} from '../lib/db.js';
import { swapExercise } from '../lib/liftGenerator.js';
import { LOCATION_LOAD_CAPS } from '../lib/exercises.js';

// Guided run mode: one thing on screen at a time.
//
// All state lives in the persisted `activeSession` rather than component
// state, so locking the phone mid-workout — or the browser evicting the tab —
// resumes exactly where you left off. Rest uses an absolute end timestamp for
// the same reason: a backgrounded tab stops firing intervals, but wall-clock
// time keeps moving, and a rest timer that pauses when the screen sleeps is
// worse than no timer.

const locationHasCap = (location) => {
  const caps = LOCATION_LOAD_CAPS[location] ?? {};
  return caps.dumbbellPerHand != null || caps.barbellTotal != null;
};

function fmtClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function Run() {
  const navigate = useNavigate();
  const [state, setState] = useState(getActiveSession);
  const [library] = useState(getExerciseLibrary);
  const [settings] = useState(getSettings);
  // Drives the rest countdown re-render once a second.
  const [, setTick] = useState(0);

  // Persist on every change — this is the source of truth, not component state.
  const update = useCallback((next) => {
    setState(next);
    setActiveSession(next);
  }, []);

  // No workout in progress: nothing to run.
  useEffect(() => {
    if (!state) navigate('/', { replace: true });
  }, [state, navigate]);

  const step = state?.steps?.[state.index] ?? null;
  const isRest = step?.kind === 'rest';

  // Tick while resting so the countdown updates.
  useEffect(() => {
    if (!isRest) return;
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [isRest]);

  const workSteps = useMemo(
    () => (state?.steps ?? []).filter((s) => s.kind === 'exercise'),
    [state?.steps],
  );
  const doneCount = useMemo(
    () => Object.values(state?.results ?? {}).filter((r) => r.done).length,
    [state?.results],
  );

  // Save the finished workout. Takes the state to save explicitly rather than
  // reading `state`, so the final set — recorded in the same interaction that
  // ends the session — is included.
  const finishWith = useCallback(
    (base) => {
      const performed = Object.values(base.results).filter((r) => r.done);

      const session = {
        id: base.id,
        type: 'Lift',
        location: base.location,
        date: base.date,
        templateId: base.templateId,
        templateName: base.templateName,
        band: base.band,
        seed: base.seed,
        startedAt: base.startedAt,
        endedAt: Date.now(),
        // Roll the flat per-set results back up per exercise, which is the
        // shape freshness and weight pre-fill already expect.
        exercises: base.session.exercises.map((ex) => ({
          exerciseId: ex.exerciseId,
          name: ex.name,
          pattern: ex.pattern,
          variationGroup: ex.variationGroup,
          emphasis: ex.emphasis,
          prescription: ex.prescription,
          sets: performed
            .filter((r) => r.exerciseId === ex.exerciseId)
            .map((r) => ({ reps: r.reps, weight: r.weight, rpe: r.rpe ?? null })),
        })),
      };

      addSession(session);
      clearActiveSession();
      navigate('/finish', { replace: true, state: { sessionId: session.id } });
    },
    [navigate],
  );

  // Every transition threads the base state through explicitly. Doing this as
  // two calls (record, then advance) meant the second one spread a `state`
  // captured before the first, silently discarding the set that had just been
  // logged — so a whole workout could finish with nothing recorded.
  const advanceFrom = useCallback(
    (base) => {
      const nextIndex = base.index + 1;
      if (nextIndex >= base.steps.length) return finishWith(base);

      const next = { ...base, index: nextIndex };
      // Starting a rest step stamps its end time.
      if (base.steps[nextIndex].kind === 'rest') {
        next.restEndsAt = Date.now() + base.steps[nextIndex].item.seconds * 1000;
      }
      update(next);
    },
    [update, finishWith],
  );

  const markDone = useCallback(
    ({ reps, weight }) => {
      // Prep drills are guidance, not tracked work — ticking one off just
      // advances the flow without polluting the session's logged sets.
      if (step.kind !== 'exercise') return advanceFrom(state);

      advanceFrom({
        ...state,
        results: {
          ...state.results,
          [step.key]: {
            stepKey: step.key,
            exerciseId: step.item.exerciseId,
            name: step.item.name,
            reps: reps === '' || reps == null ? null : Number(reps),
            weight: weight === '' || weight == null ? null : Number(weight),
            done: true,
          },
        },
      });
    },
    [state, step, advanceFrom],
  );

  const skipStep = useCallback(() => {
    if (step.kind !== 'exercise') return advanceFrom(state);
    advanceFrom({
      ...state,
      results: {
        ...state.results,
        [step.key]: { stepKey: step.key, exerciseId: step.item.exerciseId, skipped: true },
      },
    });
  }, [state, step, advanceFrom]);

  // Swap the current exercise for another of the same pattern, in place —
  // every remaining step for it is rewritten so the rest of the block follows.
  const swapCurrent = useCallback(() => {
    const idx = state.session.exercises.findIndex((e) => e.exerciseId === step.item.exerciseId);
    if (idx === -1) return;

    const nextSession = swapExercise({
      session: state.session,
      index: idx,
      library,
      sessionHistory: getSessionHistory(),
      freshnessWindow: settings.freshnessWindow,
      seed: Math.floor(Math.random() * 1e9),
    });
    const replacement = nextSession.exercises[idx];
    if (replacement.exerciseId === step.item.exerciseId) return; // nothing else available

    const oldId = step.item.exerciseId;
    const steps = state.steps.map((s, i) =>
      i >= state.index && s.kind === 'exercise' && s.item.exerciseId === oldId
        ? { ...s, key: `${s.key}-swap${replacement.exerciseId}`, item: { ...s.item, ...replacement } }
        : s,
    );

    update({ ...state, session: nextSession, steps });
  }, [state, step, library, settings.freshnessWindow, update]);

  function quit() {
    clearActiveSession();
    navigate('/', { replace: true });
  }

  if (!state || !step) return null;

  const progress = workSteps.length ? doneCount / workSteps.length : 0;
  const nextStep = state.steps[state.index + 1];

  return (
    <div className="run">
      <div className="run-top">
        <div>
          <div className="eyebrow">
            {step.blockName}
            {step.blockSubtitle ? ` — ${step.blockSubtitle}` : ''}
          </div>
          <div className="hint" style={{ marginTop: 2 }}>
            Round {step.round} of {step.totalRounds} · {doneCount}/{workSteps.length} sets done
          </div>
        </div>
        <button type="button" className="btn-ghost" onClick={quit}>
          End
        </button>
      </div>

      <div className="run-progress-track">
        <div className="run-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>

      {isRest ? (
        <RestView
          endsAt={state.restEndsAt}
          seconds={step.item.seconds}
          next={nextStep}
          onSkip={() => advanceFrom(state)}
          onAdd={() => update({ ...state, restEndsAt: (state.restEndsAt ?? Date.now()) + 30000 })}
        />
      ) : (
        <WorkView
          step={step}
          location={state.location}
          onDone={markDone}
          onSkip={skipStep}
          onSwap={swapCurrent}
          canSwap={step.kind === 'exercise'}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- rest --- */

function RestView({ endsAt, seconds, next, onSkip, onAdd }) {
  const remaining = endsAt ? (endsAt - Date.now()) / 1000 : seconds;

  // Auto-advance the moment the clock runs out — that is the whole point of a
  // guided flow. Runs in an effect so it does not fire during render.
  useEffect(() => {
    if (remaining <= 0) onSkip();
  }, [remaining, onSkip]);

  const nextLabel =
    next?.kind === 'exercise' ? next.item.name : next?.kind === 'prep' ? next.item.name : 'Finish';

  return (
    <>
      <div className="run-body">
        <div className="rest-screen">
          <div className="rest-label">Rest</div>
          <div className="rest-count">{fmtClock(remaining)}</div>
          <p className="rest-next">
            Up next: <strong>{nextLabel}</strong>
          </p>
        </div>
      </div>

      <div className="run-actions">
        <button type="button" className="btn-primary" onClick={onSkip}>
          Skip rest
        </button>
        <div className="run-secondary-actions">
          <button type="button" className="btn-secondary" onClick={onAdd}>
            +30s
          </button>
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- work --- */

function WorkView({ step, location, onDone, onSkip, onSwap, canSwap }) {
  const item = step.item;
  const isPrep = step.kind === 'prep';
  const isTimed = item.seconds != null;

  const last = useMemo(
    () => (item.exerciseId ? getLastPerformance(item.exerciseId) : null),
    [item.exerciseId],
  );

  // Reset the inputs whenever the step changes, pre-filling weight from last
  // time and reps from the prescription.
  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');
  useEffect(() => {
    setReps(item.reps != null ? String(item.reps) : '');
    setWeight(last?.weight != null ? String(last.weight) : '');
  }, [step.key, item.reps, last?.weight]);

  if (isPrep) {
    return (
      <>
        <div className="run-body">
          <div className="eyebrow run-context">Prep</div>
          <h1 className="run-exercise-name">{item.name}</h1>
          {item.detail && <p className="run-note">{item.detail}</p>}
          <div className="run-targets">
            <div className="target-box">
              <div className="t-label">Target</div>
              <div className="t-value">{isTimed ? `${item.seconds}s` : `${item.reps} reps`}</div>
            </div>
          </div>
        </div>
        <div className="run-actions">
          <button type="button" className="btn-primary" onClick={() => onDone({})}>
            Done
          </button>
          <div className="run-secondary-actions">
            <button type="button" className="btn-secondary" onClick={onSkip}>
              Skip
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="run-body">
        <div className="eyebrow run-context">
          Set {step.round} of {step.totalRounds}
        </div>
        <h1 className="run-exercise-name">{item.name}</h1>

        <div className="run-targets">
          <div className="target-box is-editable">
            <div className="t-label">{isTimed ? 'Seconds' : 'Reps'}</div>
            <input
              type="number"
              inputMode="numeric"
              aria-label={isTimed ? 'Seconds performed' : 'Reps performed'}
              value={isTimed ? (reps === '' ? String(item.seconds) : reps) : reps}
              onChange={(e) => setReps(e.target.value)}
            />
          </div>
          <div className="target-box is-editable">
            <div className="t-label">Weight (lb)</div>
            <input
              type="number"
              inputMode="decimal"
              step="2.5"
              aria-label="Weight used"
              placeholder="—"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </div>
        </div>

        <div className="previous-line">
          <span className="p-label">Previous</span>
          <span className="p-value">
            {last ? `${last.weight} lb × ${last.reps}` : 'No history yet'}
          </span>
          {last?.date && <span className="p-date">{last.date}</span>}
        </div>

        {item.detail && <p className="run-note">{item.detail}</p>}
        {/* Load notes explain how to work around a weight ceiling, so they are
            only meaningful at a location that actually has one. Showing a
            "Home caps at 80 lb" note in a fully-equipped gym is just noise. */}
        {item.loadNotes && locationHasCap(location) && (
          <p className="run-note">{item.loadNotes}</p>
        )}
      </div>

      <div className="run-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={() => onDone({ reps: isTimed && reps === '' ? item.seconds : reps, weight })}
        >
          Done — log set
        </button>
        <div className="run-secondary-actions">
          {canSwap && (
            <button type="button" className="btn-secondary" onClick={onSwap}>
              Swap
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onSkip}>
            Skip
          </button>
        </div>
      </div>
    </>
  );
}
