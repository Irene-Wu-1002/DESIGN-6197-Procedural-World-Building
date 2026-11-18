import { hash } from './hash'

/**
 * The ant hills: one colony living in several nests (like wood ants), joined
 * underground by tunnels (ants/tunnels.js). The main hill stands at the
 * world origin, as it always has; the smaller satellite nests are placed by
 * the seed around it, clear of the fly agaric and its trail and of each
 * other. Trunks keep clear of every possible nest (cover/trunks.js), so the
 * Nests setting never moves a tree.
 *
 * Also here: where the fly agaric stands, since the nests avoid it.
 *
 * Plain data only, no Three.js.
 */

export const ANT_HILL = {
  x: 0,
  z: 0,
  radius: 0.08,
  height: 0.04,
  craterRadius: 0.012,
  craterDepth: 0.014,
  // How uneven the mound's outline is (share of the radius).
  wobble: 0.15,
}

export const MAX_NESTS = 4
export const DEFAULT_NESTS = 4

// Satellite nests: distance from the main hill (m), least gap to another
// nest (m), least angle from the fly agaric's direction (rad), mound size
// ranges, and placement tries.
const SATELLITE = {
  distance: [0.38, 0.75],
  gap: 0.32,
  agaricAngle: 0.7,
  radius: [0.045, 0.06],
  height: [0.02, 0.028],
  craterRadius: 0.009,
  craterDepth: 0.008,
  tries: 16,
}
const SALT = 5101

// The fly agaric's distance from the ant hill's centre (m); its direction
// comes from the seed.
const AGARIC_DISTANCE = 0.24

/** Where the fly agaric stands for this seed (world x, z). */
export function agaricSpot(seed) {
  const angle = hash(seed, 17, 9001) * Math.PI * 2
  return { x: ANT_HILL.x + Math.cos(angle) * AGARIC_DISTANCE, z: ANT_HILL.z + Math.sin(angle) * AGARIC_DISTANCE }
}

const cache = new Map()

/**
 * Every possible nest for this seed (the main hill first, then up to
 * MAX_NESTS - 1 satellites): [{ index, x, z, radius, height, craterRadius,
 * craterDepth, wobble, main }].
 */
function allHills(seed) {
  if (cache.has(seed)) return cache.get(seed)
  const hills = [{ ...ANT_HILL, index: 0, main: true }]
  const agaric = agaricSpot(seed)
  const agaricAngle = Math.atan2(agaric.z - ANT_HILL.z, agaric.x - ANT_HILL.x)
  const turn = hash(seed, 1, SALT) * Math.PI * 2
  for (let k = 1; k < MAX_NESTS; k += 1) {
    for (let attempt = 0; attempt < SATELLITE.tries; attempt += 1) {
      const h = (n) => hash(seed, k * 100 + attempt * 7 + n, SALT)
      // Spread around the main hill, a little irregular.
      const angle = turn + ((k - 1) / (MAX_NESTS - 1)) * Math.PI * 2 + (h(0) - 0.5) * (1 + attempt * 0.25)
      const gap = Math.abs(Math.atan2(Math.sin(angle - agaricAngle), Math.cos(angle - agaricAngle)))
      if (gap < SATELLITE.agaricAngle) continue
      const d = SATELLITE.distance[0] + h(1) * (SATELLITE.distance[1] - SATELLITE.distance[0])
      const x = ANT_HILL.x + Math.cos(angle) * d
      const z = ANT_HILL.z + Math.sin(angle) * d
      if (hills.some((hill) => Math.hypot(hill.x - x, hill.z - z) < SATELLITE.gap)) continue
      const lerp = ([a, b], t) => a + (b - a) * t
      hills.push({
        index: hills.length,
        x,
        z,
        radius: lerp(SATELLITE.radius, h(2)),
        height: lerp(SATELLITE.height, h(3)),
        craterRadius: SATELLITE.craterRadius,
        craterDepth: SATELLITE.craterDepth,
        wobble: ANT_HILL.wobble,
        main: false,
      })
      break
    }
  }
  if (cache.size > 32) cache.clear()
  cache.set(seed, hills)
  return hills
}

/** The first `nests` hills for this seed (the main hill first). */
export function antHills(seed, nests = DEFAULT_NESTS) {
  return allHills(seed).slice(0, Math.max(1, Math.min(Math.round(nests), MAX_NESTS)))
}

/** Every nest the Nests setting could show (for things that keep clear). */
export function possibleAntHills(seed) {
  return allHills(seed)
}
