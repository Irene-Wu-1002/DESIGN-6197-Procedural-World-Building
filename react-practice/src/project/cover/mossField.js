import { getNoise } from '../../utils/noise'
import { hash } from '../terrain/heightField'

/**
 * Moss patches: where moss carpets grow, as a pure function of world
 * position, the seed, the habitat, and the moss settings (DEFAULT_COVER.moss
 * in coverRules.js).
 *
 * The patch shapes come from a low-frequency noise (warped, at the patch
 * size, roughened by a finer breakup noise); the habitat (wetness, shade,
 * hollows, a little pull toward trunk bases) raises or lowers the score
 * locally, so patches reach into damp, shady hollows and shrink away from
 * dry, open ground without breaking apart. The noise is rank-normalised
 * over a fixed calibration sample, so "noise threshold 35%" means the 35%
 * of ground with the lowest noise always stays bare soil. The same sample
 * sets the score cut that makes `amount` the share of ground inside
 * patches.
 *
 * Plain data only, no Three.js.
 */

// Calibration: a fixed jittered grid of points (16 m square around the
// start), wide enough to hold many of even the largest patches.
const SAMPLE = { side: 56, size: 16 }
// Cushion grid jitter (share of a cell); neighbours stay ≥ minSpacing apart.
const JITTER = 0.4
// Noise wavelength per patch size: at about this ratio a patch's typical
// width matches the Patch size setting.
const WAVELENGTH_PER_SIZE = 2.5
const WARP = 0.3
const NOISE_MIX = { main: 0.75, breakup: 0.25 }
const TRUNK_PULL = { weight: 0.3, reach: 0.3 }
// How far the habitat can move the score (the noise rank spans 0–1).
const HABITAT_INFLUENCE = 0.3
// Edge width of the patch score at 0% and 100% contrast.
const EDGE = [0.09, 0.005]
const TONES = 4
const SALT = { main: 811, warpX: 812, warpZ: 813, breakup: 814, tone: 815, sample: 816 }

const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

// Index of the first value in a sorted list that is ≥ value.
function lowerBound(sorted, value) {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (sorted[middle] < value) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * settings: cover.moss; habitat: the habitat field; sampler: the ground;
 * seed: the world seed. Returns { density(x, z, g), toneAt(x, z), cell,
 * coverage }, where g holds moisture, shade, concavity and trunk (m to bark)
 * at the point.
 */
export function createMossField(settings, { habitat, sampler, seed }) {
  const patch = settings.patchSize / 100
  // Random offset: a different arrangement of the same kind of patches.
  const offsetX = (hash(settings.randomOffset, 17, seed + SALT.main) - 0.5) * 2000
  const offsetZ = (hash(settings.randomOffset, 29, seed + SALT.main) - 0.5) * 2000
  const noise = (wavelength, octaves, salt) => ({
    type: 'perlin',
    scale: 1 / wavelength,
    octaves,
    persistence: 0.5,
    lacunarity: 2,
    seed: seed * 43 + salt,
  })
  const wavelength = patch * WAVELENGTH_PER_SIZE
  const mainNoise = noise(wavelength, 2, SALT.main)
  const warpXNoise = noise(wavelength, 1, SALT.warpX)
  const warpZNoise = noise(wavelength, 1, SALT.warpZ)
  const breakupNoise = noise(patch * (settings.noiseScale / 100), 2, SALT.breakup)
  const toneNoise = noise(wavelength, 1, SALT.tone)
  const weights = {
    moisture: settings.moisturePreference / 100,
    shade: settings.shadePreference / 100,
    concavity: settings.concavityPreference / 100,
  }
  const threshold = settings.noiseThreshold / 100
  const edge = EDGE[0] + (EDGE[1] - EDGE[0]) * (settings.patchContrast / 100)

  const rawNoise = (x, z) => {
    const px = x + offsetX
    const pz = z + offsetZ
    const wx = getNoise(px, pz, warpXNoise) * wavelength * WARP
    const wz = getNoise(px, pz, warpZNoise) * wavelength * WARP
    return (
      NOISE_MIX.main * getNoise(px + wx, pz + wz, mainNoise) + NOISE_MIX.breakup * getNoise(px, pz, breakupNoise)
    )
  }
  // 0–1 rank of the noise among the calibration points.
  let sortedNoise = null
  const noiseRank = (x, z) => lowerBound(sortedNoise, rawNoise(x, z)) / sortedNoise.length

  const scoreOf = (rank, g) => {
    const wet = smoothstep(0.35, 0.75, g.moisture)
    const shade = smoothstep(0.15, 0.75, g.shade)
    const hollow = 0.5 + 0.5 * g.concavity
    const trunk = Math.exp(-g.trunk / TRUNK_PULL.reach)
    return (
      rank +
      HABITAT_INFLUENCE *
        (weights.moisture * wet + weights.shade * shade + weights.concavity * hollow + TRUNK_PULL.weight * trunk)
    )
  }

  // Calibrate on the fixed sample: noise ranks, then the score cut.
  const points = []
  const sample = {}
  const fields = {}
  const step = SAMPLE.size / SAMPLE.side
  for (let row = 0; row < SAMPLE.side; row += 1) {
    for (let column = 0; column < SAMPLE.side; column += 1) {
      const x = (column + hash(column, row, SALT.sample)) * step - SAMPLE.size / 2
      const z = (row + hash(column, row, SALT.sample + 1)) * step - SAMPLE.size / 2
      sampler.sample(x, z, sample)
      habitat.farPoint(x, z, sample, 1, fields)
      points.push({
        noise: rawNoise(x, z),
        g: { moisture: fields.moisture, shade: fields.shade, concavity: fields.concavity, trunk: fields.trunkDistance },
      })
    }
  }
  sortedNoise = Float64Array.from(points, (point) => point.noise).sort()
  // Bare ground (below the noise threshold) scores −1, so it is never in.
  const scores = points
    .map((point) => {
      const rank = lowerBound(sortedNoise, point.noise) / sortedNoise.length
      return rank < threshold ? -1 : scoreOf(rank, point.g)
    })
    .sort((a, b) => b - a)
  const target = Math.min(Math.round((settings.amount / 100) * scores.length), scores.length)
  const eligible = scores.filter((score) => score >= 0).length
  const cut = target === 0 ? Infinity : scores[Math.min(target, eligible) - 1]

  return {
    /** Grid cell (m) for cushions: no two centres closer than minSpacing. */
    cell: settings.minSpacing / 100 / (1 - JITTER),
    jitter: JITTER,
    /** Share of the calibration ground inside patches (≤ amount). */
    coverage: Math.min(target, eligible) / scores.length,

    /** How much this spot is inside a moss patch: 0 (bare) – 1 (carpet). */
    density(x, z, g) {
      if (!Number.isFinite(cut)) return 0
      const rank = noiseRank(x, z)
      const gate = smoothstep(threshold, threshold + 0.03, rank)
      if (gate <= 0) return 0
      return gate * smoothstep(cut - edge, cut + edge, scoreOf(rank, g))
    },

    /** The patch's base colour (index into MOSS_COLORS), slow across space. */
    toneAt(x, z) {
      const value = smoothstep(-0.4, 0.4, getNoise(x + offsetX, z + offsetZ, toneNoise))
      return Math.min(Math.floor(value * TONES), TONES - 1)
    },
  }
}
