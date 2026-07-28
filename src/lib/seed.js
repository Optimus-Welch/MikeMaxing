// Initial data for a fresh install. Only used the first time a collection
// is read and nothing exists in localStorage yet — see ensureSeeded() in db.js.

export const seedProfile = {
  units: 'lb',
  // Weekly targets. This is the single source of truth for "how many lifts
  // and cardio sessions per week" — the Settings screen edits this object
  // directly rather than keeping a second copy elsewhere.
  goals: {
    liftsPerWeek: 2,
    cardioPerWeek: 2,
  },
};

export const seedEquipment = {
  Work: {
    strength: [
      { name: 'Barbell + squat rack', note: 'No weight limit' },
      { name: 'Machines' },
      { name: 'Dumbbells', note: 'Full range' },
    ],
    cardio: [
      { name: 'Bike' },
      { name: 'Stair machine' },
      { name: 'Treadmill' },
      { name: 'Rower' },
    ],
  },
  Home: {
    strength: [
      { name: 'Adjustable dumbbells', note: 'Up to 52.5 lb/hand' },
      { name: 'Adjustable barbell + curl bar', note: 'Up to 80 lb total' },
      { name: 'Adjustable bench' },
    ],
    cardio: [
      { name: 'Indoor bike', note: 'Kickr' },
      { name: 'Treadmill' },
    ],
  },
};

// Readiness config, edited on the Settings screen. Weekly targets live on
// `profile.goals` instead of here (see comment above) so there is only one
// place that number is stored.
export const seedSettings = {
  // How much each input contributes to the 0-100 readiness score. Inputs
  // that are missing on a given day (e.g. no energy rating) are simply
  // dropped and the remaining weights are renormalized — see
  // computeReadiness() in readiness.js.
  readinessWeights: {
    sleep: 0.6,
    load: 0.3,
    energy: 0.1,
  },
  // Lower bound (inclusive) for each band. Anything below `orange` is Red.
  bands: {
    green: 80,
    yellow: 55,
    orange: 35,
  },
};
