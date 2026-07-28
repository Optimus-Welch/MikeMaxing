import { useEffect, useState } from 'react';

// Renders a generated lift session and captures what actually got done.
//
// This component is deliberately "dumb": the session object and the log live
// in Today.jsx, which owns regeneration and persistence. Everything here is
// display plus change events, so the generator stays testable on its own.

export default function SessionPlan({
  session,
  log,
  onSetChange,
  onAddSet,
  onRemoveSet,
  onSwap,
  onRegenerate,
}) {
  // Which exercise is expanded for logging. Only one at a time keeps the
  // screen manageable on a phone.
  const [openId, setOpenId] = useState(null);

  // A regenerated session is a different workout — collapse any panel left
  // open against the old one.
  useEffect(() => {
    setOpenId(null);
  }, [session.seed]);

  return (
    <section className="card session-plan">
      <div className="session-header">
        <div>
          <h2>{session.templateName}</h2>
          <p className="hint">{session.intensityLabel}</p>
        </div>
        <button type="button" className="btn-secondary" onClick={onRegenerate}>
          Regenerate
        </button>
      </div>

      <p className="rationale">{session.bandNote}</p>

      {session.skipped.length > 0 && (
        <p className="hint warn">
          {session.skipped.map((s) => s.reason).join(' ')}
        </p>
      )}

      <ol className="exercise-list">
        {session.exercises.map((ex, index) => {
          const rows = log[ex.exerciseId] ?? [];
          const isOpen = openId === ex.exerciseId;
          const doneSets = rows.filter((r) => r.touched).length;

          return (
            <li key={`${ex.exerciseId}-${index}`} className="exercise-item">
              <div className="exercise-head">
                <div className="exercise-meta">
                  <span className="pattern-tag">{ex.patternLabel}</span>
                  {ex.repeatedGroup && (
                    <span className="pattern-tag muted" title="Limited options at this location">
                      repeat
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => onSwap(index)}
                  aria-label={`Swap ${ex.name}`}
                  title="Swap this exercise"
                >
                  ⇄
                </button>
              </div>

              <div className="exercise-name">{ex.name}</div>

              <div className="prescription">
                <strong>{ex.prescription}</strong>
                <span className="scheme-tag">{ex.schemeName}</span>
                {ex.rpe && <span className="scheme-tag">RPE {ex.rpe}</span>}
              </div>

              <p className="hint">{ex.detail}</p>
              {ex.supersetWith && <p className="hint">Superset with {ex.supersetWith}.</p>}
              {ex.loadNotes && <p className="hint load-note">{ex.loadNotes}</p>}

              <button
                type="button"
                className="btn-secondary log-toggle"
                onClick={() => setOpenId(isOpen ? null : ex.exerciseId)}
                aria-expanded={isOpen}
              >
                {isOpen ? 'Hide log' : doneSets ? `Logged ${doneSets} set(s)` : 'Log sets'}
              </button>

              {isOpen && (
                <div className="set-log">
                  <div className="set-row set-row-head">
                    <span>Set</span>
                    <span>Reps</span>
                    <span>Weight</span>
                    <span>RPE</span>
                    <span />
                  </div>

                  {rows.map((row, setIndex) => (
                    <div className="set-row" key={setIndex}>
                      <span className="set-number">{setIndex + 1}</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        aria-label={`Set ${setIndex + 1} reps`}
                        placeholder={row.repsPlaceholder ?? ''}
                        value={row.reps}
                        onChange={(e) => onSetChange(ex.exerciseId, setIndex, 'reps', e.target.value)}
                      />
                      <input
                        type="number"
                        inputMode="decimal"
                        step="2.5"
                        aria-label={`Set ${setIndex + 1} weight`}
                        placeholder={row.weightPlaceholder ?? ''}
                        value={row.weight}
                        onChange={(e) =>
                          onSetChange(ex.exerciseId, setIndex, 'weight', e.target.value)
                        }
                      />
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        min="1"
                        max="10"
                        aria-label={`Set ${setIndex + 1} RPE`}
                        value={row.rpe}
                        onChange={(e) => onSetChange(ex.exerciseId, setIndex, 'rpe', e.target.value)}
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => onRemoveSet(ex.exerciseId, setIndex)}
                        aria-label={`Remove set ${setIndex + 1}`}
                        disabled={rows.length <= 1}
                      >
                        −
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onAddSet(ex.exerciseId)}
                  >
                    + Add set
                  </button>

                  {rows[0]?.lastPerformance && (
                    <p className="hint">
                      Last time ({rows[0].lastPerformance.date}): {rows[0].lastPerformance.weight} ×{' '}
                      {rows[0].lastPerformance.reps}
                      {rows[0].lastPerformance.rpe ? ` @ RPE ${rows[0].lastPerformance.rpe}` : ''}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
