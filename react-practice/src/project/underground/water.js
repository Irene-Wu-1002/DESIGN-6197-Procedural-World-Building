import { getNoise } from '../../utils/noise'
import { hash } from '../terrain/heightField'

/**
 * Water in the ground, as pure functions of world position, the ground's
 * seed and the water settings, so it needs nothing stored and every view
 * agrees on where it is:
 *
 *   water table  where the soil turns saturated: a slow, smooth surface
 *                about Table depth under the broad slopes (it follows
 *                their gentle shape, not the bumps and pebbles), wandering
 *                up and down by a fifth over a few metres
 *   pockets      lenses of saturated soil between the surface and the
 *                table, hashed from 60 cm cells (none at Pockets 0%)
 *   soil water   0 dry – 1 saturated at any point: the surface moisture
 *                (wet patches in the low ground, Habitat wetness) fading
 *                with depth to a drier middle, rising through the
 *                capillary fringe to the table, saturated below it and
 *                inside pockets
 *
 * column(x, z) gathers what is shared down a vertical line (the ground,
 * the table, the surface moisture, the pockets that reach it); waterAt
 * (column, y) is then cheap for many depths.
 *
 * Plain data only, no Three.js. Units are metres.
 */

export const DEFAULT_WATER = {
  water: true,
  // Metres below the ground, on average.
  tableDepth: 1.5,
  // % of the standard pocket count.
  pockets: 50,
}

const TABLE = { wavelength: 4, swing: 0.2 }
const POCKET = {
  cell: 0.6,
  // Chance of a pocket per cell at Pockets 100%.
  chance: 0.55,
  // Horizontal radius (m); the other radius and the height as shares of it.
  radius: [0.08, 0.22],
  width: [0.6, 1.1],
  height: [0.3, 0.5],
  // Depth of the centre, as a share of the table's depth there.
  depth: [0.3, 0.8],
}
// The largest a pocket reaches from its centre (m).
const POCKET_REACH = POCKET.radius[1] * POCKET.width[1] * 1.3
// Surface moisture fades with depth over this (m) toward the drier middle.
const SURFACE_FADE = 0.3
// Capillary fringe: how far above the table the soil starts getting wetter,
// and how wet it is at the table.
const FRINGE = 0.35
const FRINGE_WET = 0.92
const SALT = { table: 21, pocket: 4000 }

const clamp01 = (value) => Math.min(Math.max(value, 0), 1)
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/**
 * sampler: the ground (terrain/heightField.js); settings: DEFAULT_WATER's
 * keys; wetness: the Habitat wetness, 0–1.
 */
export function createWaterField(sampler, settings, wetness) {
  const seed = sampler.seed
  const tableNoise = {
    type: 'perlin',
    scale: 1 / TABLE.wavelength,
    octaves: 2,
    persistence: 0.5,
    lacunarity: 2,
    seed: seed * 59 + SALT.table,
  }
  const pocketChance = POCKET.chance * (settings.pockets / 100)
  const middle = 0.12 + 0.25 * wetness
  const sample = {}
  const cells = new Map()

  // The table's height under (x, z), given the sampled ground there.
  const tableFrom = (x, z, ground) =>
    ground.broadLowHeight - settings.tableDepth * (1 + TABLE.swing * getNoise(x, z, tableNoise))

  const pocketOf = (cx, cz) => {
    const key = cx * 100003 + cz
    if (cells.has(key)) return cells.get(key)
    let pocket = null
    const roll = (salt) => hash(cx, cz, seed + SALT.pocket + salt)
    if (roll(0) < pocketChance) {
      const between = ([low, high], salt) => low + roll(salt) * (high - low)
      const x = (cx + roll(1)) * POCKET.cell
      const z = (cz + roll(2)) * POCKET.cell
      sampler.sample(x, z, sample)
      const top = sample.height
      const table = tableFrom(x, z, sample)
      const radius = between(POCKET.radius, 3)
      const yaw = roll(4) * Math.PI
      pocket = {
        x,
        y: top - (top - table) * between(POCKET.depth, 5),
        z,
        rx: radius,
        ry: radius * between(POCKET.height, 6),
        rz: radius * between(POCKET.width, 7),
        yaw,
        cos: Math.cos(yaw),
        sin: Math.sin(yaw),
      }
    }
    if (cells.size > 20000) cells.clear()
    cells.set(key, pocket)
    return pocket
  }

  /** The pockets within `radius` (m) of (x, z), horizontally. */
  const pocketsNear = (x, z, radius) => {
    const reach = radius + POCKET_REACH
    const found = []
    for (let cz = Math.floor((z - reach) / POCKET.cell); cz <= Math.floor((z + reach) / POCKET.cell); cz += 1) {
      for (let cx = Math.floor((x - reach) / POCKET.cell); cx <= Math.floor((x + reach) / POCKET.cell); cx += 1) {
        const pocket = pocketOf(cx, cz)
        if (pocket && Math.hypot(pocket.x - x, pocket.z - z) <= reach) found.push(pocket)
      }
    }
    return found
  }

  return {
    settings,
    pocketsNear,

    /** The water table's height (y) under (x, z). */
    tableAt(x, z) {
      return tableFrom(x, z, sampler.sample(x, z, sample))
    },

    /** What a vertical line at (x, z) shares: { ground, table, surface, pockets }. */
    column(x, z, out = {}) {
      sampler.sample(x, z, sample)
      out.ground = sample.height
      out.table = tableFrom(x, z, sample)
      // The habitat's wet/dry patches, roughly: wetter in the low ground.
      out.surface = clamp01(wetness - 0.35 * sample.broad)
      out.x = x
      out.z = z
      out.pockets = pocketsNear(x, z, 0)
      return out
    },

    /** Soil water at height y in a column: 0 dry – 1 saturated. */
    waterAt(column, y) {
      if (y <= column.table) return 1
      const depth = Math.max(column.ground - y, 0)
      let water = middle + (column.surface - middle) * Math.exp(-depth / SURFACE_FADE)
      const fringe = smoothstep(column.table + FRINGE, column.table, y)
      water += (FRINGE_WET - water) * fringe * fringe
      for (const pocket of column.pockets) {
        const dx = column.x - pocket.x
        const dz = column.z - pocket.z
        const u = (dx * pocket.cos + dz * pocket.sin) / pocket.rx
        const v = (dz * pocket.cos - dx * pocket.sin) / pocket.rz
        const w = (y - pocket.y) / pocket.ry
        // Saturated inside, a damp halo around.
        water = Math.max(water, smoothstep(1.6, 0.9, u * u + v * v + w * w))
      }
      return water
    },
  }
}
