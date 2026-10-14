/**
 * Ground cover: what grows or lies where, and how it's distributed.
 * Plain data only, no Three.js. Sizes are real metres.
 *
 *   element    method (Week 5)                    rules
 *   mushrooms  clusters of 2–7                    damp, near trunks (roots),
 *                                                 off the ant hill and pebbles
 *   moss       connected patches (mossField.js):  damp, shaded, hollows, gentle
 *              noise + habitat score, filled on   slope, near trunk bases;
 *              a jittered grid of cushions        bare soil between patches
 *   twigs      uniform random                     more under trees
 *   leaves     drifts along the wind              hollows, beside and downwind
 *              (leafField.js, scatterLeaves.js)   of obstacles, under trees
 *   flowers    colonies (flowerField.js), or      sunny, moderately moist,
 *   (wood      even spacing / fully random;       fairly flat; whole regions
 *   anemones)  a slow region mask empties areas   bare (off the hill and bark)
 * Habitat (habitat/habitatFields.js) adds gentle preferences: mushrooms
 * shun full sun, and leaves and twigs gather where the wind is calm. Each is 1 at average conditions,
 * so the habitat reshapes where things are more than how many.
 * Placement order: mushrooms → moss → twigs → leaves → flowers (earlier
 * claim space; the sparse mushrooms go first so dense moss can't crowd them
 * out; flowers come last so adding them moved nothing that was there).
 */

export const DEFAULT_COVER = {
  // Leaves: drift size and spacing in cm; autumn is the share in autumn
  // colours (the rest are green).
  leaves: {
    on: true,
    amount: 60,
    driftSize: 30,
    driftStrength: 60,
    windInfluence: 50,
    hollowPreference: 50,
    obstacleAccumulation: 60,
    minSpacing: 0.8,
    scaleVariation: 60,
    rotationVariation: 85,
    autumn: 50,
    // Advanced: breakup noise size (% of drift size), share of ground left
    // sparse between drifts (%), wind direction wobble, share of leaves that
    // may pile on others, and a different arrangement.
    depositionNoiseScale: 30,
    depositionThreshold: 40,
    windVariation: 30,
    overlapAmount: 30,
    seedOffset: 0,
  },
  twigs: { on: true, amount: 50 },
  // Moss: amount is the share of ground inside patches (%); sizes in cm.
  moss: {
    on: true,
    amount: 30,
    patchSize: 25,
    patchContrast: 60,
    minSpacing: 1,
    moisturePreference: 70,
    shadePreference: 50,
    concavityPreference: 40,
    scaleVariation: 40,
    colorVariation: 50,
    // Advanced: breakup noise size (% of patch size), share of ground that
    // always stays bare (%), steepest ground (°), and the noise arrangement.
    noiseScale: 30,
    noiseThreshold: 35,
    maxSlope: 35,
    randomOffset: 0,
  },
  mushrooms: { on: true, amount: 50 },
  // Flowers: colony sizes in cm, spacing in cm, slope in degrees.
  flowers: {
    on: true,
    distribution: 'colonies',
    amount: 50,
    colonyCount: 6,
    colonyRadius: 8,
    flowersPerColony: 15,
    minSpacing: 1.5,
    sunlightPreference: 60,
    moisturePreference: 60,
    maxSlope: 25,
    heightVariation: 40,
    scaleVariation: 30,
    colorVariation: 40,
    // Advanced: how strongly colonies gather at the centre (%), a different
    // colony arrangement, and how much ground the region noise empties (%).
    colonyFalloff: 50,
    seedOffset: 0,
    noiseInfluence: 60,
  },
  flyAgaric: true,
}

// Seasons can raise leaf, flower, mushroom and moss amounts up to this many
// times the Scatter settings. Cover is scattered once with this headroom;
// each item records the share (its presence, 0–1) at which it appears, and
// the renderer shows or hides items by presence, so a season change never
// moves anything (simulation/season.js).
export const SEASON_HEADROOM = 1.5

// Typical habitat values at the default settings: preferences are 1 here,
// so the default habitat keeps the usual amount of each kind.
export const HABITAT_NORMAL = { shade: 0.37, sunlight: 0.45, wind: 0.4 }

export const COVER_RULES = {
  moss: {
    // Cushion radius as a share of the grid cell (neighbours touch), and
    // how much smaller cushions get at a patch's edge.
    radius: 0.62,
    edgeShrink: 0.4,
    // Cushion height as a share of its radius.
    height: [0.35, 0.6],
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
    // Share of mushrooms that won't grow in full sunlight (fewer as the
    // light drops to typical, none below it).
    sunAvoidance: 0.6,
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
    // Fewer where the wind is stronger than the default breeze.
    windShelter: 0.2,
  },
  leaves: {
    perTile: 70,
    underTreeBoost: 1.5,
    underTreeReach: 1.5,
    length: [0.03, 0.08],
    maxSlope: 30,
    variants: 3,
    // Candidates per leaf at the average density (room for drifts and
    // piles), and the average of the other factors (so amount keeps the
    // old total).
    candidates: 2.5,
    average: 3,
    // Obstacles: strength at 100%; bands beside trunk bases (roots), the
    // ant hill, the fly agaric's stem (radius) and branches (m); lee tails
    // as a multiple of the obstacle's radius; how far to look for trunks.
    obstacleBoost: 2.5,
    rootBand: 0.06,
    hillBand: 0.03,
    stemRadius: 0.012,
    stemBand: 0.015,
    branchBand: 0.01,
    pebbleRing: 0.008,
    leeReach: 2.5,
    leeWeight: 2,
    trunkReach: 1.2,
    // Share of leaves with their own colour; lift per leaf beneath (m).
    ownColor: 0.25,
    pileLift: 0.0008,
  },

  flowers: {
    // Stem height (m): the middle of this range, ± half of it at 100%
    // height variation.
    height: [0.05, 0.11],
    // Overall size ± this share at 100% scale variation.
    scaleSpread: 0.4,
    // Keep this far from bark (m).
    trunkGap: 0.12,
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
/** Wood anemone petals (white, blush, lilac) and stem. */
export const FLOWER_COLORS = ['#f3f0e8', '#f1e2e6', '#e7e2f2', '#f6f3ea']
export const FLOWER_STEM_COLOR = '#5d7a33'
