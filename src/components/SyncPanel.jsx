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
  'signed-out': 'Not signed in on this device — nothing is syncing.',
  syncing: 'Syncing…',
  synced: 'Everything is synced.',
  offline: 'Offline — changes are saved here and will upload when you reconnect.',
  error: 'Sync problem — changes are safe locally and will retry.',
};

// An installed PWA on iOS gets its own storage container, separate from
// Safari's. A magic link opened in Safari or in Mail's built-in browser signs
// THAT browser in; the app on your Home Screen keeps its own storage and stays
// signed out, with no indication the two are different places. It is the most
// common way a device you are sure you signed in on turns out not to be.
function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari predates the display-mode media query for this.
    window.navigator.standalone === true
  );
}

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

      {/* Say what the queue means, which depends entirely on whether anything
          is draining it. Signed out, "waiting to upload" is not true — nothing
          is waiting, because nothing is trying. */}
      {sync.pending > 0 &&
        (sync.user ? (
          <p className="hint">
            {sync.pending} collection{sync.pending === 1 ? '' : 's'} waiting to upload.
          </p>
        ) : (
          <p className="hint warn">
            {sync.pending} collection{sync.pending === 1 ? '' : 's'} changed on this device and not
            uploaded. They stay here, safely, until you sign in — nothing is being retried in the
            background.
          </p>
        ))}
      {sync.error && <p className="hint warn">{sync.error}</p>}

      {/* What the last read actually returned.
          "Synced" on a device showing none of your history is otherwise an
          unanswerable screen: you cannot tell an account that really is empty
          from a read that came back empty for a reason nobody printed. */}
      {sync.user && <LastPull pull={sync.lastPull} />}

      <p className="hint build-stamp">
        Build {__BUILD_SHA__} · {new Date(__BUILD_TIME__).toLocaleString()}
      </p>

      {sync.user ? (
        <>
          <p className="hint">Signed in as {sync.user.email}</p>
          <div className="sync-actions">
            <button type="button" className="btn-secondary" onClick={() => syncNow()}>
              Pull from cloud
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
            {isStandalone() && (
              <p className="hint warn">
                You are in the installed app, which has its own separate storage from Safari.
                Opening the link in Safari or in Mail&apos;s built-in browser signs <em>that</em>{' '}
                browser in and leaves this app signed out. Long-press the link and choose to open
                it in Autopilot, or paste it into this app.
              </p>
            )}
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
            {isStandalone() && (
              <p className="hint">
                Signed in on your phone but seeing this screen? The installed app keeps its own
                storage, separate from Safari — signing in there does not sign in here. Send
                yourself a link and open it from inside this app.
              </p>
            )}
          </form>
        )
      ) : null}
    </section>
  );
}

// Reports the last read from the cloud in the terms you would actually ask
// about it: did it happen, did it come back, and how much was in it.
function LastPull({ pull }) {
  if (!pull) return <p className="hint">No cloud read yet on this device.</p>;

  const when = new Date(pull.at).toLocaleTimeString();

  if (pull.failed) {
    return (
      <p className="hint warn">
        Last cloud read failed at {when}: {pull.message}
      </p>
    );
  }

  // Zero rows from a read that definitely ran and was definitely authenticated
  // is real information — it means the account is genuinely empty, not that
  // something swallowed the answer.
  if (pull.collections === 0) {
    return (
      <p className="hint">
        Last cloud read at {when} returned nothing — this account has no data stored yet.
      </p>
    );
  }

  return (
    <p className="hint">
      Last cloud read at {when}: {pull.collections} collection
      {pull.collections === 1 ? '' : 's'}, {pull.sessions} logged session
      {pull.sessions === 1 ? '' : 's'}
      {pull.applied > 0 ? ` · ${pull.applied} applied to this device` : ' · already up to date'}.
    </p>
  );
}
