import { useEffect, useRef } from 'react';

// The whole workout, seen from inside the guided flow.
//
// Purely a view over the run state: it renders `steps` and `results` and calls
// nothing that mutates them, so opening and closing it cannot move your
// position. The run screen stays mounted underneath — any rest timer keeps
// counting, and its live value is shown at the top of this panel so you are not
// flying blind while you scroll.

const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, Math.ceil(s)) % 60).padStart(2, '0')}`;

export default function SessionOverlay({ steps, results, currentIndex, restRemaining, onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Group the flat step list back into blocks for display.
  const blocks = [];
  steps.forEach((step, index) => {
    let block = blocks.find((b) => b.id === step.blockId);
    if (!block) {
      block = {
        id: step.blockId,
        name: step.blockName,
        subtitle: step.blockSubtitle,
        totalRounds: step.totalRounds,
        entries: [],
      };
      blocks.push(block);
    }
    block.entries.push({ step, index });
  });

  const workSteps = steps.filter((s) => s.kind === 'exercise');
  const doneCount = Object.values(results).filter((r) => r.done).length;

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet is-tall"
        role="dialog"
        aria-modal="true"
        aria-label="Full workout"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <div className="eyebrow">Full workout</div>
            <h2 className="sheet-title">
              {doneCount}/{workSteps.length} sets
            </h2>
            {restRemaining != null && (
              <p className="hint overlay-timer">Resting · {fmt(restRemaining)} left</p>
            )}
          </div>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="overlay-scroll">
          {blocks.map((block) => {
            // Rounds collapse into one row per exercise; the per-round detail
            // is the tick marks, not repeated lines.
            const byExercise = [];
            for (const { step, index } of block.entries) {
              if (step.kind === 'rest') continue;
              const key = step.item.exerciseId ?? step.item.id;
              let row = byExercise.find((r) => r.key === key);
              if (!row) {
                row = { key, name: step.item.name, kind: step.kind, rounds: [] };
                byExercise.push(row);
              }
              row.rounds.push({
                index,
                round: step.round,
                done: !!results[step.key]?.done,
                skipped: !!results[step.key]?.skipped,
                current: index === currentIndex,
              });
            }

            const blockDone = byExercise.every((r) => r.rounds.every((x) => x.done || x.skipped));

            return (
              <section className={`overlay-block${blockDone ? ' is-done' : ''}`} key={block.id}>
                <div className="overlay-block-head">
                  {block.totalRounds > 1 && <span className="round-badge">{block.totalRounds}×</span>}
                  <span className="block-title">
                    {block.name}
                    {block.subtitle && <span className="block-subtitle"> — {block.subtitle}</span>}
                  </span>
                </div>

                {byExercise.map((row) => (
                  <div
                    className={`overlay-row${row.rounds.some((r) => r.current) ? ' is-current' : ''}`}
                    key={row.key}
                  >
                    <span className="overlay-name">{row.name}</span>
                    <span className="overlay-ticks" aria-label={`${row.rounds.filter((r) => r.done).length} of ${row.rounds.length} done`}>
                      {row.rounds.map((r) => (
                        <span
                          key={r.index}
                          className={
                            'tick' +
                            (r.done ? ' is-done' : '') +
                            (r.skipped ? ' is-skipped' : '') +
                            (r.current ? ' is-current' : '')
                          }
                          title={`Round ${r.round}`}
                        />
                      ))}
                    </span>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
