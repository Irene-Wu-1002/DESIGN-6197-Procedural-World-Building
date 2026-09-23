// Deterministic 2D hashing keeps every noise type reproducible from one seed.
function hash2(x, y, seed) {
  let value = Math.imul(x, 374761393)
  value = Math.imul(value + Math.imul(y, 668265263), 1274126177)
  value = Math.imul(value ^ seed, 2246822519)
  value ^= value >>> 13
  return (value >>> 0) / 4294967296
}

function fade(value) {
  return value * value * value * (value * (value * 6 - 15) + 10)
}

function lerp(a, b, amount) {
  return a + (b - a) * amount
}

const PERLIN_GRADIENTS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
]

function gradientDot(gridX, gridY, x, y, seed) {
  const gradient =
    PERLIN_GRADIENTS[
      Math.floor(hash2(gridX, gridY, seed) * PERLIN_GRADIENTS.length)
    ]
  return gradient[0] * x + gradient[1] * y
}

// Returns approximately -1..1.
function perlin2D(x, y, seed) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const localX = x - x0
  const localY = y - y0

  const top = lerp(
    gradientDot(x0, y0, localX, localY, seed),
    gradientDot(x0 + 1, y0, localX - 1, localY, seed),
    fade(localX)
  )
  const bottom = lerp(
    gradientDot(x0, y0 + 1, localX, localY - 1, seed),
    gradientDot(x0 + 1, y0 + 1, localX - 1, localY - 1, seed),
    fade(localX)
  )

  return lerp(top, bottom, fade(localY)) * 1.45
}

// Each coordinate receives a deterministic random value in the range -1..1.
function whiteNoise2D(x, y, seed) {
  return (
    hash2(Math.floor(x * 4096), Math.floor(y * 4096), seed) * 2 - 1
  )
}

// Distance to the nearest seeded feature point, remapped to -1..1.
function cellular2D(x, y, seed) {
  const cellX = Math.floor(x)
  const cellY = Math.floor(y)
  let nearestDistance = Infinity

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const neighborX = cellX + offsetX
      const neighborY = cellY + offsetY
      const pointX = neighborX + hash2(neighborX, neighborY, seed)
      const pointY = neighborY + hash2(neighborX, neighborY, seed + 7919)
      nearestDistance = Math.min(
        nearestDistance,
        Math.hypot(x - pointX, y - pointY)
      )
    }
  }

  return 1 - 2 * Math.min(nearestDistance / Math.SQRT2, 1)
}

const NOISE_FUNCTIONS = {
  white: whiteNoise2D,
  perlin: perlin2D,
  cellular: cellular2D,
}

/**
 * Sample layered 2D noise at any coordinate.
 *
 * This function is independent of the canvas. A future terrain can call
 * getNoise(vertex.x, vertex.z, params) and use the result as vertex height.
 * The returned value is clamped to the reusable range -1..1.
 */
export function getNoise(x, y, params) {
  const {
    type = 'perlin',
    scale = 0.012,
    octaves = 4,
    persistence = 0.5,
    lacunarity = 2,
    seed = 1,
  } = params
  const sampleNoise = NOISE_FUNCTIONS[type] ?? perlin2D
  let frequency = scale
  let amplitude = 1
  let amplitudeTotal = 0
  let value = 0

  for (let octave = 0; octave < octaves; octave += 1) {
    value +=
      sampleNoise(x * frequency, y * frequency, seed + octave * 1013) *
      amplitude
    amplitudeTotal += amplitude
    amplitude *= persistence
    frequency *= lacunarity
  }

  return Math.max(-1, Math.min(1, value / amplitudeTotal))
}

/**
 * Blend any number of independently configured earth layers.
 * Each layer can be sampled separately with getNoise(), or combined here.
 */
export function getBlendedNoise(x, y, layers) {
  let value = 0
  let weightTotal = 0

  for (const layer of layers) {
    if (!layer.enabled || layer.weight <= 0) continue
    value += getNoise(x, y, layer) * layer.weight
    weightTotal += layer.weight
  }

  if (weightTotal === 0) return 0
  return Math.max(-1, Math.min(1, value / weightTotal))
}
