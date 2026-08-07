// How to show someone what a lift looks like.
//
// Deliberately a LINK-OUT, not embedded media: nothing here copies, hotlinks
// or proxies video or images from any fitness app or other copyrighted source.
// The app sends you to a YouTube search for the exercise name and you watch it
// there, on their site, under their terms.
//
// The indirection exists so self-hosted clips can be dropped in later without
// touching any component. Every caller asks demoFor(exercise) and renders
// whatever it gets back — give an exercise a `demoUrl`, or add an entry to
// DEMO_CLIPS, and that exercise starts pointing at your own footage instead.
// Only the `kind` changes; the UI already branches on it.

/**
 * Self-hosted clips, keyed by exercise id. Empty for now.
 * e.g. 'back-squat': '/clips/back-squat.mp4'
 */
export const DEMO_CLIPS = {};

const YOUTUBE_SEARCH = 'https://www.youtube.com/results?search_query=';

/**
 * Where to send someone who wants to see how an exercise is performed.
 *
 * Returns { kind, url, label }:
 *   kind 'clip'   — a clip we host ourselves; a future viewer can play inline
 *   kind 'search' — an external search, opened in a new tab
 */
export function demoFor(exercise) {
  if (!exercise) return null;

  const id = exercise.exerciseId ?? exercise.id;
  const name = exercise.name ?? '';

  // Per-exercise override wins, then the clip table, then the search fallback.
  const hosted = exercise.demoUrl ?? DEMO_CLIPS[id];
  if (hosted) {
    return { kind: 'clip', url: hosted, label: 'Watch demo' };
  }

  // Strip the parenthetical coaching cue — "Tempo Goblet Squat (4s down)"
  // searches far better as "Tempo Goblet Squat form".
  const cleaned = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  return {
    kind: 'search',
    url: `${YOUTUBE_SEARCH}${encodeURIComponent(`${cleaned} exercise form`)}`,
    label: 'How to',
  };
}
