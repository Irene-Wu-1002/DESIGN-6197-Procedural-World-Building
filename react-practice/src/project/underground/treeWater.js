/**
 * What the water in the ground does for each tree: how much reaches its
 * roots, and how its crown grows from that.
 *
 *   supply   0 – 1: how much water the tree's roots reach (water.js),
 *            a weighted sum of three things:
 *              table    how close the water table comes to the bottom of
 *                       the roots (it wanders up and down between trees)
 *              pockets  pockets inside the root zone, bigger and nearer
 *                       the trunk counting more
 *              surface  the surface moisture under the tree (wet patches
 *                       in the low ground, Habitat wetness)
 *            then topped up by live wet weather (the simulation)
 *   growth   0 – 1, how much of the crown has grown (its branches, in the
 *            order space colonization grew them): water-limited logistic
 *            growth, dG/dt = r · supply · G · (1 − G / Gmax), where Gmax,
 *            the crown the water can hold up, is smaller for drier trees;
 *            above it the crown slowly dies back
 *   leaves   0 – 1, how full the grown twigs are of leaves: eases toward
 *            the supply within a few seconds (days, in the tree's time),
 *            and drops in autumn whatever the water
 *   dryness  0 – 1, how far the leaves have yellowed from thirst
 *   demand   how hard the tree draws water (about 0.3 – 1.6): leaves
 *            transpire, so fuller crowns draw more, and a crown still
 *            short of what its water could hold up draws extra to grow
 *
 * Trees start grown to what their water holds up (the forest looks
 * settled). Regrow cuts every crown back to a seedling's and starts the
 * clock: trees found later start where the closed-form logistic curve
 * says they'd be by then, so new trees match their neighbours.
 *
 * States are kept for trees near you, keyed by trunk position, and
 * re-measured when the water field changes (the crowns then grow or die
 * back toward their new size).
 *
 * Plain data only, no Three.js. Times are in seconds at Growth speed 100%.
 */

// Trees within 75% of this (m) of you get a state; states are dropped
// beyond it.
const KEEP = 20
const SEEDLING = 0.05
const RATE = 0.2
const LEAF_RATE = 0.8
// The largest crown a tree can hold up, from no water to plenty.
const CROWN_MAX = [0.3, 1]
// Leaves at no water and at plenty, and the yellowing below this supply.
const LEAF_RANGE = [0.15, 1]
const DRY_BELOW = 0.45
// Supply: the weight of each part, and its ranges. table: the gap (m) from
// the bottom of the roots down to the table, full at the first, none at
// the second; pockets: the weighted pocket volume that counts as plenty
// (m³); surface: the moisture from none to full.
const WEIGHTS = { table: 0.45, pockets: 0.35, surface: 0.35 }
const TABLE_GAP = [-0.1, 0.7]
const POCKET_PLENTY = 0.008
const SURFACE_RANGE = [0.2, 0.8]
const SURFACE_POINTS = 8

const clamp01 = (value) => Math.min(Math.max(value, 0), 1)
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}
const keyOf = (trunk) => `${trunk.x.toFixed(4)},${trunk.z.toFixed(4)}`
const crownMax = (supply) => CROWN_MAX[0] + (CROWN_MAX[1] - CROWN_MAX[0]) * supply

/** How much water a tree's roots reach: { table, pockets, surface, supply }, each 0 – 1. */
export function measureRoots(field, trunk, roots) {
  const column = field.column(trunk.x, trunk.z, {})
  const table = 1 - smoothstep(TABLE_GAP[0], TABLE_GAP[1], column.ground - roots.rootDepth - column.table)
  let volume = 0
  for (const pocket of field.pocketsNear(trunk.x, trunk.z, roots.reach)) {
    const near = 1 - Math.min(Math.hypot(pocket.x - trunk.x, pocket.z - trunk.z) / roots.reach, 1)
    const reached = column.ground - pocket.y < roots.rootDepth * 1.1 ? 1 : 0.3
    volume += pocket.rx * pocket.ry * pocket.rz * near * reached
  }
  const pockets = Math.min(volume / POCKET_PLENTY, 1)
  let wet = 0
  for (let k = 0; k < SURFACE_POINTS; k += 1) {
    const angle = (k / SURFACE_POINTS) * Math.PI * 2
    wet += field.column(trunk.x + Math.cos(angle) * roots.reach * 0.6, trunk.z + Math.sin(angle) * roots.reach * 0.6, column).surface
  }
  const surface = smoothstep(SURFACE_RANGE[0], SURFACE_RANGE[1], wet / SURFACE_POINTS)
  const supply = clamp01(WEIGHTS.table * table + WEIGHTS.pockets * pockets + WEIGHTS.surface * surface)
  return { table, pockets, surface, supply }
}

