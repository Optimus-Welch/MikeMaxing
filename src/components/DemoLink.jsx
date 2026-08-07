// Button that opens an exercise demonstration.
//
// Today every demo is kind 'search' and opens YouTube in a new tab. If a
// self-hosted clip is added later (see lib/demos.js) this component is the only
// place that needs an inline player — callers already just pass demoFor(ex).

export default function DemoLink({ demo, compact = false }) {
  if (!demo) return null;

  return (
    <a
      className={compact ? 'demo-link is-compact' : 'demo-link'}
      href={demo.url}
      target="_blank"
      // noopener/noreferrer: the opened tab gets no handle back to this page.
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label={`${demo.label} — opens in a new tab`}
    >
      <span aria-hidden="true">▶</span>
      {!compact && <span>{demo.label}</span>}
    </a>
  );
}
