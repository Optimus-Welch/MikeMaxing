import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getSessionHistory, getExerciseLibrary } from '../lib/db.js';
import { summariseSession } from '../lib/sessionStats.js';
import MuscleMap from '../components/MuscleMap.jsx';

// The payoff screen. Everything here is derived from what was actually logged
// — no participation trophies: if nothing was recorded, it says so.

export default function Finish() {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const history = useMemo(getSessionHistory, []);
  const library = useMemo(getExerciseLibrary, []);

  const sessionId = routerLocation.state?.sessionId;
  const session = useMemo(
    () => history.find((s) => s.id === sessionId) ?? history[0] ?? null,
    [history, sessionId],
  );

  const stats = useMemo(() => {
    if (!session) return null;
    // Flatten the per-exercise sets back out for the stats functions.
    const performed = (session.exercises ?? []).flatMap((ex) =>
      (ex.sets ?? []).map((s) => ({ ...s, exerciseId: ex.exerciseId, name: ex.name })),
    );
    return summariseSession({
      performed,
      library,
      history,
      sessionId: session.id,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
    });
  }, [session, library, history]);

  if (!session || !stats) {
    return (
      <>
        <h1 className="page-title">Nothing to show</h1>
        <p className="page-sub">No finished session found.</p>
        <button type="button" className="btn-primary" onClick={() => navigate('/')}>
          Back to Today
        </button>
      </>
    );
  }

  return (
    <>
      <div className="finish-hero">
        <div className="finish-kicker">Session complete</div>
        <h1 className="finish-title">
          {stats.workingSets > 0 ? 'Good work.' : 'Logged.'}
        </h1>
        <p className="page-sub">
          {session.templateName} · {session.location}
          {stats.durationMinutes ? ` · ${stats.durationMinutes} min` : ''}
        </p>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="s-value">
            {stats.volume.toLocaleString()} <span className="s-unit">lb</span>
          </div>
          <div className="s-label">Total volume</div>
        </div>
        <div className="stat-card">
          <div className="s-value">{stats.workingSets}</div>
          <div className="s-label">Sets logged</div>
        </div>
        <div className="stat-card">
          <div className="s-value">{stats.exerciseCount}</div>
          <div className="s-label">Exercises</div>
        </div>
        <div className="stat-card">
          <div className="s-value">{stats.records.length}</div>
          <div className="s-label">Records beaten</div>
        </div>
      </div>

      {stats.records.length > 0 && (
        <section className="card">
          <h2>Records beaten</h2>
          {stats.records.map((r) => (
            <div className="record-item" key={`${r.exerciseId}-${r.type}`}>
              <div className="record-badge">{r.type === 'weight' ? 'WT' : 'REP'}</div>
              <div>
                <div className="record-name">{r.name}</div>
                <div className="record-detail">
                  {r.type === 'weight'
                    ? `${r.value} lb — up from ${r.previous} lb`
                    : `${r.value} reps at ${r.atWeight} lb — up from ${r.previous}`}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h2>Muscles worked</h2>
        <MuscleMap muscles={stats.muscles} />
      </section>

      {stats.workingSets === 0 && (
        <p className="hint">
          No sets were logged for this session, so there is no volume to report. The session still
          counts toward your weekly total.
        </p>
      )}

      <button type="button" className="btn-primary" onClick={() => navigate('/')}>
        Done
      </button>
    </>
  );
}
