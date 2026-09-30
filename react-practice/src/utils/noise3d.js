// Fast, deterministic 3D value noise for density fields.
// Unlike sampleNoise3D in densityShapes.js (three 2D projections), this is a
// true 3D lattice noise, so bark and canopy detail has no projection streaks.

function hash3(x, y, z, seed) {
  let value = Math.imul(x, 374761393)
  value = Math.imul(value + Math.imul(y, 668265263), 1274126177)
  value = Math.imul(value + Math.imul(z, 2147483647), 1597334677)
  value = Math.imul(value ^ seed, 2246822519)
  value ^= value >>> 13
  value = Math.imul(value, 3266489917)
  value ^= value >>> 16
  return (value >>> 0) / 4294967296
}

function fade(value) {
  return value * value * value * (value * (value * 6 - 15) + 10)
}

// Returns approximately -1..1.
export function valueNoise3D(x, y, z, seed) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const z0 = Math.floor(z)
  const tx = fade(x - x0)
  const ty = fade(y - y0)
  const tz = fade(z - z0)

  const c000 = hash3(x0, y0, z0, seed)
  const c100 = hash3(x0 + 1, y0, z0, seed)
  const c010 = hash3(x0, y0 + 1, z0, seed)
  const c110 = hash3(x0 + 1, y0 + 1, z0, seed)
  const c001 = hash3(x0, y0, z0 + 1, seed)
  const c101 = hash3(x0 + 1, y0, z0 + 1, seed)
  const c011 = hash3(x0, y0 + 1, z0 + 1, seed)
  const c111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed)

  const x00 = c000 + (c100 - c000) * tx
  const x10 = c010 + (c110 - c010) * tx
  const x01 = c001 + (c101 - c001) * tx
  const x11 = c011 + (c111 - c011) * tx
  const y0v = x00 + (x10 - x00) * ty
  const y1v = x01 + (x11 - x01) * ty
  return (y0v + (y1v - y0v) * tz) * 2 - 1
}

// Fractal Brownian motion: layered octaves of value noise, roughly -1..1.
export function fbm3D(x, y, z, seed, octaves = 3) {
  let frequency = 1
  let amplitude = 1
  let total = 0
  let amplitudeTotal = 0

  for (let octave = 0; octave < octaves; octave += 1) {
    total +=
      valueNoise3D(x * frequency, y * frequency, z * frequency, seed + octave * 1013) *
      amplitude
    amplitudeTotal += amplitude
    amplitude *= 0.5
    frequency *= 2
  }

  return total / amplitudeTotal
}

// Small seeded PRNG (mulberry32) so a tree's structure is reproducible.
export function createRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
