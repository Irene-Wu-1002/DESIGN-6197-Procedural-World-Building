/**
 * Ground cover: what grows or lies where, and how it's distributed.
 * Plain data only, no Three.js. Sizes are real metres.
 *
 *   element    method (Week 5)                    rules
 *   mushrooms  clusters of 2–7                    damp, near trunks (roots),
 *                                                 off the ant hill and pebbles
 *   moss       noise-clustered patches,           damp, shaded, gentle slope;
 *              jittered-grid spacing inside       loves trunk bases and pebbles
 *   twigs      uniform random                     more under trees
 *   leaves     uniform random + rotation,         more under trees, in litter
 *              density from a litter noise        patches and hollows
 * Placement order: mushrooms → moss → twigs → leaves (earlier claim space;
 * the sparse mushrooms go first so dense moss can't crowd them out).
 */

export const DEFAULT_COVER = {
  leaves: { on: true, amount: 60 },
  // Share of leaves in autumn colours (the rest are green).
  autumn: 50,
  twigs: { on: true, amount: 50 },
  moss: { on: true, amount: 50 },
  mushrooms: { on: true, amount: 50 },
  flyAgaric: true,
}

export const COVER_RULES = {
  moss: {
    // Jittered grid of possible cushions inside a tile.
    cell: 0.012,
    radius: [0.006, 0.022],
    // Cushion height as a share of its radius.
    height: [0.35, 0.6],
    minMoisture: 0.45,
    maxSlope: 35,
    patchWavelength: 0.1,
    // Strong pull toward trunk bases (m) and pebbles.
    trunkReach: 0.3,
  },
  mushrooms: {
    // Clusters around each trunk, and a chance of one per damp tile.
    perTrunk: 5,
    trunkRing: [0.03, 0.9],
    dampTileChance: 0.35,
    clusterSize: [2, 7],
    clusterRadius: 0.03,
    height: [0.01, 0.04],
    minMoisture: 0.45,
    maxSlope: 30,
  },
  twigs: {
    // Candidates per tile at 100%.
    perTile: 6,
    underTreeBoost: 3,
    underTreeReach: 1.5,
    length: [0.04, 0.15],
    branchChance: 0.25,
    branchLength: [0.1, 0.25],
    maxSlope: 35,
  },
  leaves: {
    perTile: 70,
    underTreeBoost: 1.5,
    underTreeReach: 1.5,
    length: [0.03, 0.08],
    maxSlope: 30,
    variants: 3,
  },
}

/** Leaf colours (sRGB hex) by season. */
export const LEAF_COLORS = {
  autumn: ['#7a4a24', '#a6782c', '#b8562a', '#c9a338', '#8c3b1f'],
  green: ['#5f7a2e', '#7a8a3a', '#4f6b2a', '#8a9a46'],
}
export const MUSHROOM_COLORS = ['#8a5a32', '#a87a4a', '#c9a77a', '#6b4528', '#d8c3a0']
export const MOSS_COLORS = ['#4f6b26', '#5f7d2c', '#3f5a22', '#6f8a34']
export const TWIG_COLORS = ['#5a4636', '#6b5848', '#4a3a2c', '#7a6a58']
