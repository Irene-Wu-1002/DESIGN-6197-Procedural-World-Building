/**
 * Flowers, scent, wind and butterflies: every simulation parameter in one
 * place. These are simplified, documented rules chosen so the behaviour is
 * readable at this scale. They are NOT measured values for any real species.
 *
 * Units: metres, seconds of ecology time (real seconds, see TIME), °C,
 * nectar and energy in arbitrary "units" (1 nectar unit drunk = 1 energy
 * unit gained).
 *
 * Plain data only, no Three.js.
 */

// --- Time -------------------------------------------------------------
// The ecology runs on world seconds (simulation/worldClock.js: none while the
// World is paused, 1/60 s per Step), scaled by the simulation: 0.25× slows it; faster clock speeds (4×, 20×) only speed the day,
// not the animals (a butterfly at 20× would just be a blur).
export const TIME = {
  // Fixed sub-steps: agents at 60 Hz, scent particles at 30 Hz.
  agentStep: 1 / 60,
  particleStep: 1 / 30,
  // At most this many sub-steps per frame; a longer gap (after a pause, a
  // hidden tab) is dropped rather than replayed.
  maxAgentSteps: 6,
  maxParticleSteps: 3,
  maxScale: 1,
}

// --- Wind -------------------------------------------------------------
// The Habitat and Weather wind strengths are percentages (0–1 here). This is
// the one place that turns them into a world speed: 100% wind moves air at
// SPEED_AT_FULL m/s at flower height (a light breeze on the forest floor).
// Direction: the Habitat "Direction" is where the wind comes FROM; scent
// drifts the opposite way (downwind), the way the wind blows TO.
export const WIND = {
  speedAtFull: 0.6,
  // The local wind (Habitat field: direction turned and gusting a little
  // from place to place, faster over ridges, calm in hollows) is sampled on
  // this grid (m) and cached until the habitat changes.
  cell: 0.1,
  cacheLimit: 40000,
}

// --- Flowers ----------------------------------------------------------
// The flower head sits at this height in the flower geometry's unit space
// (coverMeshes.js uses the same number).
export const FLOWER_TOP = 0.87
// Scent types (one per flower type here, but kept separate from the type so
// another flower could share a scent).
export const SCENT_TYPES = [
  { id: 'green', label: 'green, fresh', color: '#d9f2c4' },
  { id: 'honey', label: 'honeyed', color: '#d8cdf7' },
  { id: 'spice', label: 'clove-like', color: '#f6c3d6' },
]

/**
 * Flower types. Appearance (form, colours, visual salience, UV pattern),
 * scent and nectar reward are separate on purpose: the strongest scent
 * (campion) carries little nectar; the deep bellflower holds the most but
 * only long tongues reach it.
 *
 *   corollaDepth   m from the landing surface to the nectar
 *   scent.rate     particles of scent per second from an open, full flower
 *   nectar         capacity (units) and refill (units per second)
 *   open           light (0–1 brightness) at which it starts / finishes
 *                  opening, and how much rain closes it (0–1)
 *   visual         salience: how conspicuous the head is to a butterfly
 *                  (contrast, colour), size: head radius at scale 1 (m)
 *   uv             the UV pattern drawn for the viewer's ultraviolet view;
 *                  a translation for people to look at, independent of
 *                  nectar
 *   land, nectary  where a butterfly stands and where the nectar is,
 *                  in the geometry's unit height above FLOWER_TOP
 */
export const FLOWER_TYPES = [
  {
    id: 'anemone',
    label: 'Wood anemone',
    short: 'Anemones',
    form: 'open six-petal cup, nectar right at the surface',
    colors: ['#f3f0e8', '#f1e2e6', '#e7e2f2', '#f6f3ea'],
    corollaDepth: 0.0015,
    scent: { type: 0, rate: 5 },
    nectar: { capacity: 0.35, refill: 0.006 },
    open: { light: [0.12, 0.5], rainClose: 0.7 },
    visual: { salience: 0.9, size: 0.013 },
    uv: 'bullseye',
    land: 0.06,
    nectary: 0.03,
  },
  {
    id: 'bellflower',
    label: 'Bellflower',
    short: 'Bells',
    form: 'deep upturned bell, nectar at the bottom of the tube',
    colors: ['#8a8fe0', '#a395e6', '#7884d2', '#b7abee'],
    corollaDepth: 0.012,
    scent: { type: 1, rate: 7 },
    nectar: { capacity: 1.6, refill: 0.012 },
    open: { light: [0.05, 0.3], rainClose: 0.35 },
    visual: { salience: 0.8, size: 0.009 },
    uv: 'rays',
    land: 0.2,
    nectary: 0.03,
  },
  {
    id: 'campion',
    label: 'Campion',
    short: 'Campions',
    form: 'flat star of five notched petals over a narrow tube',
    colors: ['#e27aa8', '#d65f93', '#ec9cc1', '#c9558a'],
    corollaDepth: 0.007,
    scent: { type: 2, rate: 12 },
    nectar: { capacity: 0.6, refill: 0.008 },
    open: { light: [0.25, 0.7], rainClose: 1 },
    visual: { salience: 1.2, size: 0.012 },
    uv: 'ring',
    land: 0.14,
    nectary: 0.04,
  },
]

