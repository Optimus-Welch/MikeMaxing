import { useEffect, useRef, useState } from 'react';
import {
  META_FIELDS,
  applySessionEdit,
  draftFromSession,
  editChangesAnything,
  emptySetRow,
  isLiftSession,
} from '../lib/sessionEdit.js';
import { parseLocalDate } from '../lib/weekly.js';

// Correcting a session that was already logged.
//
// Deliberately plain: it is a form over the numbers you entered, not a second
// run screen. Nothing here re-runs generation or re-prescribes anything — the
// targets a session was given stay exactly as they were, and only what you
// actually did is editable. See sessionEdit.js for why.
//
// Date, type and location are shown as read-only context. They decide which
// week a session counts in and which ledger progression reads it from, so
// changing them would be a move rather than a correction.

export default function SessionEditor({ session, onSave, onClose }) {
  const [draft, setDraft] = useState(() => draftFromSession(session));
  const closeRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lift = isLiftSession(session);
  const dirty = editChangesAnything(session, draft);

  function setMeta(key, value) {
    setDraft((d) => ({ ...d, meta: { ...d.meta, [key]: value } }));
  }

  function setField(exIndex, setIndex, field, value) {
    setDraft((d) => ({
      ...d,
      exercises: d.exercises.map((ex, i) =>
        i !== exIndex
          ? ex
          : {
              ...ex,
              sets: ex.sets.map((s, j) => (j === setIndex ? { ...s, [field]: value } : s)),
            },
      ),
    }));
  }

  function addSet(exIndex) {
    setDraft((d) => ({
      ...d,
      exercises: d.exercises.map((ex, i) =>
        i === exIndex ? { ...ex, sets: [...ex.sets, emptySetRow()] } : ex,
      ),
    }));
  }

  // Clearing rather than splicing: an emptied row is dropped on save (see
  // applySessionEdit), and leaving it in place keeps the other rows' numbering
  // stable while you are still typing.
  function clearSet(exIndex, setIndex) {
    setDraft((d) => ({
      ...d,
      exercises: d.exercises.map((ex, i) =>
        i !== exIndex
          ? ex
          : { ...ex, sets: ex.sets.map((s, j) => (j === setIndex ? emptySetRow() : s)) },
      ),
    }));
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet is-tall"
        role="dialog"
        aria-modal="true"
        aria-label="Edit logged session"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <div className="eyebrow">Edit logged session</div>
            <h2 className="sheet-title">{session.templateName ?? session.type}</h2>
            <p className="hint">
              {session.type}
              {session.location ? ` · ${session.location}` : ''} · {formatDate(session.date)}
            </p>
          </div>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="overlay-scroll">
          <p className="hint edit-note">
            Fixing what was entered. Date, type and location stay as they are, and so do the
            targets this session was given — only what you actually did is editable.
          </p>

          {/* Minutes and distance. Shown for non-lift sessions, where they are
              the whole content of the log, and they are what Trends is missing. */}
          {!lift && (
            <section className="edit-block">
              <div className="edit-block-head">{session.type} session</div>
              <div className="settings-grid">
                {META_FIELDS.map((field) => (
                  <div className="field" key={field.key}>
                    <label htmlFor={`edit-${field.key}`}>{field.label}</label>
                    <input
                      id={`edit-${field.key}`}
                      type="number"
                      inputMode="decimal"
                      step={field.step}
                      min="0"
                      placeholder="—"
                      value={draft.meta[field.key]}
                      onChange={(e) => setMeta(field.key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
              <p className="hint">
                Leave a box empty for &quot;not recorded&quot;. Filling these in is also what makes
                them appear on Trends, which currently lists them as not logged.
              </p>
            </section>
          )}

          {lift &&
            draft.exercises.map((exercise, exIndex) => (
              <section className="edit-block" key={`${exercise.exerciseId}-${exIndex}`}>
                <div className="edit-block-head">{exercise.name}</div>

                <div className="edit-row is-head" aria-hidden="true">
                  <span className="edit-set-no">Set</span>
                  <span>Weight</span>
                  <span>Reps</span>
                  <span>RPE</span>
                  <span />
                </div>

                {exercise.sets.map((set, setIndex) => (
                  <div className="edit-row" key={setIndex}>
                    <span className="edit-set-no">{setIndex + 1}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="2.5"
                      min="0"
                      placeholder="—"
                      aria-label={`${exercise.name} set ${setIndex + 1} weight`}
                      value={set.weight}
                      onChange={(e) => setField(exIndex, setIndex, 'weight', e.target.value)}
                    />
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      placeholder="—"
                      aria-label={`${exercise.name} set ${setIndex + 1} reps`}
                      value={set.reps}
                      onChange={(e) => setField(exIndex, setIndex, 'reps', e.target.value)}
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min="0"
                      max="10"
                      placeholder="—"
                      aria-label={`${exercise.name} set ${setIndex + 1} RPE`}
                      value={set.rpe}
                      onChange={(e) => setField(exIndex, setIndex, 'rpe', e.target.value)}
                    />
                    <button
                      type="button"
                      className="icon-btn is-small"
                      aria-label={`Clear ${exercise.name} set ${setIndex + 1}`}
                      title="Clear this set"
                      onClick={() => clearSet(exIndex, setIndex)}
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <button type="button" className="btn-ghost" onClick={() => addSet(exIndex)}>
                  + Add a set
                </button>
              </section>
            ))}

          {lift && draft.exercises.length === 0 && (
            <p className="empty-state">This session recorded no exercises.</p>
          )}
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!dirty}
            onClick={() => onSave(applySessionEdit(session, draft))}
          >
            {dirty ? 'Save changes' : 'No changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso) {
  return parseLocalDate(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
