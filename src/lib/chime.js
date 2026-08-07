// Timer chimes.
//
// iOS Safari (including an installed PWA launched from the home screen) will
// not let a page produce sound unless an AudioContext was created or resumed
// inside a real user gesture. A chime fired from a setInterval an hour later is
// not a gesture, so the context has to be primed on the START WORKOUT tap —
// that is the one guaranteed tap before any timer can end.
//
// The tone is synthesised with an oscillator rather than loaded from a file:
// no asset to fetch, no decode step, and it works offline in the installed PWA
// with nothing extra in the service worker precache.

let ctx = null;
let primed = false;

function AudioCtor() {
  return typeof window === 'undefined' ? null : window.AudioContext ?? window.webkitAudioContext;
}

/**
 * Call from inside a user gesture (the START WORKOUT tap).
 *
 * Creating the context is not enough on iOS — one that starts life 'suspended'
 * stays silent. It has to be resumed, and a zero-gain blip has to actually run
 * through it, before Safari treats it as unlocked.
 */
export function initAudio() {
  const Ctor = AudioCtor();
  if (!Ctor) return false;

  try {
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') ctx.resume();

    // Silent 1-sample blip to satisfy the unlock requirement.
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);

    primed = true;
    return true;
  } catch {
    // Audio is a nicety; never let it break the workout.
    return false;
  }
}

/** True once the context has been unlocked by a gesture. */
export const isAudioReady = () => primed && ctx != null;

/**
 * Two-note chime. `enabled` is the user's mute setting — checked here so no
 * caller can forget it.
 */
export function playChime({ enabled = true } = {}) {
  if (!enabled || !ctx) return false;

  try {
    // Backgrounding the tab (phone locks mid-rest) suspends the context. It can
    // be resumed without a fresh gesture once it has been unlocked once.
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    // A rising two-note figure reads as "go" rather than "alarm".
    playTone(now, 880, 0.16);
    playTone(now + 0.18, 1318.5, 0.28);
    return true;
  } catch {
    return false;
  }
}

function playTone(startAt, frequency, duration) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.value = frequency;

  // Short attack and an exponential tail — a raw square edge sounds like a
  // click and clips unpleasantly through a phone speaker.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.35, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/** Test hook — lets the check script inject a fake AudioContext. */
export function __setContextForTest(fake) {
  ctx = fake;
  primed = fake != null;
}
