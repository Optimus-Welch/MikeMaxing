// Checks for the swap-alternatives list, demo link-out and chime gating.
// Run with `npm run check:qol`.

import { seedExerciseLibrary, LOCATION_LOAD_CAPS, CAP_SENSITIVE_PATTERNS } from '../src/lib/exercises.js';
import { generateLiftSession, alternativesFor, swapExerciseTo } from '../src/lib/liftGenerator.js';
import { demoFor } from '../src/lib/demos.js';

const library = seedExerciseLibrary;
let failures = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`  ASSERT FAILED: ${msg}`);
    failures++;
  }
};

// --- 1. alternatives share a primary muscle and fit the location ----------
console.log('=== swap alternatives ===');
for (const location of ['Work', 'Home']) {
  const session = generateLiftSession({ location, band: 'Yellow', library, seed: 5 });
  const have = { Work: 8, Home: 4 }[location];
  console.log(`\n${location}:`);

  for (const ex of session.exercises) {
    const alts = alternativesFor({ exercise: ex, location, library });
    const full = library.find((l) => l.id === ex.exerciseId);
    console.log(`  ${ex.name.padEnd(40)} -> ${String(alts.length).padStart(2)} alternatives`);

    assert(!alts.some((a) => a.id === ex.exerciseId), `${ex.name}: list must exclude itself`);

    for (const alt of alts) {
      // shares a primary muscle
      assert(
        alt.primaryMuscles.some((m) => full.primaryMuscles.includes(m)),
        `${ex.name} -> ${alt.name}: no shared primary muscle`,
      );
      // possible at this location
      assert(
        alt.locations.includes(location),
        `${ex.name} -> ${alt.name}: not tagged for ${location}`,
      );
      const equip = {
        Work: ['barbell', 'dumbbells', 'bench', 'machine', 'cable', 'bodyweight', 'rack', 'pullupBar'],
        Home: ['barbell', 'dumbbells', 'bench', 'bodyweight'],
      }[location];
      assert(
        alt.equipment.every((t) => equip.includes(t)),
        `${ex.name} -> ${alt.name}: needs equipment ${location} lacks`,
      );
      // weight-cap rule, same as generation
      const caps = LOCATION_LOAD_CAPS[location];
      const capped = caps.dumbbellPerHand != null || caps.barbellTotal != null;
      if (
        capped &&
        CAP_SENSITIVE_PATTERNS.includes(full.movementPattern) &&
        CAP_SENSITIVE_PATTERNS.includes(alt.movementPattern)
      ) {
        assert(
          alt.capFriendly === true,
          `${ex.name} -> ${alt.name}: cap-sensitive at ${location} but not capFriendly`,
        );
      }
    }
  }
  void have;
}

// --- 2. picking from the list produces a proper session entry -------------
console.log('\n=== swapExerciseTo ===');
{
  const session = generateLiftSession({ location: 'Work', band: 'Green', library, seed: 11 });
  const target = session.exercises[0];
  const alts = alternativesFor({ exercise: target, location: 'Work', library });
  assert(alts.length > 0, 'expected alternatives for the first slot');

  const chosen = alts[0];
  const next = swapExerciseTo({ session, index: 0, exercise: chosen, seed: 3 });
  const replaced = next.exercises[0];

  console.log(`  ${target.name} -> ${replaced.name}`);
  console.log(`    prescription: ${replaced.prescription} (${replaced.schemeName})`);

  assert(replaced.exerciseId === chosen.id, 'swap must install the chosen exercise');
  assert(replaced.emphasis === target.emphasis, 'emphasis must be preserved');
  assert(replaced.prescription, 'replacement must be prescribed like a generated pick');
  assert(replaced.sets > 0, 'replacement must have sets');
  assert(
    next.exercises.slice(1).every((e, i) => e.exerciseId === session.exercises[i + 1].exerciseId),
    'other slots must be untouched',
  );
  // Same-shape check against a generated entry.
  for (const key of ['exerciseId', 'name', 'pattern', 'variationGroup', 'emphasis', 'schemeId', 'sets']) {
    assert(key in replaced, `replacement is missing ${key} — shape drifted from generated entries`);
  }
}

// --- 3. demo link-out ------------------------------------------------------
console.log('\n=== demo links ===');
{
  const samples = ['back-squat', 'tempo-goblet-squat', 'farmers-carry'];
  for (const id of samples) {
    const ex = library.find((e) => e.id === id);
    const demo = demoFor(ex);
    console.log(`  ${ex.name}\n     -> ${demo.url}`);
    assert(demo.kind === 'search', `${id}: default demo should be a search link`);
    assert(demo.url.startsWith('https://www.youtube.com/results?'), `${id}: must be a YouTube search`);
    // No third-party media is embedded or hotlinked anywhere.
    assert(!/\.(mp4|webm|gif|jpg|png)$/i.test(demo.url), `${id}: must not point at a media file`);
  }
  // Parenthetical coaching cues are stripped from the query.
  const tempo = demoFor(library.find((e) => e.id === 'tempo-goblet-squat'));
  assert(!tempo.url.includes('4s+down'), 'the parenthetical cue should not be in the search query');

  // A hosted clip overrides the search without any UI change.
  const hosted = demoFor({ id: 'x', name: 'X', demoUrl: '/clips/x.mp4' });
  assert(hosted.kind === 'clip' && hosted.url === '/clips/x.mp4', 'demoUrl must win over search');
  console.log('  hosted-clip override ->', JSON.stringify(hosted));
}

// --- 4. chime respects the mute setting and needs a primed context --------
console.log('\n=== chime gating ===');
{
  const chime = await import('../src/lib/chime.js');

  // No context yet (nothing has been primed): must not throw, must not play.
  chime.__setContextForTest(null);
  assert(chime.playChime({ enabled: true }) === false, 'must not play before audio is primed');
  assert(chime.isAudioReady() === false, 'audio should not report ready before priming');

  // Fake a primed context and count the oscillators it creates.
  let started = 0;
  let resumed = 0;
  const node = () => ({
    connect() {},
    start() {
      started++;
    },
    stop() {},
    frequency: {},
    gain: {
      setValueAtTime() {},
      exponentialRampToValueAtTime() {},
    },
  });
  chime.__setContextForTest({
    state: 'suspended',
    currentTime: 0,
    destination: {},
    resume() {
      resumed++;
      this.state = 'running';
    },
    createOscillator: node,
    createGain: node,
  });

  assert(chime.playChime({ enabled: false }) === false, 'muted setting must suppress the chime');
  assert(started === 0, 'muted chime must not start any oscillator');

  assert(chime.playChime({ enabled: true }) === true, 'unmuted chime should play');
  assert(started === 2, `expected a two-note chime, got ${started} tones`);
  assert(resumed === 1, 'a suspended context must be resumed before playing');
  console.log(`  played ${started} tones, resumed suspended context ${resumed}x, mute respected`);

  chime.__setContextForTest(null);
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
