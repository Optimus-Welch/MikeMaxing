import { useEffect, useState } from 'react';
import { sendMagicLink, signOut } from '../lib/auth.js';
import { subscribeSync, syncNow } from '../lib/syncStore.js';

// Sign-in and sync status, shown in Settings.
//
// Sign-in is optional on purpose. The app is fully usable signed out — it just
// stays on this device. Gating a gym app behind an email round trip would mean
// no workout whenever the network is poor, which is exactly when you are in a
// basement gym.

const STATUS_TEXT = {
  'local-only': 'Local only — no cloud project configured for this build.',
  'signed-out': 'Signed out. Your data is on this device only.',
  syncing: 'Syncing…',
  synced: 'Everything is synced.',
  offline: 'Offline — changes are saved here and will upload when you reconnect.',
  error: 'Sync problem — changes are safe locally and will retry.',
};

export default function SyncPanel() {
  const [sync, setSync] = useState(null);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => subscribeSync(setSync), []);
  if (!sync) return null;

  async function handleSend(e) {
    e.preventDefault();
    setSending(true);
    setError(null);
    const res = await sendMagicLink(email);
    setSending(false);
    if (res.ok) setSent(true);
    else setError(res.error);
  }

  const statusClass =
    sync.status === 'synced'
      ? 'is-ok'
      : sync.status === 'error'
        ? 'is-bad'
        : sync.status === 'offline'
          ? 'is-warn'
          : '';

  return (
    <section className="card">
      <h2>Cloud sync</h2>

      <div className={`sync-status ${statusClass}`}>
        <span className="sync-dot" aria-hidden="true" />
        <span>{STATUS_TEXT[sync.status] ?? sync.status}</span>
      </div>

      {sync.pending > 0 && (
        <p className="hint">
          {sync.pending} change{sync.pending === 1 ? '' : 's'} waiting to upload.
        </p>
      )}
      {sync.error && <p className="hint warn">{sync.error}</p>}

      {sync.user ? (
        <>
          <p className="hint">Signed in as {sync.user.email}</p>
          <div className="sync-actions">
            <button type="button" className="btn-secondary" onClick={() => syncNow()}>
              Sync now
            </button>
            <button type="button" className="btn-secondary" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
          <p className="hint">
            Signing out leaves this device&apos;s copy in place. Your data stays in the cloud.
          </p>
        </>
      ) : sync.configured ? (
        sent ? (
          <>
            <p className="hint">
              Check your email — the link signs you straight in, no password. Open it on whichever
              device you want to sync.
            </p>
            <button type="button" className="btn-secondary" onClick={() => setSent(false)}>
              Use a different email
            </button>
          </>
        ) : (
          <form onSubmit={handleSend}>
            <div className="field">
              <label htmlFor="sync-email">Email</label>
              <input
                id="sync-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn-primary" disabled={sending}>
              {sending ? 'Sending…' : 'Email me a sign-in link'}
            </button>
            {error && <p className="hint warn">{error}</p>}
            <p className="hint">
              No password and no signup step — the first link both creates the account and signs
              you in.
            </p>
          </form>
        )
      ) : null}
    </section>
  );
}
