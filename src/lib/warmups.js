// Warm-up and cool-down drills.
//
// These are prep movements, not library exercises: they are never loaded,
// never logged for volume, and never subject to freshness rotation. Keeping
// them out of exerciseLibrary means the generator's selection logic does not
// have to special-case "things you do not actually track".
//
// Warm-ups are keyed by movement pattern so the prep matches the session that
// was actually generated — a hinge day mobilises hips, a pressing day opens
// the shoulders.

export const GENERAL_WARMUP = {
  id: 'pulse-raiser',
  name: 'Easy cardio to raise a sweat',
  detail: 'Bike, treadmill or brisk walk. Conversational pace.',
  seconds: 180,
};

export const PATTERN_WARMUPS = {
  squat: [
    { id: 'wu-bodyweight-squat', name: 'Bodyweight Squat', detail: 'Slow, full depth.', reps: 10 },
    { id: 'wu-ankle-rock', name: 'Ankle Rock', detail: 'Drive the knee over the toe.', reps: 8 },
  ],
  hinge: [
    { id: 'wu-hip-hinge', name: 'Unloaded Hip Hinge', detail: 'Push the hips back, flat spine.', reps: 10 },
    { id: 'wu-glute-bridge', name: 'Glute Bridge', detail: 'Squeeze hard at the top.', reps: 12 },
  ],
  horizontalPush: [
    { id: 'wu-scap-pushup', name: 'Scapular Push-Up', detail: 'Protract and retract, arms straight.', reps: 10 },
    { id: 'wu-band-pullapart', name: 'Arm Circles', detail: 'Both directions, full range.', reps: 12 },
  ],
  verticalPush: [
    { id: 'wu-wall-slide', name: 'Wall Slide', detail: 'Ribs down, forearms on the wall.', reps: 10 },
    { id: 'wu-arm-circles', name: 'Shoulder Pass-Through', detail: 'Slow, with a towel or broomstick.', reps: 10 },
  ],
  horizontalPull: [
    { id: 'wu-scap-retraction', name: 'Scapular Retraction', detail: 'Pinch the shoulder blades, hold 2s.', reps: 10 },
    { id: 'wu-thoracic-rotation', name: 'Thoracic Rotation', detail: 'Open-book, each side.', reps: 8 },
  ],
  verticalPull: [
    { id: 'wu-dead-hang', name: 'Dead Hang or Lat Stretch', detail: 'Relax into the stretch.', seconds: 30 },
    { id: 'wu-scap-pull', name: 'Scapular Pull', detail: 'Shoulders down without bending the arms.', reps: 8 },
  ],
  unilateral: [
    { id: 'wu-hip-flexor', name: 'Half-Kneeling Hip Flexor Stretch', detail: 'Tuck the pelvis, each side.', seconds: 30 },
    { id: 'wu-lateral-lunge-bw', name: 'Bodyweight Lateral Lunge', detail: 'Each side, controlled.', reps: 8 },
  ],
  core: [{ id: 'wu-dead-bug-bw', name: 'Dead Bug', detail: 'Slow, ribs down.', reps: 8 }],
  carry: [{ id: 'wu-shoulder-shrug', name: 'Shoulder Shrug', detail: 'Loosen the traps.', reps: 10 }],
};

export const COOLDOWN_DRILLS = [
  { id: 'cd-breathe', name: 'Box Breathing', detail: '4 in, 4 hold, 4 out. Bring the heart rate down.', seconds: 60 },
  { id: 'cd-walk', name: 'Easy Walk', detail: 'Loosen off and let the pump settle.', seconds: 120 },
];

// Pattern-specific stretches for the cool-down, so it reflects what was worked.
export const PATTERN_COOLDOWNS = {
  squat: { id: 'cd-quad', name: 'Quad Stretch', detail: 'Each side.', seconds: 30 },
  hinge: { id: 'cd-hamstring', name: 'Hamstring Stretch', detail: 'Each side, soft knee.', seconds: 30 },
  horizontalPush: { id: 'cd-chest', name: 'Doorway Chest Stretch', detail: 'Each side.', seconds: 30 },
  verticalPush: { id: 'cd-shoulder', name: 'Cross-Body Shoulder Stretch', detail: 'Each side.', seconds: 30 },
  horizontalPull: { id: 'cd-lat', name: 'Lat Stretch', detail: 'Each side.', seconds: 30 },
  verticalPull: { id: 'cd-lat-hang', name: 'Lat Stretch', detail: 'Each side.', seconds: 30 },
  unilateral: { id: 'cd-hipflexor', name: 'Hip Flexor Stretch', detail: 'Each side.', seconds: 30 },
  core: { id: 'cd-cobra', name: 'Cobra Stretch', detail: 'Gentle extension.', seconds: 30 },
  carry: { id: 'cd-forearm', name: 'Forearm Stretch', detail: 'Each side.', seconds: 30 },
};
