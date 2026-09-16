import { parseLocalDate } from '../lib/weekly.js';

const TYPE_ICON = { Lift: '🏋️', Cardio: '🏃', Rest: '💤' };

// `onSelect` is optional — without it this stays the read-only list it was.
// With it, each row becomes a button that opens the session for correction.
export default function HistoryList({ sessions, limit = 8, onSelect }) {
  const recent = sessions.slice(0, limit);

  if (recent.length === 0) {
    return <p className="empty-state">No sessions logged yet.</p>;
  }

  return (
    <ul className="history-list">
      {recent.map((session) => {
        const body = (
          <>
            <span className="type-tag">
              {TYPE_ICON[session.type] ?? ''} {session.type}
            </span>
            <span className="meta">
              {session.templateId ? `${session.templateId} · ` : ''}
              {Array.isArray(session.exercises) && session.exercises.length
                ? `${session.exercises.length} exercises · `
                : ''}
              {session.location} · {formatDate(session.date)}
              {session.editedAt ? ' · edited' : ''}
            </span>
          </>
        );

        return (
          <li key={session.id} className="history-item">
            {onSelect ? (
              <button
                type="button"
                className="history-row-btn"
                onClick={() => onSelect(session)}
                aria-label={`Edit ${session.type} session on ${formatDate(session.date)}`}
              >
                {body}
                <span className="history-edit-hint" aria-hidden="true">
                  Edit
                </span>
              </button>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

function formatDate(iso) {
  // Shared helper — display and the weekly count must parse dates the same
  // way, or the list can show a session that the tally does not count.
  const d = parseLocalDate(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
