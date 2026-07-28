const TYPE_ICON = { Lift: '🏋️', Cardio: '🏃', Rest: '💤' };

export default function HistoryList({ sessions, limit = 8 }) {
  const recent = sessions.slice(0, limit);

  if (recent.length === 0) {
    return <p className="empty-state">No sessions logged yet.</p>;
  }

  return (
    <ul className="history-list">
      {recent.map((session) => (
        <li key={session.id} className="history-item">
          <span className="type-tag">
            {TYPE_ICON[session.type] ?? ''} {session.type}
          </span>
          <span className="meta">
            {session.templateId ? `${session.templateId} · ` : ''}
            {Array.isArray(session.exercises) && session.exercises.length
              ? `${session.exercises.length} exercises · `
              : ''}
            {session.location} · {formatDate(session.date)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
