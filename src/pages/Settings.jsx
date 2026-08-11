import { useId, useState } from 'react';
import { getProfile, getSettings, updateProfile, updateSettings } from '../lib/db.js';
import { MAX_LIFT_EXERCISES } from '../lib/liftGenerator.js';
import SyncPanel from '../components/SyncPanel.jsx';

const BAND_ORDER = ['Green', 'Yellow', 'Orange', 'Red'];

export default function Settings() {
  const [profile, setProfile] = useState(getProfile);
  const [settings, setSettings] = useState(getSettings);
  const [saved, setSaved] = useState(false);

  function setDuration(band, key, value) {
    setSettings((s) => ({
      ...s,
      durationTargets: {
        ...s.durationTargets,
        [band]: { ...s.durationTargets[band], [key]: value },
      },
    }));
  }

  function setBand(key, value) {
    setSettings((s) => ({ ...s, bands: { ...s.bands, [key]: value } }));
  }

  function setGoal(key, value) {
    setProfile((p) => ({ ...p, goals: { ...p.goals, [key]: value } }));
  }

  function handleSave(e) {
    e.preventDefault();
    updateSettings({
      bands: settings.bands,
      durationTargets: settings.durationTargets,
      freshnessWindow: settings.freshnessWindow,
      soundEnabled: settings.soundEnabled,
    });
    updateProfile({ goals: profile.goals });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <>
      <h1 className="page-title">Settings</h1>

      <SyncPanel />

      <form onSubmit={handleSave}>
        <section className="card">
          <h2>Band thresholds</h2>
          <p className="hint">
            Minimum Garmin Training Readiness score to reach each band. Below Orange is Red.
          </p>
          <div className="settings-grid">
            <NumberField
              label="Green ≥"
              value={settings.bands.green}
              onChange={(v) => setBand('green', v)}
            />
            <NumberField
              label="Yellow ≥"
              value={settings.bands.yellow}
              onChange={(v) => setBand('yellow', v)}
            />
            <NumberField
              label="Orange ≥"
              value={settings.bands.orange}
              onChange={(v) => setBand('orange', v)}
            />
          </div>
        </section>

        <section className="card">
          <h2>Weekly targets</h2>
          <div className="settings-grid">
            <NumberField
              label="Lifts / week"
              value={profile.goals.liftsPerWeek}
              onChange={(v) => setGoal('liftsPerWeek', v)}
            />
            <NumberField
              label="Cardio / week"
              value={profile.goals.cardioPerWeek}
              onChange={(v) => setGoal('cardioPerWeek', v)}
            />
          </div>
        </section>

        <section className="card">
          <h2>Session length</h2>
          <p className="hint">
            How much session each band buys. This is the duration axis — how many exercises a lift
            contains and how long to spend on cardio. How <em>hard</em> the work is (reps, sets,
            RPE) is set by the band itself and is not configured here. A lift tops out at{' '}
            {MAX_LIFT_EXERCISES} exercises — that is how many movement slots a template has.
          </p>
          {BAND_ORDER.map((band) => (
            <div key={band} style={{ marginTop: 16 }}>
              <div className={`eyebrow band-${band}`} style={{ marginBottom: 8 }}>
                {band}
              </div>
              <div className="settings-grid">
                <NumberField
                  label="Lift exercises"
                  value={settings.durationTargets[band].liftExercises}
                  max={MAX_LIFT_EXERCISES}
                  onChange={(v) => setDuration(band, 'liftExercises', v)}
                />
                <NumberField
                  label="Cardio minutes"
                  value={settings.durationTargets[band].cardioMinutes}
                  step="5"
                  onChange={(v) => setDuration(band, 'cardioMinutes', v)}
                />
              </div>
            </div>
          ))}
        </section>

        <section className="card">
          <h2>Sound</h2>
          <p className="hint">
            A chime plays when a rest timer runs out. Audio is unlocked when you tap START WORKOUT —
            iOS will not allow a sound that no tap led to, so chimes stay silent until a session
            begins.
          </p>
          <div className="toggle-row">
            <span className="toggle-label">Rest timer chime</span>
            <button
              type="button"
              className="toggle"
              role="switch"
              aria-checked={settings.soundEnabled !== false}
              aria-label="Rest timer chime"
              onClick={() =>
                setSettings((s) => ({ ...s, soundEnabled: !(s.soundEnabled !== false) }))
              }
            >
              <span className="toggle-knob" />
            </button>
          </div>
        </section>

        <section className="card">
          <h2>Exercise variety</h2>
          <p className="hint">
            How many recent lift sessions the generator looks back over before it will reuse a
            movement family (all flat-press variations count as one family). Higher means more
            variety; set to 0 to turn the rule off. Where a location has only one option for a
            pattern, it repeats regardless and is marked as such.
          </p>
          <div className="settings-grid">
            <NumberField
              label="Avoid repeats for (sessions)"
              value={settings.freshnessWindow}
              onChange={(v) => setSettings((s) => ({ ...s, freshnessWindow: v }))}
            />
          </div>
        </section>

        <button type="submit" className="btn-primary">
          {saved ? 'Saved ✓' : 'Save settings'}
        </button>
      </form>
    </>
  );
}

function NumberField({ label, value, onChange, step = '1', max }) {
  // Tie the label to the input so screen readers announce it (and so the
  // label is a tap target for the field on touch devices).
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        min="0"
        max={max}
        value={value}
        // Clamp on the way in so a typed-over-the-max value cannot be saved.
        onChange={(e) =>
          onChange(max == null ? Number(e.target.value) : Math.min(Number(e.target.value), max))
        }
      />
    </div>
  );
}
