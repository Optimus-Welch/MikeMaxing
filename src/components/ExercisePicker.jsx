import { useEffect, useMemo, useRef } from 'react';
import { alternativesFor } from '../lib/liftGenerator.js';
import { CAP_STRATEGY_LABELS } from '../lib/exercises.js';
import { demoFor } from '../lib/demos.js';
import DemoLink from './DemoLink.jsx';

// Sheet listing swap alternatives for one slot.
//
// Rendered as an overlay rather than a route so opening it from run mode never
// unmounts the run screen — closing puts you back on the exact same set, with
// the rest timer still running underneath.

export default function ExercisePicker({ current, location, library, onPick, onClose }) {
  const closeRef = useRef(null);

  const alternatives = useMemo(
    () => alternativesFor({ exercise: current, location, library }),
    [current, location, library],
  );

  // Escape closes; focus starts on the close button so the sheet is reachable
  // by keyboard as well as thumb.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const primary = (current?.primaryMuscles ?? []).join(', ');

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Swap ${current?.name ?? 'exercise'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <div className="eyebrow">Swap · {location}</div>
            <h2 className="sheet-title">{current?.name}</h2>
            {primary && <p className="hint">Alternatives for {primary}</p>}
          </div>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {alternatives.length === 0 ? (
          <p className="empty-state">
            No alternatives work the same muscles with the equipment at {location}.
          </p>
        ) : (
          <ul className="alt-list">
            {alternatives.map((alt) => (
              <li key={alt.id} className="alt-item">
                <button type="button" className="alt-pick" onClick={() => onPick(alt)}>
                  <span className="alt-name">{alt.name}</span>
                  <span className="alt-meta">
                    {alt.primaryMuscles.join(' · ')}
                    {alt.capStrategy ? ` · ${CAP_STRATEGY_LABELS[alt.capStrategy] ?? alt.capStrategy}` : ''}
                  </span>
                </button>
                <DemoLink demo={demoFor(alt)} compact />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