export const DEFAULT_FLOWER_MIX = { anemone: 50, bellflower: 25, campion: 25 }

// Scent emission and nectar: emission = rate × openness × (1 − DROP × (1 −
// nectar / capacity)). A drained flower smells 30% weaker, a weak, honest
// cue; between types, scent strength says nothing about nectar.
export const SCENT_NECTAR_DROP = 0.3

// --- Scent particles --------------------------------------------------
export const SCENT = {
  // Simulated particles (the cap). If the flowers in range would need more,
  // every flower emits proportionally fewer particles that each carry more
  // scent, so the expected concentration stays the same (see scentField).
  capacity: 9000,
  // Lifetime range (s) and the half-life of a particle's strength (s).
  lifetime: [5, 7],
  halfLife: 3,
  // Recycled below this strength or this far (m) from the active area.
  minStrength: 0.03,
  simRadius: 2.8,
  // Turbulence (scentField): eddy velocity spread = turbulence setting ×
  // (local wind speed + stillAir, m/s), vertical share of that, and how
  // long an eddy lasts (s). Near the ground eddies are small and short, and
  // up-and-down mixing is weaker than sideways.
  eddy: { stillAir: 0.1, vertical: 0.5, memory: 0.6 },
  // Particles never sink below this height above the ground (m).
  floor: 0.004,
  // Spatial hash for sniffing (m) and the antenna sampling radius (m). The
  // sampling sphere is bigger than real antennae: it stands for the air a
  // butterfly draws past them over a wingbeat.
  cell: 0.06,
  sniffRadius: 0.06,
}

// What the viewer sees of the scent: never read by the butterflies.
export const SCENT_DISPLAY = {
  // Share of simulated particles drawn (0–1).
  share: 0.7,
  // Point size (m) and peak opacity.
  size: 0.0045,
  opacity: 0.34,
}

// --- Butterflies ------------------------------------------------------
// Each butterfly's body is drawn from these ranges with the world seed
// (morphology.js); its abilities then follow from that body (MORPH_RULES),
// not from separate random numbers. 1 = the existing model.
export const MORPHOLOGY = {
  // Wing length (span direction) and aspect ratio (length / width: under 1
  // broad and rounded, over 1 long and slender).
  wingLength: [0.8, 1.1],
  wingAspect: [0.8, 1.3],
  // Body girth (thorax and abdomen); mass grows with its cube.
  body: [0.85, 1.15],
  // Wing colour from pale (0) to dark (1).
  darkness: [0, 1],
  // Eye size.
  eye: [0.8, 1.2],
  // Proboscis length (m).
  proboscis: [0.007, 0.0145],
}

/**
 * How abilities follow from the body. Simplified scaling rules, with
 * softened exponents so every combination in MORPHOLOGY stays able to live
 * here; NOT measured values for any species. A body at the reference (wing
 * 1 × 1, body 1, darkness 0.5, eye 1, proboscis REF) gets exactly the BASE
 * values, which are the former averages.
 *
 *   mass m = body³, wing area A = length² / aspect, wing loading W = m / A
 *   cruise speed   ∝ W^0.3            (more weight per wing: faster)
 *   turn rate      ∝ length^-0.8 · m^-0.25 · aspect^-0.3
 *   acceleration   ∝ (A / m)^0.5
 *   blown by wind  ∝ W^-0.4           (drift share, gust landing tolerance)
 *   flight cost    ∝ m^0.8 · W^0.3 / aspect^0.4  (slender wings save energy)
 *   rest cost      ∝ m^0.75
 *   energy store   ∝ m
 *   sun absorbed   ∝ (0.6 + 0.8 · darkness) · (A / m)^0.3
 *   warm / cool time ∝ body
 *   visual range   ∝ eye
 *   uncoil / recoil time ∝ proboscis / REF
 */
export const MORPH_RULES = {
  base: { speed: 0.38, turnRate: 4, accel: 1.4, visualRange: 0.43, proboscis: 0.01075 },
  // Each derived value is kept inside these bounds.
  limits: {
    speed: [0.26, 0.56],
    turnRate: [2.8, 6],
    accel: [0.8, 2.4],
    windDrift: [0.6, 1.5],
    absorb: [0.6, 1.5],
  },
}

export const TRAITS = {
  // Smoothed scent concentration (particle-equivalents) to count as smelt.
  scentThreshold: [0.035, 0.08],
  // Total field of view (degrees).
  fov: 300,
  // Innate preference per flower type (0.2–2) before any learning.
  innate: [0.7, 1.3],
}

