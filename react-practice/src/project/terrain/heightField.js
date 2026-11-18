import { getNoise } from '../../utils/noise'
import { DEFAULT_NESTS, antHills } from './antHills'
import { hash } from './hash'

/**
 * The micro-world ground as one pure function of world position (metres).
 * Because height(x, z) only depends on (x, z) and the seed, any tile can be
 * built anywhere and its edges always match its neighbours, and walking
 * back to a place shows the same ground.
 *
 * Layers, from large to small:
 *   broad slopes   ~30 cm wavelength, up to ~3 cm high
 *   domain warp    pushes the inputs around so soil looks settled
 *   bumps/hollows  ~3 cm wavelength, a few mm high, sharper hollows
 *   pebbles        rounded domes, one per 1.6 cm cell at most, in patches
 *   ant hills      mounds with a crater: the main one at the world origin,
 *                  and seeded satellite nests (terrain/antHills.js)
 *   ant trail      a worn strip to the fly agaric (paths/antTrail.js):
 *                  pressed down, with fine crumbs, cleared of pebbles
 * The ~2 mm grain is added in the ground shader (groundMaterial.js).
 *
 * Plain data only, no Three.js.
 */

export const TILE_SIZE = 0.2

export const DEFAULT_GROUND = {
  seed: 1,
  slopes: 100,
  bumps: 100,
  warp: 100,
  grain: 100,
  pebbles: 50,
  antHill: true,
  // How many nests the colony lives in (the main hill and its satellites).
  nests: DEFAULT_NESTS,
  // Tree trunks change ground moisture and colour, so they live here.
  trunks: true,
  trunkSpacing: 3.5,
}

// Leaf litter: where fallen leaves pile up (used for density and soil tint).
const LITTER = { wavelength: 0.25 }

const BROAD = { wavelength: 0.3, height: 0.03 }
const BUMPS = { wavelength: 0.03, height: 0.005 }
const WARP = { wavelength: 0.12, distance: 0.025 }
const PEBBLE = {
  cell: 0.016,
  radius: [0.0022, 0.0062],
  // Dome height as a share of the radius.
  height: [0.45, 0.8],
  patchWavelength: 0.15,
}
export { ANT_HILL } from './antHills'
export { hash }

const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * Build a sampler for these settings. sample(x, z, out) fills `out` with
 *   height   metres (the sum of the parts below plus any pebble)
 *   broadHeight, bumpHeight, hillHeight, pebbleHeight   the parts
 *   broadLowHeight   just the 30 cm octave of the slopes (smooth surface)
 *   broad    the broad-slope noise (-1–1); low ground collects moisture
 *   bump     the bumps/hollows noise (-1–1); negative in hollows
 *   pebble   0–1, how much this point is covered by a pebble
 *   shade    0–1, the pebble's own colour variation
 *   pebbleChance  0–1, how likely this cell holds a pebble (for far ground)
 *   hill     0–1, how far onto the ant hill this point is
 *   litter   0–1, how much leaf litter gathers here (slow, ~25 cm patches)
 *   trail    0–1, how much this point is on the ant trail
 *   trailTone  0–1, how much darker the trail makes the soil here
 *
 * settings.trail: the ant trail (paths/antTrail.js) or null.
 */
