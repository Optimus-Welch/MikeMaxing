// Small inline-SVG charts. No charting library: the whole need here is a line
// and a bar, and a dependency for that would cost more bundle than the app's
// own source.
//
// Everything scales through a viewBox and is sized by CSS, so the same markup
// works from a phone to an iPad without measuring anything.
//
// Sparse data is the normal case, not an error case. One point draws one dot,
// two points draw a line, zero points draw an empty frame with its axis — never
// a "not enough data" message standing where a chart should be.

const W = 320;
const H = 120;
const PAD = { left: 30, right: 8, top: 10, bottom: 20 };

const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

function scaleY(value, min, max) {
  if (max === min) return PAD.top + plotH / 2;
  return PAD.top + plotH - ((value - min) / (max - min)) * plotH;
}

function scaleX(index, count) {
  if (count <= 1) return PAD.left + plotW / 2;
  return PAD.left + (index / (count - 1)) * plotW;
}

// Rounded to something a person would read off an axis.
function niceBounds(values) {
  if (!values.length) return { min: 0, max: 1 };
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    // A single distinct value still deserves a sensible band around it.
    const pad = Math.max(1, Math.abs(min) * 0.1);
    return { min: Math.max(0, min - pad), max: max + pad };
  }
  const span = max - min;
  min = Math.max(0, min - span * 0.1);
  max = max + span * 0.1;
  return { min, max };
}

const fmt = (n) => (Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n)));

function EmptyFrame({ label }) {
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: nothing logged yet`}>
        <line
          x1={PAD.left}
          y1={PAD.top + plotH}
          x2={W - PAD.right}
          y2={PAD.top + plotH}
          className="axis"
        />
        <text x={W / 2} y={H / 2} className="chart-empty-text" textAnchor="middle">
          Nothing logged yet
        </text>
      </svg>
    </div>
  );
}

/**
 * A line over time.
 *
 * @param points  [{ x: label, y: number, tone?: 'accent'|'warn'|'muted' }]
 *                `tone` colours an individual dot — used to mark things like
 *                which sessions met their suggested weight.
 */
export function LineChart({ points = [], label, unit = '', showDots = true }) {
  const usable = points.filter((p) => p.y != null && Number.isFinite(Number(p.y)));
  if (!usable.length) return <EmptyFrame label={label} />;

  const values = usable.map((p) => Number(p.y));
  const { min, max } = niceBounds(values);

  const coords = usable.map((p, i) => ({
    ...p,
    cx: scaleX(i, usable.length),
    cy: scaleY(Number(p.y), min, max),
  }));

  const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.cx} ${c.cy}`).join(' ');
  const area = `${path} L${coords[coords.length - 1].cx} ${PAD.top + plotH} L${coords[0].cx} ${PAD.top + plotH} Z`;

  const first = usable[0];
  const last = usable[usable.length - 1];

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}: ${usable.length} points, from ${fmt(values[0])}${unit} on ${first.x} to ${fmt(values[values.length - 1])}${unit} on ${last.x}`}
      >
        <line x1={PAD.left} y1={PAD.top} x2={W - PAD.right} y2={PAD.top} className="gridline" />
        <line
          x1={PAD.left}
          y1={PAD.top + plotH}
          x2={W - PAD.right}
          y2={PAD.top + plotH}
          className="axis"
        />

        <text x={PAD.left - 5} y={PAD.top + 4} className="tick" textAnchor="end">
          {fmt(max)}
        </text>
        <text x={PAD.left - 5} y={PAD.top + plotH} className="tick" textAnchor="end">
          {fmt(min)}
        </text>

        {coords.length > 1 && <path d={area} className="line-area" />}
        {coords.length > 1 && <path d={path} className="line-path" />}

        {showDots &&
          coords.map((c, i) => (
            <circle
              key={`${c.x}-${i}`}
              cx={c.cx}
              cy={c.cy}
              r={coords.length > 40 ? 1.8 : 3}
              className={`line-dot${c.tone ? ` is-${c.tone}` : ''}`}
            />
          ))}

        <text x={PAD.left} y={H - 6} className="tick">
          {first.x}
        </text>
        {usable.length > 1 && (
          <text x={W - PAD.right} y={H - 6} className="tick" textAnchor="end">
            {last.x}
          </text>
        )}
      </svg>
    </div>
  );
}

/**
 * Grouped bars over time, with an optional target line.
 *
 * @param rows    [{ label, values: [{ key, value, tone }] }]
 * @param target  draws a dashed reference line at this value
 */
export function BarChart({ rows = [], label, target = null, unit = '' }) {
  if (!rows.length) return <EmptyFrame label={label} />;

  const all = rows.flatMap((r) => r.values.map((v) => v.value));
  const max = Math.max(1, ...all, target ?? 0);

  const groupW = plotW / rows.length;
  const barCount = Math.max(1, rows[0].values.length);
  const barW = Math.max(2, (groupW * 0.7) / barCount);

  const summary = rows
    .slice(-4)
    .map((r) => `${r.label}: ${r.values.map((v) => `${v.value}${unit}`).join(', ')}`)
    .join('; ');

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}. Most recent — ${summary}`}>
        <line
          x1={PAD.left}
          y1={PAD.top + plotH}
          x2={W - PAD.right}
          y2={PAD.top + plotH}
          className="axis"
        />
        <text x={PAD.left - 5} y={PAD.top + 4} className="tick" textAnchor="end">
          {fmt(max)}
        </text>

        {target != null && (
          <line
            x1={PAD.left}
            y1={scaleY(target, 0, max)}
            x2={W - PAD.right}
            y2={scaleY(target, 0, max)}
            className="target-line"
          />
        )}

        {rows.map((row, ri) => {
          const groupX = PAD.left + ri * groupW + (groupW - barW * barCount) / 2;
          return row.values.map((v, vi) => {
            const h = (v.value / max) * plotH;
            return (
              <rect
                key={`${row.label}-${v.key}-${ri}-${vi}`}
                x={groupX + vi * barW}
                y={PAD.top + plotH - h}
                width={Math.max(1.5, barW - 1)}
                height={Math.max(v.value > 0 ? 1.5 : 0, h)}
                className={`bar is-${v.tone ?? 'accent'}`}
              />
            );
          });
        })}

        <text x={PAD.left} y={H - 6} className="tick">
          {rows[0].label}
        </text>
        {rows.length > 1 && (
          <text x={W - PAD.right} y={H - 6} className="tick" textAnchor="end">
            {rows[rows.length - 1].label}
          </text>
        )}
      </svg>
    </div>
  );
}

/**
 * Horizontal bars for ranked categories — muscle groups, where the labels are
 * words and a vertical axis would be unreadable on a phone.
 */
export function RankedBars({ rows = [], unit = '', emptyText = 'Nothing logged yet' }) {
  if (!rows.length) return <p className="hint">{emptyText}</p>;

  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <ul className="ranked-bars">
      {rows.map((row) => (
        <li key={row.label}>
          <span className="rb-label">{row.label}</span>
          <span className="rb-track">
            <span
              className="rb-fill"
              style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
            />
          </span>
          <span className="rb-value">
            {fmt(row.value)}
            {unit}
            {row.sub != null && <em className="rb-sub"> {row.sub}</em>}
          </span>
        </li>
      ))}
    </ul>
  );
}
