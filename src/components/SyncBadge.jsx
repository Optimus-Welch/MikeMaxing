import { useEffect, useState } from 'react';
import { subscribeSync } from '../lib/syncStore.js';

// Small ambient indicator on Today. Only appears when there is something worth
// saying — a silent badge in the corner is noise, not information.

export default function SyncBadge() {
  const [sync, setSync] = useState(null);
  useEffect(() => subscribeSync(setSync), []);

  if (!sync || sync.status === 'local-only' || sync.status === 'synced') return null;

  const label =
    sync.status === 'offline'
      ? sync.pending
        ? `Offline · ${sync.pending} to upload`
        : 'Offline'
      : sync.status === 'syncing'
        ? 'Syncing…'
        : sync.status === 'error'
          ? 'Sync retrying'
          : sync.pending
            ? `${sync.pending} unsynced`
            : null;

  if (!label) return null;

  return (
    <div className={`sync-badge is-${sync.status}`} role="status">
      <span className="sync-dot" aria-hidden="true" />
      {label}
    </div>
  );
}
