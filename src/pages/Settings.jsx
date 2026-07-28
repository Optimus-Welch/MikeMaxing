import { useState } from 'react';
import { getProfile, getSettings, updateProfile, updateSettings } from '../lib/db.js';

export default function Settings() {
  const [profile, setProfile] = useState(getProfile);
  const [settings, setSettings] = useState(getSettings);
  const [saved, setSaved] = useState(false);

  function setWeight(key, value) {
    setSettings((s) => ({ ...s, readinessWeights: { ...s.readinessWeights, [key]: value } }));
  }

  function setBand(key, value) {
    setSettings((s) => ({ ...s, bands: { ...s.bands, [key]: value } }));
  }

  function setGoal(key, value) {
    setProfile((p) => ({ ...p, goals: { ...p.goals, [key]: value } }));
  }

  function handleSave(e) {
    e.preventDefault();
    updateSettings({ readinessWeights: settings.readinessWeights, bands: settings.bands });
    updateProfile({ goals: profile.goals });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <>
      <h1 className="page-title">Settings</h1>

      <form onSubmit={handleSave}>
        <section className="card">
          <h2>Readiness weights</h2>
          <p className="hint">
            How much each input contributes to the score. They don't need to sum to 1 — missing
            inputs (e.g. no energy rating) are dropped and the rest are rebalanced automatically.
          </p>
          <div className="settings-grid">
            <NumberField
              label="Sleep"
              value={settings.readinessWeights.sleep}
              step="0.05"
              onChange={(v) => setWeight('sleep', v)}
            />
            <NumberField
              label="Load"
              value={settings.readinessWeights.load}
              step="0.05"
              onChange={(v) => setWeight('load', v)}
            />
            <NumberField
              label="Energy"
              value={settings.readinessWeights.energy}
              step="0.05"
              onChange={(v) => setWeight('energy', v)}
            />
          </div>
        </section>

        <section className="card">
          <h2>Band thresholds</h2>
          <p className="hint">Minimum score (0-100) to reach each band. Below Orange is Red.</p>
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

        <button type="submit" className="btn-primary">
          {saved ? 'Saved ✓' : 'Save settings'}
        </button>
      </form>
    </>
  );
}

function NumberField({ label, value, onChange, step = '1' }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min="0"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
