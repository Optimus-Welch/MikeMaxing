// A simple front/back body diagram drawn as SVG shapes — no images, no
// external assets. Regions light up in the accent colour in proportion to how
// much of the session hit them.
//
// The shapes are deliberately crude blocks rather than anatomical outlines:
// at phone size a readable "that's the back, it's lit up" beats a detailed
// drawing nobody can parse.

import { REGION_LABELS, regionIntensities } from '../lib/muscleMap.js';

export default function MuscleMap({ muscles }) {
  const intensity = regionIntensities(muscles);

  // Worked regions glow; untouched ones stay as faint outlines.
  const fill = (region) => {
    const v = intensity[region];
    if (!v) return 'var(--surface-2)';
    // Floor the opacity so a lightly-worked region is still visibly "on".
    return `rgba(214, 255, 63, ${(0.25 + v * 0.75).toFixed(2)})`;
  };

  const worked = Object.entries(intensity).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <svg
        className="muscle-map"
        viewBox="0 0 200 150"
        role="img"
        aria-label={`Muscle groups worked: ${worked.map(([r]) => REGION_LABELS[r]).join(', ') || 'none'}`}
      >
        <g stroke="var(--border)" strokeWidth="0.75">
          {/* ---------------- FRONT view ---------------- */}
          <text x="45" y="10" fill="var(--text-dim)" fontSize="7" fontWeight="700" textAnchor="middle" stroke="none">
            FRONT
          </text>
          {/* head */}
          <circle cx="45" cy="24" r="7" fill="var(--surface-2)" />
          {/* shoulders */}
          <rect x="27" y="34" width="10" height="9" rx="4" fill={fill('shoulders')} />
          <rect x="53" y="34" width="10" height="9" rx="4" fill={fill('shoulders')} />
          {/* chest */}
          <rect x="36" y="34" width="18" height="13" rx="4" fill={fill('chest')} />
          {/* core */}
          <rect x="37" y="49" width="16" height="16" rx="4" fill={fill('core')} />
          {/* arms */}
          <rect x="25" y="45" width="8" height="20" rx="4" fill={fill('arms')} />
          <rect x="57" y="45" width="8" height="20" rx="4" fill={fill('arms')} />
          {/* quads */}
          <rect x="36" y="67" width="8" height="24" rx="4" fill={fill('quads')} />
          <rect x="46" y="67" width="8" height="24" rx="4" fill={fill('quads')} />
          {/* calves */}
          <rect x="37" y="93" width="6" height="18" rx="3" fill={fill('calves')} />
          <rect x="47" y="93" width="6" height="18" rx="3" fill={fill('calves')} />

          {/* ---------------- BACK view ---------------- */}
          <text x="145" y="10" fill="var(--text-dim)" fontSize="7" fontWeight="700" textAnchor="middle" stroke="none">
            BACK
          </text>
          <circle cx="145" cy="24" r="7" fill="var(--surface-2)" />
          {/* traps */}
          <rect x="136" y="33" width="18" height="8" rx="3" fill={fill('traps')} />
          {/* shoulders */}
          <rect x="127" y="35" width="10" height="9" rx="4" fill={fill('shoulders')} />
          <rect x="153" y="35" width="10" height="9" rx="4" fill={fill('shoulders')} />
          {/* lats / back */}
          <rect x="136" y="42" width="18" height="14" rx="4" fill={fill('back')} />
          {/* lower back */}
          <rect x="138" y="58" width="14" height="8" rx="3" fill={fill('lowerback')} />
          {/* arms */}
          <rect x="125" y="46" width="8" height="20" rx="4" fill={fill('arms')} />
          <rect x="157" y="46" width="8" height="20" rx="4" fill={fill('arms')} />
          {/* glutes */}
          <rect x="136" y="68" width="18" height="11" rx="5" fill={fill('glutes')} />
          {/* hamstrings */}
          <rect x="136" y="81" width="8" height="20" rx="4" fill={fill('hamstrings')} />
          <rect x="146" y="81" width="8" height="20" rx="4" fill={fill('hamstrings')} />
          {/* calves */}
          <rect x="137" y="103" width="6" height="14" rx="3" fill={fill('calves')} />
          <rect x="147" y="103" width="6" height="14" rx="3" fill={fill('calves')} />
        </g>
      </svg>

      <div className="muscle-legend">
        {worked.length === 0 && <span className="muscle-chip">No loaded work recorded</span>}
        {worked.map(([region, v]) => (
          <span key={region} className={`muscle-chip${v > 0.6 ? ' is-primary' : ''}`}>
            {REGION_LABELS[region]}
          </span>
        ))}
      </div>
    </div>
  );
}
