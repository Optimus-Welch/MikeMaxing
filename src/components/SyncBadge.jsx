import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { subscribeSync } from '../lib/syncStore.js';
import { describeSync } from '../lib/syncMessages.js';

// Ambient sync indicator on Today.
//
// Appears only when there is something worth saying — "synced" and "no cloud
// configured" both render nothing, because a permanent badge in the corner is
// decoration rather than information.
//
// What it must never do is describe one state in the language of another. The
// version this replaces labelled a signed-out device "2 UNSYNCED", which reads
// as two uploads stuck in a queue. There was no queue running: without a
// session syncNow() returns immediately, so the device was not behind, it was
// not syncing at all. The two situations need opposite reactions — one is
// "wait", the other is "sign in" — so they cannot share a label.
//
// The number is gone as well. `pending` counts COLLECTIONS, not workouts, so
// "2" meant two internal buckets were dirty and read like two lost sessions.

export default function SyncBadge() {
  const navigate = useNavigate();
  const [sync, setSync] = useState(null);
  useEffect(() => subscribeSync(setSync), []);

  if (!sync) return null;

  const info = describeSync(sync.status, sync.pending);
  if (!info) return null;

  const detail = sync.status === 'error' && sync.error ? sync.error : info.detail;
  const Tag = info.action ? 'button' : 'div';

  return (
    <Tag
      type={info.action ? 'button' : undefined}
      className={`sync-banner is-${info.tone}`}
      onClick={info.action === 'settings' ? () => navigate('/settings') : undefined}
      role={info.action ? undefined : 'status'}
    >
      <span className="sync-dot" aria-hidden="true" />
      <span className="sync-banner-text">
        <span className="sync-banner-title">{info.short}</span>
        {detail && <span className="sync-banner-detail">{detail}</span>}
      </span>
      {info.action && (
        <span className="sync-banner-go" aria-hidden="true">
          ›
        </span>
      )}
    </Tag>
  );
}
