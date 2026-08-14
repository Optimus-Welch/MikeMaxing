import { SYNC_STATUSES } from './syncStore.js';

// What each sync status means, in words a person can act on.
//
// Pure and shared, so the badge on Today and the card in Settings cannot drift
// apart, and so the mapping can be tested without a DOM. It is exhaustive over
// SYNC_STATUSES by construction: an unmapped status throws in development
// rather than quietly falling through to whatever branch happens to be last —
// which is the bug this file exists to prevent. `signed-out` used to land in a
// trailing "N unsynced" branch and so a device that had never signed in
// reported a stuck upload queue.

/**
 * @param status  one of SYNC_STATUSES
 * @param pending how many collections have unsent local changes
 * @returns {{ tone, short, detail, action }} — `action` is set when tapping
 *          the indicator should take you somewhere that can fix it.
 */
export function describeSync(status, pending = 0) {
  switch (status) {
    case 'local-only':
      // No project configured in this build. Nothing to say and nothing to do.
      return null;

    case 'signed-out':
      return {
        tone: 'warn',
        short: 'Not signed in',
        // The distinction the old badge erased: this is not a backlog that is
        // draining slowly, it is sync never having started on this device.
        detail: pending
          ? 'Your workouts are saved here but are not going to the cloud. Sign in to sync them.'
          : 'This device is not syncing. Sign in to see your history everywhere.',
        action: 'settings',
      };

    case 'signin-failed':
      return {
        tone: 'bad',
        short: 'Sign-in did not complete',
        // The state that used to be invisible: you followed the link, it did
        // nothing, and the screen said "Not signed in" — exactly what it says
        // when you never tried.
        detail: 'The link was opened but no session was created. Open Settings to try again.',
        action: 'settings',
      };

    case 'syncing':
      return { tone: 'busy', short: 'Syncing…', detail: null, action: null };

    case 'synced':
      // The quiet, correct state. A badge here would be pure noise.
      return null;

    case 'offline':
      return {
        tone: 'warn',
        short: 'Offline',
        detail: pending
          ? 'Changes are saved on this device and will upload when you reconnect.'
          : 'Changes are saved on this device.',
        action: null,
      };

    case 'error':
      return {
        tone: 'bad',
        short: 'Sync failing',
        detail: 'Your data is safe on this device. Open Settings for the reason.',
        action: 'settings',
      };

    default:
      throw new Error(`describeSync: unhandled status "${status}"`);
  }
}

/** Every status is mapped — the check script asserts this holds. */
export const DESCRIBED_STATUSES = SYNC_STATUSES;
