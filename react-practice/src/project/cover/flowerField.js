import { getNoise } from '../../utils/noise'
import { hash } from '../terrain/heightField'
import { COVER_RULES, SEASON_HEADROOM } from './coverRules'

/**
 * Flowers (wood anemones): where they grow, as a pure function of world
 * position, the seed, the habitat, and the flower settings
 * (DEFAULT_COVER.flowers in coverRules.js).
 *
 *   suitability  sunny, moderately moist, fairly flat ground (0–1); each
 *                preference sets how much its condition counts
 *   region mask  a slow (~2 m) noise that leaves whole regions without
 *                flowers; noise influence sets how much ground it empties
 *   colonies     one possible colony per world cell (cell size from the
 *                colony count); a site grows one when a hash beats
 *                amount × suitability × mask at its centre (with the
 *                seasons' headroom; the colony's presence is the share
 *                of that its hash used, see SEASON_HEADROOM). Its flowers are
 *                placed inside the colony radius (falloff pulls them to the
 *                centre), at least the minimum spacing apart, each checked
 *                against the ground where it lands.
 *
 * Colonies are worked out in world space (habitat.at), so a colony that
 * crosses a tile edge is the same in both tiles. Even spacing and fully
 * random modes are placed per tile by scatterTile.js using suitability and
 * the mask from here.
 *
 * Plain data only, no Three.js.
 */

// Flowers per m² at 100% amount (even spacing and fully random modes).
export const FULL_DENSITY = 120
const REGION_WAVELENGTH = 2
// Mask cut on the region noise at 0% and 100% noise influence.
const REGION_CUT = [-0.6, 0.1]
const SIZE_SPREAD = 0.3
const TRIES_PER_FLOWER = 3
// Colony base tones, white most often (indexes into FLOWER_COLORS).
const COLONY_TONES = [0, 0, 3, 1, 2]
const SALT = { site: 901, colony: 902, flower: 903, region: 904, tone: 905 }

const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}
const lerp = (a, b, t) => a + (b - a) * t

/**
 * settings: cover.flowers; habitat: the habitat field; seed: world seed.
 */
export function createFlowerField(settings, { habitat, seed }) {
  const offsetSeed = seed + settings.seedOffset * 7919
  const amount = settings.amount / 100
  const sunWeight = settings.sunlightPreference / 100
  const moistureWeight = settings.moisturePreference / 100
  const regionCut = lerp(REGION_CUT[0], REGION_CUT[1], settings.noiseInfluence / 100)
  const regionNoise = {
    type: 'perlin',
    scale: 1 / REGION_WAVELENGTH,
    octaves: 2,
    persistence: 0.5,
    lacunarity: 2,
    seed: offsetSeed * 47 + SALT.region,
  }
  const toneNoise = { ...regionNoise, scale: 1 / 0.6, octaves: 1, seed: offsetSeed * 47 + SALT.tone }
  const cell = 1 / Math.sqrt(settings.colonyCount)
  const radius = settings.colonyRadius / 100
  const spacing = settings.minSpacing / 100
  // Falloff 0 spreads flowers evenly over the disc; 100% piles them at the centre.
  const falloff = 0.5 + settings.colonyFalloff / 100
  const colonies = new Map()

  /** 0–1: how well flowers like this ground ({ sunlight, moisture, slope }). */
  const suitability = (g) => {
    if (g.slope > settings.maxSlope) return 0
    const sun = smoothstep(0.2, 0.7, g.sunlight)
    const moist = smoothstep(0.3, 0.45, g.moisture) * (1 - smoothstep(0.65, 0.8, g.moisture))
    // Flatter is better all the way down, not just near the limit.
    const flat = 1 - g.slope / settings.maxSlope
    return lerp(1, sun, sunWeight) * lerp(1, moist, moistureWeight) * flat
  }

  /** 0–1: the regional mask (0 = a region with no flowers). */
  const regionAt = (x, z) => smoothstep(regionCut - 0.08, regionCut + 0.08, getNoise(x, z, regionNoise))

  // Ground a flower may stand on (world-space fields from habitat.at).
  const fields = {}
  const ground = (x, z) => {
    habitat.at(x, z, fields)
    return fields
  }
  const clear = (g) => g.hill <= 0.1 && g.pebble <= 0.2 && g.trunkDistance >= COVER_RULES.flowers.trunkGap

  const colonyAt = (ix, iz) => {
    const key = ix * 100003 + iz
    if (colonies.has(key)) return colonies.get(key)
    const h = (k) => hash(ix, iz, offsetSeed + SALT.site + k)
    const cx = (ix + 0.5 + 0.8 * (h(0) - 0.5)) * cell
    const cz = (iz + 0.5 + 0.8 * (h(1) - 0.5)) * cell
    let colony = null
    const centre = ground(cx, cz)
    const chance = amount * SEASON_HEADROOM * suitability(centre) * regionAt(cx, cz)
    if (h(2) < chance && clear(centre)) {
      const r = radius * (1 + SIZE_SPREAD * (h(3) * 2 - 1))
      const count = Math.max(1, Math.round(settings.flowersPerColony * (1 + SIZE_SPREAD * (h(4) * 2 - 1))))
      const tone = COLONY_TONES[Math.floor(h(5) * COLONY_TONES.length)]
      const flowers = []
      for (let k = 0; flowers.length < count && k < count * TRIES_PER_FLOWER; k += 1) {
        const f = (j) => hash(ix * 977 + k, iz, offsetSeed + SALT.flower + j)
        const angle = f(0) * Math.PI * 2
        const distance = r * f(1) ** falloff
        const x = cx + Math.cos(angle) * distance
        const z = cz + Math.sin(angle) * distance
        if (flowers.some((other) => (other.x - x) ** 2 + (other.z - z) ** 2 < spacing * spacing)) continue
        const g = ground(x, z)
        if (!clear(g) || f(2) >= Math.sqrt(suitability(g))) continue
        flowers.push({ x, z, h: [f(3), f(4), f(5), f(6), f(7), f(8), f(9)] })
      }
      colony = { x: cx, z: cz, radius: r, tone, flowers, presence: h(2) / chance }
    }
    if (colonies.size > 20000) colonies.clear()
    colonies.set(key, colony)
    return colony
  }

  return {
    suitability,
    regionAt,

    /** A slow base tone (index into FLOWER_COLORS) for the uncolonised modes. */
    toneAt(x, z) {
      const value = smoothstep(-0.4, 0.4, getNoise(x, z, toneNoise))
      return COLONY_TONES[Math.min(Math.floor(value * COLONY_TONES.length), COLONY_TONES.length - 1)]
    },

    /** Colonies whose flowers may fall inside [x0, x1) × [z0, z1). */
    coloniesIn(x0, z0, x1, z1) {
      const reach = radius * (1 + SIZE_SPREAD)
      const result = []
      for (let iz = Math.floor((z0 - reach) / cell); iz <= Math.floor((z1 + reach) / cell); iz += 1) {
        for (let ix = Math.floor((x0 - reach) / cell); ix <= Math.floor((x1 + reach) / cell); ix += 1) {
          const colony = colonyAt(ix, iz)
          if (colony) result.push(colony)
        }
      }
      return result
    },
  }
}
