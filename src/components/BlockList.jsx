import { demoFor } from '../lib/demos.js';
import DemoLink from './DemoLink.jsx';

// The session overview: named blocks, round counts, and rest shown as a real
// item with a duration rather than something implied between lines.
//
// `onSwap` is optional — when provided, each working exercise gets a swap
// button so the plan can be adjusted before you start.

function formatRest(seconds) {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s ? `${m}:${String(s).padStart(2, '0')}` : `${m} min`;
  }
  return `${seconds}s`;
}

function itemTarget(item) {
  if (item.kind === 'rest') return formatRest(item.seconds);
  if (item.kind === 'prep') {
    if (item.seconds) return `${item.seconds}s`;
    return item.reps ? `${item.reps} reps` : '';
  }
  return item.prescription ?? '';
}

// The suggested load for one exercise, with the reason and a stepper.
//
// The stepper moves in the equipment's real increment and refuses to go past
// the location's ceiling, so every number it can produce is one you can
// actually load. `onAdjust` is optional — without it this is read-only.
function SuggestionRow({ item, location, onAdjust }) {
  const s = item.suggestion;
  if (!s || s.weight == null) {
    return s?.note ? <div className="bi-progression">{s.note}</div> : null;
  }

  const cap = s.equipment?.cap ?? null;
  const atCap = cap != null && s.weight >= cap;

  return (
    <div className="bi-progression">
      {onAdjust ? (
        <span className="weight-stepper">
          <button
            type="button"
            className="icon-btn is-small"
            aria-label={`Less weight for ${item.name}`}
            onClick={() => onAdjust(item, -1)}
          >
            −
          </button>
          <span className="ws-value">{s.weight} lb</span>
          <button
            type="button"
            className="icon-btn is-small"
            aria-label={`More weight for ${item.name}`}
            disabled={atCap}
            title={atCap ? `${cap} lb is the ceiling at ${location}` : undefined}
            onClick={() => onAdjust(item, 1)}
          >
            +
          </button>
        </span>
      ) : (
        <span className="ws-value">{s.weight} lb</span>
      )}
      <span className={`bi-why${s.verdict === 'deload' ? ' is-back-off' : ''}`}>{s.note}</span>
    </div>
  );
}

export default function BlockList({ blocks, onSwap, onAdjustWeight, location }) {
  return (
    <>
      {blocks.map((block) => (
        <section className="block" key={block.id}>
          <div className="block-head">
            {block.rounds > 1 && <span className="round-badge">{block.rounds}×</span>}
            <span className="block-title">
              {block.name}
              {block.subtitle && <span className="block-subtitle"> — {block.subtitle}</span>}
            </span>
          </div>

          <ul className="block-items">
            {block.items.map((item, i) => (
              <li
                className={`block-item${item.kind === 'rest' ? ' is-rest' : ''}`}
                key={`${block.id}-${item.exerciseId ?? item.id ?? i}`}
              >
                <div className="bi-main">
                  <div className="bi-name">{item.kind === 'rest' ? 'Rest' : item.name}</div>
                  {item.kind !== 'rest' && (item.detail || item.schemeName) && (
                    <div className="bi-detail">{item.detail ?? item.schemeName}</div>
                  )}
                  {item.kind === 'exercise' && (
                    <SuggestionRow item={item} location={location} onAdjust={onAdjustWeight} />
                  )}
                </div>

                <div className="bi-side">
                  <span className="bi-target">{itemTarget(item)}</span>
                  {item.kind === 'exercise' && (
                    <span className="bi-actions">
                      <DemoLink demo={demoFor(item)} compact />
                      {onSwap && (
                        <button
                          type="button"
                          className="icon-btn is-small"
                          onClick={() => onSwap(item)}
                          aria-label={`Swap ${item.name}`}
                          title="Swap this exercise"
                        >
                          ⇄
                        </button>
                      )}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