export function createGroundSampler(settings) {
  const seed = settings.seed
  const slopes = settings.slopes / 100
  const bumps = settings.bumps / 100
  const warp = settings.warp / 100
  const pebbleDensity = settings.pebbles / 100
  const noise = (wavelength, octaves, offset) => ({
    type: 'perlin',
    scale: 1 / wavelength,
    octaves,
    persistence: 0.5,
    lacunarity: 2,
    seed: seed * 101 + offset,
  })
  const warpX = noise(WARP.wavelength, 2, 1)
  const warpZ = noise(WARP.wavelength, 2, 2)
  const broadNoise = noise(BROAD.wavelength, 3, 3)
  // Just the first (30 cm) octave of the same noise: the smooth surface that
  // distant tiles and the far ground share. In a 3-octave sum with
  // persistence 0.5 the first octave carries 1 / 1.75 of the weight.
  const broadLowNoise = { ...broadNoise, octaves: 1 }
  const FIRST_OCTAVE_SHARE = 1 / 1.75
  const bumpNoise = noise(BUMPS.wavelength, 3, 4)
  const patchNoise = noise(PEBBLE.patchWavelength, 2, 5)
  const hillNoise = noise(0.05, 2, 6)
  // One octave is enough: litter only needs slow, soft patches.
  const litterNoise = noise(LITTER.wavelength, 1, 7)
  // Pebble patchiness is the same for every point in a cell, so cache it.
  const patchCache = new Map()
  const trail = settings.trail ?? null
  const clearedCache = new Map()
  // Crumbs on the trail: ~4 mm soil grains.
  const crumbNoise = noise(0.004, 1, 8)

  const hills = settings.antHill ? antHills(seed, settings.nests ?? DEFAULT_NESTS) : []
  const hillAt = (x, z) => {
    let lift = 0
    let mask = 0
    for (const hill of hills) {
      const d = Math.hypot(x - hill.x, z - hill.z)
      if (d > hill.radius * (1 + hill.wobble)) continue
      const radius = hill.radius * (1 + hill.wobble * getNoise(x, z, hillNoise))
      const t = Math.min(d / radius, 1)
      const mound = hill.height * (0.5 + 0.5 * Math.cos(Math.PI * t))
      const crater = d < hill.craterRadius ? hill.craterDepth * (1 - (d / hill.craterRadius) ** 2) : 0
      lift += mound - crater
      mask = Math.max(mask, 1 - smoothstep(0.55, 1, t))
    }
    return { lift, mask }
  }

  const pebbleAt = (x, z, hillMask, out) => {
    out.pebble = 0
    out.shade = 0
    out.pebbleChance = 0
    if (pebbleDensity <= 0) return 0
    const cx = Math.floor(x / PEBBLE.cell)
    const cz = Math.floor(z / PEBBLE.cell)
    const key = cx * 100003 + cz
    let patch = patchCache.get(key)
    if (patch === undefined) {
      patch = 0.5 + 0.5 * getNoise((cx + 0.5) * PEBBLE.cell, (cz + 0.5) * PEBBLE.cell, patchNoise)
      if (patchCache.size > 50000) patchCache.clear()
      patchCache.set(key, patch)
    }
    // Pebbles gather in patches and stay off the ant hill; ants clear them
    // from their trail (decided at the cell's centre, so no half pebbles).
    let cleared = 0
    if (trail) {
      cleared = clearedCache.get(key)
      if (cleared === undefined) {
        cleared = trail.clearing * trail.maskAt((cx + 0.5) * PEBBLE.cell, (cz + 0.5) * PEBBLE.cell)
        if (clearedCache.size > 50000) clearedCache.clear()
        clearedCache.set(key, cleared)
      }
    }
    const chance = pebbleDensity * (0.15 + 1.2 * patch * patch) * (1 - hillMask) * (1 - cleared)
    out.pebbleChance = Math.min(chance, 1)
    if (hash(cx, cz, seed) >= chance) return 0
    const radius =
      PEBBLE.radius[0] + hash(cx, cz, seed + 1) * (PEBBLE.radius[1] - PEBBLE.radius[0])
    // Keep the whole pebble inside its cell, so only this cell needs checking.
    const room = PEBBLE.cell - 2 * radius
    const px = cx * PEBBLE.cell + radius + hash(cx, cz, seed + 2) * room
    const pz = cz * PEBBLE.cell + radius + hash(cx, cz, seed + 3) * room
    const d2 = ((x - px) ** 2 + (z - pz) ** 2) / (radius * radius)
    if (d2 >= 1) return 0
    const tall = PEBBLE.height[0] + hash(cx, cz, seed + 4) * (PEBBLE.height[1] - PEBBLE.height[0])
    out.pebble = smoothstep(1, 0.7, d2)
    out.shade = hash(cx, cz, seed + 5)
    return radius * tall * Math.sqrt(1 - d2)
  }

  return {
    seed,
    // The broad-slope noise settings: the habitat's wet/dry patches reuse
    // them, so at their default size they follow the low ground.
    broadNoise,
    sample(x, z, out) {
      const wx = getNoise(x, z, warpX) * WARP.distance * warp
      const wz = getNoise(x, z, warpZ) * WARP.distance * warp
      const broad = getNoise(x + wx * 0.5, z + wz * 0.5, broadNoise)
      // Hollows a little sharper than the bumps.
      const n = getNoise(x + wx, z + wz, bumpNoise)
      const shaped = n >= 0 ? n : -((-n) ** 0.75)
      const hill = hillAt(x, z)
      out.broadHeight = broad * BROAD.height * slopes
      out.broadLowHeight =
        getNoise(x + wx * 0.5, z + wz * 0.5, broadLowNoise) *
        FIRST_OCTAVE_SHARE *
        BROAD.height *
        slopes
      out.bumpHeight = shaped * BUMPS.height * bumps
      out.hillHeight = hill.lift
      out.pebbleHeight = pebbleAt(x, z, hill.mask, out)
      out.height = out.broadHeight + out.bumpHeight + out.hillHeight + out.pebbleHeight
      out.trail = 0
      out.trailTone = 0
      if (trail) {
        const onTrail = trail.maskAt(x, z)
        if (onTrail > 0) {
          const crumb = getNoise(x, z, crumbNoise)
          // Pressed down, with fine crumbs (up to ~0.3 mm) on top.
          out.height += onTrail * (-trail.compression + trail.detail * 0.0003 * crumb)
          out.trail = onTrail
          out.trailTone = onTrail * trail.darkness * (1 + 0.5 * trail.detail * crumb)
        }
      }
      out.broad = broad
      out.bump = shaped
      out.hill = hill.mask
      out.litter = 0.5 + 0.5 * getNoise(x, z, litterNoise)
      return out
    },
    height(x, z) {
      return this.sample(x, z, {}).height
    },
  }
}