export const ENERGY = {
  capacity: 6,
  // Use per second.
  flight: 0.03,
  rest: 0.004,
  bask: 0.006,
  // Drinking: units per second at full reach.
  intake: 0.12,
  // Starting energy share (seeded per individual).
  start: [0.45, 0.85],
}

// Proboscis reach: ratio = proboscis / corolla depth. Full intake at ≥ 1,
// none below MIN_RATIO, linear in between.
export const REACH = { minRatio: 0.75 }

export const LEARNING = {
  // After a reward: preference += gain × min(drunk / FULL, 1).
  gain: 0.25,
  full: 0.4,
  // After no reward (empty, out of reach, failed landing on it).
  loss: 0.12,
  min: 0.2,
  max: 2,
  // Chance of picking any visible flower regardless of preference.
  explore: 0.12,
}

// Body temperature: dT/dt = (Teq − T) / tau, tau shrinking with wind;
// Teq = air + SUN × sun on the body × posture + FLIGHT while flying.
export const THERMAL = {
  sun: 16,
  flight: 2.5,
  tau: 20,
  windCooling: 2.5,
  // Posture: share of full sun absorbed.
  posture: { bask: 1, flight: 0.45, perched: 0.35, closed: 0.2 },
}

/**
 * Thresholds, each with separate enter / leave values so states don't
 * flicker. Wind and rain are 0–1, light is daylight 0–1, temperatures °C,
 * energy a share of capacity.
 */
export const THRESHOLDS = {
  rain: { enter: 0.15, leave: 0.05 },
  wind: { enter: 0.72, leave: 0.55 },
  dark: { enter: 0.2, leave: 0.35 },
  // Too cold to fly below flightMin; bask from baskStart up to baskEnd.
  flightMin: 16,
  baskStart: 21,
  baskEnd: 27,
  hot: { enter: 37, leave: 33 },
  hungry: 0.7,
  sated: 0.93,
  // Below this it flies slowly and only goes for flowers it can see.
  weak: 0.12,
  // Visual: a flower counts as seen above this salience × size / distance.
  visual: 0.018,
  // Landing fails in wind gusts above this (0–1), with this chance.
  landingWind: 0.5,
  landingFailChance: 0.6,
}

export const TIMERS = {
  // Perception and decisions are re-made this often (s).
  decide: 0.2,
  // No state change sooner than this (s), except for danger and weather.
  minState: 0.6,
  approachTimeout: 10,
  // Lost the scent: cast across the wind this long before giving up.
  cast: 4,
  // Scent search as a whole gives up after this long without a flower.
  search: 14,
  // Seen target out of sight this long → given up.
  lostSight: 1.5,
  land: 0.7,
  uncoil: 0.8,
  probe: 0.7,
  feedMax: 14,
  recoil: 0.5,
  depart: 1.1,
  // Flowers just visited / failed are skipped for this long (own memory).
  revisit: 25,
  failed: 40,
  // A satisfied butterfly perches this long now and then.
  rest: [4, 10],
  basking: [10, 30],
  shelterMin: 8,
}

export const FLIGHT = {
  // Cruising height above the ground (m): wandering, foraging (low over
  // the flowers, where their scent drifts), and following a scent.
  cruise: [0.12, 0.32],
  forage: [0.08, 0.18],
  search: [0.07, 0.13],
  // Minimum clearance over the ground in flight (m).
  clearance: 0.03,
  // Share of the wind that carries it off course (it corrects the rest).
  drift: { cruise: 0.55, approach: 0.25 },
  // Acceleration limit (m/s²) and vertical speed limit (m/s).
  accel: 1.4,
  climb: 0.35,
  // Keep this far from bark and other butterflies (m).
  trunkGap: 0.05,
  separation: 0.045,
  // Pulled back toward the watched area beyond this distance (m).
  leash: 1.1,
}

// Far butterflies (not followed) update less often.
export const LOD = { near: 2.5, far: 6, nearStep: 1 / 60, midStep: 1 / 20, farStep: 1 / 4 }

export const DEFAULT_ECOLOGY = {
  butterflies: 6,
  showScent: true,
  // Advanced: share of scent particles drawn, turbulence (% of the wind
  // speed as eddies), and the development overlay (senses, targets, numbers).
  scentDisplay: 70,
  turbulence: 25,
  debug: false,
}

// What the followed butterfly is doing, in plain words.
export const STATE_LABELS = {
  explore: 'Looking for flowers',
  searchScent: 'Following a flower scent',
  approach: 'Flying to a flower',
  land: 'Landing on a flower',
  probe: 'Probing the flower',
  feed: 'Drinking nectar',
  depart: 'Leaving the flower',
  bask: 'Basking in the sun',
  seekShelter: 'Sheltering',
  rest: 'Resting',
}
