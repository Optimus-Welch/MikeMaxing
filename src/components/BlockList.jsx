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

export default function BlockList({ blocks, onSwap }) {
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