export function createTreeWater() {
  const states = new Map()
  let fieldKey = null
  // Growth time since Regrow (Infinity: never regrown, all settled).
  let age = Infinity

  // Where the logistic curve puts a tree `age` after Regrow.
  const grownBy = (supply, time) => {
    const top = crownMax(supply)
    if (!Number.isFinite(time)) return top
    const k = RATE * supply
    return top / (1 + ((top - SEEDLING) / SEEDLING) * Math.exp(-k * time))
  }
  const leafTarget = (supply, autumn) =>
    (LEAF_RANGE[0] + (LEAF_RANGE[1] - LEAF_RANGE[0]) * supply) * (1 - 0.9 * smoothstep(0.4, 1, autumn))

  return {
    /**
     * Once per frame. field: the water field and its key (null: no water,
     * no states); trunks; roots: { reach, rootDepth }; anchor: where you
     * look; wetness: live wet weather 0 – 1; autumn: the season's autumn
     * share 0 – 1; speed: Growth speed %.
     */
    update({ dt, field, key, trunks, roots, anchor, wetness, autumn, speed }) {
      if (!field || !trunks) {
        states.clear()
        fieldKey = null
        return
      }
      const step = dt * (speed / 100)
      if (Number.isFinite(age)) age += step
      const remeasure = key !== fieldKey
      fieldKey = key
      for (const [k, state] of states) {
        if (Math.hypot(state.trunk.x - anchor.x, state.trunk.z - anchor.z) > KEEP) states.delete(k)
      }
      for (const trunk of trunks.trunksNear(anchor.x, anchor.z, KEEP * 0.75)) {
        const k = keyOf(trunk)
        let state = states.get(k)
        if (!state || remeasure) {
          const parts = measureRoots(field, trunk, roots)
          const supply = parts.supply
          if (state) Object.assign(state, { parts, base: supply })
          else {
            state = { trunk, parts, base: supply, supply }
            state.growth = grownBy(supply, age)
            state.leaves = Math.min(leafTarget(supply, autumn), 1)
            state.dryness = 1 - smoothstep(0, DRY_BELOW, supply)
            states.set(k, state)
          }
        }
      }

      const ease = 1 - Math.exp(-step * LEAF_RATE)
      for (const state of states.values()) {
        // Wet weather tops the soil up.
        state.supply = clamp01(state.base + 0.35 * wetness * (1 - state.base))
        const top = crownMax(state.supply)
        state.growth = clamp01(state.growth + step * RATE * state.supply * state.growth * (1 - state.growth / top))
        state.leaves += (leafTarget(state.supply, autumn) - state.leaves) * ease
        state.dryness += (1 - smoothstep(0, DRY_BELOW, state.supply) - state.dryness) * ease
      }
    },

    /** The state of a trunk's tree ({ supply, growth, leaves, dryness }), or null. */
    stateOf(trunk) {
      return states.get(keyOf(trunk)) ?? null
    },

    /** How hard a trunk's tree draws water (1 for trees without a state). */
    demandOf(trunk) {
      const state = states.get(keyOf(trunk))
      if (!state) return 1
      const top = crownMax(state.supply)
      return 0.3 + 0.7 * state.leaves + 0.6 * clamp01(((top - state.growth) / top) * 2)
    },

    /** Cut every crown back to a seedling's and let the water grow them again. */
    regrow() {
      age = 0
      for (const state of states.values()) {
        state.growth = SEEDLING
        state.leaves = 0
      }
    },

    /** The tree nearest (x, z): { supply, table, pockets, surface, growth, leaves, distance } or null. */
    nearest(x, z) {
      let best = null
      for (const state of states.values()) {
        const distance = Math.hypot(state.trunk.x - x, state.trunk.z - z)
        if (!best || distance < best.distance) best = { ...state, distance }
      }
      return best && { supply: best.supply, ...best.parts, growth: best.growth, leaves: best.leaves, distance: best.distance }
    },
  }
}
