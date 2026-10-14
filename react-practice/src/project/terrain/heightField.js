import { getNoise } from '../../utils/noise'

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
 *   ant hill       a mound with a crater at the world origin
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

// Integer hash → 0–1, independent per (x, z, seed).
export function hash(x, z, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1103515245)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

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

  const hillAt = (x, z) => {
    if (!settings.antHill) return { lift: 0, mask: 0 }
    const d = Math.hypot(x - ANT_HILL.x, z - ANT_HILL.z)
    if (d > ANT_HILL.radius * (1 + ANT_HILL.wobble)) return { lift: 0, mask: 0 }
    const radius = ANT_HILL.radius * (1 + ANT_HILL.wobble * getNoise(x, z, hillNoise))
    const t = Math.min(d / radius, 1)
    const mound = ANT_HILL.height * (0.5 + 0.5 * Math.cos(Math.PI * t))
    const crater =
      d < ANT_HILL.craterRadius
        ? ANT_HILL.craterDepth * (1 - (d / ANT_HILL.craterRadius) ** 2)
        : 0
    return { lift: mound - crater, mask: 1 - smoothstep(0.55, 1, t) }
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
    // Pebbles gather in patches and stay off the ant hill.
    const chance = pebbleDensity * (0.15 + 1.2 * patch * patch) * (1 - hillMask)
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
