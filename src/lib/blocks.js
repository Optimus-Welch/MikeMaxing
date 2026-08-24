// Turns a generated session into named BLOCKS, and blocks into a flat list of
// STEPS for run mode.
//
// This is presentation structure only — it consumes whatever
// liftGenerator.generateLiftSession() produced and never re-picks exercises.
// The engine (readiness, selection, freshness) is untouched.
//
//   session.exercises  ->  blocks[]  ->  steps[]
//                          (screen)      (run mode)
//
// A block is a named group performed for N rounds. Within a round you do each
// item in order; rest is an explicit item with a duration, not an afterthought.
//
// Blocks containing heavy compound lifts additionally carry `rampItems`: the
// warm-up sets walking up to the working weight (see warmupRamp.js). They are
// performed once, before round 1, and are never logged as working sets.

import {
  GENERAL_WARMUP,
  PATTERN_WARMUPS,
  COOLDOWN_DRILLS,
  PATTERN_COOLDOWNS,
} from './warmups.js';
import { warmupRampFor, WARMUP_REST_SECONDS } from './warmupRamp.js';

// Rest between working sets, by how heavy the slot is. Orange (recovery-ish)
// days get slightly shorter rests since the loads are lighter anyway.
const REST_BY_EMPHASIS = { primary: 150, secondary: 90, accessory: 60 };

function restSeconds(emphasis, band) {
  const base = REST_BY_EMPHASIS[emphasis] ?? 90;
  return band === 'Orange' ? Math.round(base * 0.7) : base;
}

/**
 * Group a generated session into blocks.
 * Returns { blocks, totalRounds, estimatedMinutes }.
 */
export function buildBlocks(session) {
  if (!session?.exercises?.length) return { blocks: [], estimatedMinutes: 0 };

  const band = session.band;
  const blocks = [];

  const primaries = session.exercises.filter((e) => e.emphasis === 'primary');
  const secondaries = session.exercises.filter((e) => e.emphasis === 'secondary');
  const accessories = session.exercises.filter((e) => e.emphasis === 'accessory');

  // -- WARM UP: prep drawn from the patterns this session actually trains ---
  const patterns = [...new Set(session.exercises.map((e) => e.pattern))];
  const warmupItems = [
    { kind: 'prep', ...GENERAL_WARMUP },
    // Only prep the main patterns — a full nine-pattern warm-up is a workout.
    ...patterns
      .slice(0, 3)
      .flatMap((p) => (PATTERN_WARMUPS[p] ?? []).map((d) => ({ kind: 'prep', ...d }))),
  ];
  blocks.push({
    id: 'warmup',
    name: 'WARM UP',
    subtitle: null,
    rounds: 1,
    items: warmupItems,
  });

  // -- PRIMARY STRENGTH: one block per main lift, straight sets -------------
  const PRIMARY_LABELS = ['MAIN LIFT', 'SECOND LIFT', 'THIRD LIFT'];
  primaries.forEach((ex, i) => {
    blocks.push({
      id: `primary-${i}`,
      name: 'PRIMARY STRENGTH',
      subtitle: PRIMARY_LABELS[i] ?? `LIFT ${i + 1}`,
      rounds: ex.sets ?? 3,
      rampItems: warmupRampFor(ex, session.location),
      items: [
        { kind: 'exercise', ...ex },
        { kind: 'rest', seconds: restSeconds('primary', band) },
      ],
    });
  });

  // -- ACCESSORY WORK: paired into circuits ---------------------------------
  // Secondaries run as one block (they are the supersets the generator already
  // paired), accessories as another. Rounds = the largest set count in the
  // group, so nothing gets short-changed.
  const ACCESSORY_LABELS = ['BLOCK A', 'BLOCK B', 'BLOCK C'];
  const groups = [secondaries, accessories].filter((g) => g.length > 0);
  groups.forEach((group, i) => {
    const rounds = Math.max(...group.map((e) => e.sets ?? 3));
    const emphasis = group[0].emphasis;
    blocks.push({
      id: `accessory-${i}`,
      name: 'ACCESSORY WORK',
      subtitle: ACCESSORY_LABELS[i] ?? `BLOCK ${i + 1}`,
      rounds,
      // A heavy compound can land in a secondary slot (a barbell row, a hip
      // thrust) — it still gets its walk-up, done before the circuit starts.
      rampItems: group.flatMap((ex) => warmupRampFor(ex, session.location)),
      items: [
        ...group.map((ex) => ({ kind: 'exercise', ...ex })),
        { kind: 'rest', seconds: restSeconds(emphasis, band) },
      ],
    });
  });

  // -- COOL DOWN ------------------------------------------------------------
  const cooldownItems = [
    ...patterns
      .slice(0, 2)
      .map((p) => PATTERN_COOLDOWNS[p])
      .filter(Boolean)
      .map((d) => ({ kind: 'prep', ...d })),
    ...COOLDOWN_DRILLS.map((d) => ({ kind: 'prep', ...d })),
  ];
  blocks.push({
    id: 'cooldown',
    name: 'COOL DOWN',
    subtitle: null,
    rounds: 1,
    items: cooldownItems,
  });

  return { blocks, estimatedMinutes: estimateMinutes(blocks) };
}

