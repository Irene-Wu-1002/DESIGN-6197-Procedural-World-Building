import { windVector } from '../../utils/windField'
import { WIND } from './ecologyConfig'

/**
 * The air the scent and the butterflies move in: the world's wind as a
 * velocity (m/s) at any ground position.
 *
 * Direction and local variation come from the Habitat wind field
 * (habitat/habitatFields.js: the set direction turned a little from place
 * to place, faster over ridges and up windward slopes, calmer in hollows),
 * sampled on a WIND.cell grid and cached until the habitat changes.
 * Strength is a 0–1 share (the Habitat strength, or the Weather wind while
 * the simulation runs, blended by MapScene) times WIND.speedAtFull.
 * Direction convention: `from` is the angle the wind comes FROM (as in the
 * Habitat tab); the velocity points the way it blows TO.
 *
 * The same cache keeps the Habitat shade (canopy gaps and trunk shadows,
 * 0 open – 1 deep shade) for shadeAt(), so sunny and shady spots come from
 * the same field the plants grow by.
 *
 * Plain data only, no Three.js.
 */

const cellKey = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768)

export function createWindSampler() {
  let habitat = null
  let habitatKey = null
  let strength = 0
  let from = 45
  let blow = windVector(from)
  const cache = new Map()
  const fields = {}

  // Local direction (unit) and speed factor (relative to the set strength).
  const cell = (ix, iz) => {
    const key = cellKey(ix, iz)
    let value = cache.get(key)
    if (value) return value
    let dx = blow[0]
    let dz = blow[1]
    let factor = 1
    let shade = 0.4
    if (habitat) {
      habitat.at(ix * WIND.cell, iz * WIND.cell, fields)
      const length = Math.hypot(fields.windX, fields.windZ)
      if (length > 1e-6) {
        dx = fields.windX / length
        dz = fields.windZ / length
      }
      const set = habitat.settings.windStrength / 100
      factor = set > 0.01 ? fields.wind / set : 1
      shade = fields.shade
    }
    if (cache.size > WIND.cacheLimit) cache.clear()
    value = { dx, dz, factor, shade }
    cache.set(key, value)
    return value
  }

  return {
    /** The habitat field and a key that changes with it. */
    setHabitat(next, key) {
      if (key === habitatKey && next === habitat) return
      habitat = next
      habitatKey = key
      cache.clear()
    },

    /** strength 0–1; fromDegrees: where the wind comes from. */
    setWind(nextStrength, fromDegrees) {
      strength = Math.max(nextStrength, 0)
      if (fromDegrees !== from) {
        from = fromDegrees
        blow = windVector(from)
        // Without a habitat the cache holds the plain direction.
        if (!habitat) cache.clear()
      }
    },

    get strength() {
      return strength
    },
    get from() {
      return from
    },
    /** Unit vector the wind blows toward (x, z). */
    get toward() {
      return blow
    },
    /** The set (unvaried) wind speed, m/s. */
    get speed() {
      return strength * WIND.speedAtFull
    },

    /** Habitat shade at (x, z), 0 open – 1 deep shade (nearest cell). */
    shadeAt(x, z) {
      return cell(Math.round(x / WIND.cell), Math.round(z / WIND.cell)).shade
    },

    /** Wind velocity at (x, z) in m/s → out { x, z }. */
    at(x, z, out) {
      const base = strength * WIND.speedAtFull
      if (base <= 0) {
        out.x = 0
        out.z = 0
        return out
      }
      const gx = x / WIND.cell
      const gz = z / WIND.cell
      const ix = Math.floor(gx)
      const iz = Math.floor(gz)
      const fx = gx - ix
      const fz = gz - iz
      const a = cell(ix, iz)
      const b = cell(ix + 1, iz)
      const c = cell(ix, iz + 1)
      const d = cell(ix + 1, iz + 1)
      const w0 = (1 - fx) * (1 - fz)
      const w1 = fx * (1 - fz)
      const w2 = (1 - fx) * fz
      const w3 = fx * fz
      out.x = base * (a.dx * a.factor * w0 + b.dx * b.factor * w1 + c.dx * c.factor * w2 + d.dx * d.factor * w3)
      out.z = base * (a.dz * a.factor * w0 + b.dz * b.factor * w1 + c.dz * c.factor * w2 + d.dz * d.factor * w3)
      return out
    },
  }
}
