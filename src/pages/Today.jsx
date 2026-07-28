import { useMemo, useState } from 'react';
import {
  getProfile,
  getSessionHistory,
  getSettings,
  addSession,
  upsertReadinessEntry,
} from '../lib/db.js';
import { computeReadiness, scoreToBand, recommendSession } from '../lib/readiness.js';
import { weeklyCounts, todayISO } from '../lib/weekly.js';
import HistoryList from '../components/HistoryList.jsx';

const LOAD_OPTIONS = [1, 2, 3, 4, 5];
const ENERGY_OPTIONS = [1, 2, 3, 4, 5];
const SESSION_TYPES = ['Lift', 'Cardio', 'Rest'];
const LOCATIONS = ['Work', 'Home'];

export default function Today() {
  // Loaded once — these collections only change via the actions below, so
  // we update local state directly instead of re-reading localStorage.
  const [profile] = useState(getProfile);
  const [settings] = useState(getSettings);
  const [sessionHistory, setSessionHistory] = useState(getSessionHistory);

  const [sleepScore, setSleepScore] = useState('');
  const [load, setLoad] = useState(null);
  const [energy, setEnergy] = useState(null);
  const [manualLocation, setManualLocation] = useState(null);
  const [loggedType, setLoggedType] = useState(null); // overrides the recommended type when set
  const [justLogged, setJustLogged] = useState(false);

  const today = useMemo(() => new Date(), []);

  const readinessScore = useMemo(
    () =>
      computeReadiness(
        { sleepScore: sleepScore === '' ? null : Number(sleepScore), load, energy },
        settings.readinessWeights,
      ),
    [sleepScore, load, energy, settings.readinessWeights],
  );

  const band = readinessScore != null ? scoreToBand(readinessScore, settings.bands) : null;

  const counts = useMemo(() => weeklyCounts(sessionHistory, today), [sessionHistory, today]);

  const recommendation = useMemo(() => {
    if (!band) return null;
    return recommendSession({ band, counts, goals: profile.goals, date: today, manualLocation });
  }, [band, counts, profile.goals, today, manualLocation]);

  const selectedType = loggedType ?? recommendation?.type ?? null;
  const selectedLocation = recommendation?.location ?? manualLocation;

  function handleLogSession() {
    if (!selectedType || !selectedLocation) return;

    const dateISO = todayISO(today);

    if (readinessScore != null) {
      upsertReadinessEntry({
        date: dateISO,
        sleepScore: sleepScore === '' ? null : Number(sleepScore),
        load,
        energy,
        score: readinessScore,
        band,
      });
    }

    const session = {
      id: crypto.randomUUID(),
      type: selectedType,
      location: selectedLocation,
      date: dateISO,
    };
    setSessionHistory(addSession(session));
    setJustLogged(true);
    setTimeout(() => setJustLogged(false), 2000);
  }

  return (
    <>
      <h1 className="page-title">Today</h1>

      <section className="card">
        <h2>Readiness</h2>
        <div className="field">
          <label htmlFor="sleep">Sleep score (0-100)</label>
          <input
            id="sleep"
            type="number"
            min="0"
            max="100"
            inputMode="numeric"
            placeholder="e.g. 82"
            value={sleepScore}
            onChange={(e) => setSleepScore(e.target.value)}
          />
        </div>

        <div className="field">
          <label>Training load this week (1 = easy, 5 = very hard)</label>
          <div className="pill-group" role="group" aria-label="Training load">
            {LOAD_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                className="pill"
                aria-pressed={load === n}
                onClick={() => setLoad(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Energy (optional)</label>
          <div className="pill-group" role="group" aria-label="Energy rating">
            {ENERGY_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                className="pill"
                aria-pressed={energy === n}
                onClick={() => setEnergy(energy === n ? null : n)}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="hint">Tap a number again to clear it.</p>
        </div>
      </section>

      {readinessScore != null && (
        <section className="card">
          <div className={`band-banner band-${band}`}>
            <span className="score">{readinessScore}</span>
            <span className="band-label">{band}</span>
          </div>

          {recommendation && (
            <div className="recommendation">
              <div className="type">
                {recommendation.type} · {selectedLocation}
              </div>
              <p className="rationale">{recommendation.rationale}</p>

              <div className="field">
                <label>Location</label>
                <div className="pill-group" role="group" aria-label="Location">
                  {LOCATIONS.map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      className="pill"
                      aria-pressed={selectedLocation === loc}
                      onClick={() => setManualLocation(loc)}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
                {manualLocation && manualLocation !== recommendation.defaultLocation && (
                  <p className="hint">Default for today is {recommendation.defaultLocation}.</p>
                )}
              </div>

              <div className="field">
                <label>Session actually done</label>
                <div className="pill-group" role="group" aria-label="Session type to log">
                  {SESSION_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="pill"
                      aria-pressed={selectedType === type}
                      onClick={() => setLoggedType(type)}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <button type="button" className="btn-primary" onClick={handleLogSession}>
                {justLogged ? 'Logged ✓' : 'Log session'}
              </button>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h2>This week</h2>
        <p className="hint">
          Lifts {counts.Lift}/{profile.goals.liftsPerWeek} · Cardio {counts.Cardio}/
          {profile.goals.cardioPerWeek}
        </p>
      </section>

      <section className="card">
        <h2>Recent sessions</h2>
        <HistoryList sessions={sessionHistory} />
      </section>
    </>
  );
}