// Rough wall-clock estimate: work sets ~40s, prep uses its own duration, rest
// is exact. Good enough to set expectations on the session screen.
function estimateMinutes(blocks) {
  let seconds = 0;
  for (const block of blocks) {
    // Ramp sets happen once, before round 1, each followed by a short rest.
    seconds += (block.rampItems?.length ?? 0) * (30 + WARMUP_REST_SECONDS);
    for (let r = 0; r < block.rounds; r++) {
      for (const item of block.items) {
        if (item.kind === 'rest') seconds += item.seconds;
        else if (item.kind === 'prep') seconds += item.seconds ?? 30;
        else seconds += item.seconds ?? 40;
      }
    }
  }
  return Math.round(seconds / 60);
}

/**
 * Flatten blocks into the linear sequence run mode walks through.
 *
 * Each step carries everything the run screen needs to render without looking
 * anything else up: where you are, what to do, and how much is left.
 * A trailing rest at the end of a block's final round is dropped — you move on
 * to the next block instead of resting into nothing.
 */
export function buildRunSteps(blocks) {
  const steps = [];

  blocks.forEach((block, blockIndex) => {
    // Warm-up ramp first, once, each set followed by a short rest — including
    // after the last one, so you catch your breath before the first real set.
    const ramp = block.rampItems ?? [];
    ramp.forEach((item, wi) => {
      const shared = {
        blockId: block.id,
        blockName: block.name,
        blockSubtitle: block.subtitle,
        blockIndex,
        round: 1,
        totalRounds: block.rounds,
        warmupIndex: wi + 1,
        warmupCount: ramp.length,
      };
      steps.push({
        key: `${block.id}-warmup${wi + 1}-${item.exerciseId}`,
        kind: 'warmup',
        ...shared,
        item,
      });
      steps.push({
        key: `${block.id}-warmup${wi + 1}-${item.exerciseId}-rest`,
        kind: 'rest',
        ...shared,
        item: { kind: 'rest', seconds: WARMUP_REST_SECONDS },
      });
    });

    for (let round = 1; round <= block.rounds; round++) {
      const isLastRound = round === block.rounds;

      block.items.forEach((item) => {
        // Drop the trailing rest on a block's last round — you move straight
        // into the next block rather than resting into nothing.
        if (item.kind === 'rest' && isLastRound) return;

        steps.push({
          key: `${block.id}-r${round}-${item.kind}-${item.exerciseId ?? item.id ?? steps.length}`,
          kind: item.kind,
          blockId: block.id,
          blockName: block.name,
          blockSubtitle: block.subtitle,
          blockIndex,
          round,
          totalRounds: block.rounds,
          item,
        });
      });
    }
  });

  return steps;
}

// Steps that count as "work you tick off" — used for progress and for the
// finish screen. Rest and prep are not achievements.
export const isWorkStep = (step) => step.kind === 'exercise';

/**
 * Build the persisted run state for a generated session. Lives here rather
 * than in the Run component so the page module exports only its component.
 */
export function createRunState({ session, location, band, date }) {
  const { blocks } = buildBlocks(session);
  return {
    id: crypto.randomUUID(),
    date,
    location,
    band,
    templateId: session.templateId,
    templateName: session.templateName,
    seed: session.seed,
    session,
    steps: buildRunSteps(blocks),
    index: 0,
    results: {},
    startedAt: Date.now(),
    restEndsAt: null,
  };
}
