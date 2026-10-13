import { ANT_HILL, hash } from '../terrain/heightField'

/**
 * Tree trunks on a jittered world grid: at most one trunk per `spacing`-m
 * cell, at a seeded spot inside it. Because each cell decides on its own,
 * trunks are endless and the same every time, and any point can ask for
 * the trunks near it without knowing about tiles.
 *
 * Plain data only, no Three.js.
 */

const TRUNK = {
  chance: 0.8,
  radius: [0.15, 0.3],
  // Keep the start (ant hill and fly agaric) open.
  keepClear: 0.6,
}
// Salt so trunk hashes don't line up with pebble hashes.
const SALT = 7001

/**
 * spacing: grid cell size (m); on: false gives an empty field.
 * Returns { trunksNear(x, z, reach), distance(x, z) }.
 */
export function createTrunkField(seed, spacing, on = true) {
  const cache = new Map()
  const trunkInCell = (cx, cz) => {
    const key = cx * 92821 + cz
    if (cache.has(key)) return cache.get(key)
    let trunk = null
    if (on && hash(cx, cz, seed + SALT) < TRUNK.chance) {
      const radius = TRUNK.radius[0] + hash(cx, cz, seed + SALT + 1) * (TRUNK.radius[1] - TRUNK.radius[0])
      // Keep the trunk (plus a little root room) inside its cell.
      const margin = radius + 0.3
      const room = Math.max(spacing - 2 * margin, 0)
      const x = cx * spacing + margin + hash(cx, cz, seed + SALT + 2) * room
      const z = cz * spacing + margin + hash(cx, cz, seed + SALT + 3) * room
      const clear = Math.hypot(x - ANT_HILL.x, z - ANT_HILL.z) > TRUNK.keepClear + radius
      if (clear) trunk = { x, z, radius, seed: Math.floor(hash(cx, cz, seed + SALT + 4) * 1e6) }
    }
    if (cache.size > 4000) cache.clear()
    cache.set(key, trunk)
    return trunk
  }

  const trunksNear = (x, z, reach) => {
    const result = []
    const minX = Math.floor((x - reach) / spacing)
    const maxX = Math.floor((x + reach) / spacing)
    const minZ = Math.floor((z - reach) / spacing)
    const maxZ = Math.floor((z + reach) / spacing)
    for (let cz = minZ; cz <= maxZ; cz += 1) {
      for (let cx = minX; cx <= maxX; cx += 1) {
        const trunk = trunkInCell(cx, cz)
        if (trunk && Math.hypot(trunk.x - x, trunk.z - z) <= reach + trunk.radius) {
          result.push(trunk)
        }
      }
    }
    return result
  }

  return {
    spacing,
    trunksNear,
    /** Metres from (x, z) to the nearest bark surface (0 inside a trunk). */
    distance(x, z, reach = 3) {
      let best = reach
      for (const trunk of trunksNear(x, z, reach)) {
        best = Math.min(best, Math.max(Math.hypot(trunk.x - x, trunk.z - z) - trunk.radius, 0))
      }
      return best
    },
  }
}
