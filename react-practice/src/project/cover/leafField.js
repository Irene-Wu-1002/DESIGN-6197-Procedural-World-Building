import { getNoise } from '../../utils/noise'
import { windVector } from '../../utils/windField'
import { hash } from '../terrain/heightField'
import { LEAF_COLORS } from './coverRules'

/**
 * Fallen leaves: the world-space parts of where they settle and how they
 * look, from the leaf settings (DEFAULT_COVER.leaves in coverRules.js).
 *
 *   drifts   a low-frequency noise at the drift size, stretched along the
 *            wind (wind influence) and roughened by a finer deposition
 *            noise. It is rank-normalised over a fixed sample, so the
 *            deposition threshold is the share of ground that stays sparse
 *            between drifts; drift strength blends from even cover to
 *            drifts only. Averages 1, so amount still sets the total.
 *   wind     a slow wobble on the wind direction leaves feel (wind
 *            variation), for lee tails and leaf alignment
 *   colour   slow noises choose autumn or green, the palette colour, and
 *            the brightness, so neighbouring leaves are related tones
 *
 * Obstacles (hollows, trunks, the ant hill, pebbles, branches) are applied
 * per tile in scatterLeaves.js.
 *
 * Plain data only, no Three.js.
 */

const SAMPLE = { side: 48, size: 12 }
// Drift noise stretched up to this many times along the wind.
const WIND_STRETCH = 2
const DRIFT_MIX = { main: 0.75, breakup: 0.25 }
const EDGE = 0.25
const WOBBLE_DEGREES = 60
const WOBBLE_WAVELENGTH = 0.5
// Colour patches are a bit smaller than drifts.
const COLOR_SCALE = 0.6
const SALT = { drift: 1101, breakup: 1102, wobble: 1103, autumn: 1104, tone: 1105, shade: 1106, sample: 1107 }

const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

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
 * settings: cover.leaves; seed: world seed; windDirection: the habitat's
 * wind (degrees it comes from).
 */
export function createLeafField(settings, { seed, windDirection }) {
  const offsetSeed = seed + settings.seedOffset * 7919
  const drift = settings.driftSize / 100
  const windInfluence = settings.windInfluence / 100
  const [bx, bz] = windVector(windDirection)
  const stretch = 1 + WIND_STRETCH * windInfluence
  const noise = (wavelength, octaves, salt) => ({
    type: 'perlin',
    scale: 1 / wavelength,
    octaves,
    persistence: 0.5,
    lacunarity: 2,
    seed: offsetSeed * 59 + salt,
  })
  const driftNoise = noise(drift, 2, SALT.drift)
  const breakupNoise = noise(drift * (settings.depositionNoiseScale / 100), 2, SALT.breakup)
  const wobbleNoise = noise(WOBBLE_WAVELENGTH, 1, SALT.wobble)
  const autumnNoise = noise(drift * COLOR_SCALE, 2, SALT.autumn)
  const toneNoise = noise(drift * COLOR_SCALE * 0.7, 1, SALT.tone)
  const shadeNoise = noise(drift * COLOR_SCALE * 0.5, 1, SALT.shade)

  // Drift noise in wind coordinates: longer along the wind than across.
  const rawDrift = (x, z) => {
    const along = (x * bx + z * bz) / stretch
    const across = -x * bz + z * bx
    return DRIFT_MIX.main * getNoise(along, across, driftNoise) + DRIFT_MIX.breakup * getNoise(x, z, breakupNoise)
  }

  // Ranks over a fixed sample, so thresholds and shares mean what they say.
  const sorted = { drift: [], autumn: [], tone: [] }
  const step = SAMPLE.size / SAMPLE.side
  for (let row = 0; row < SAMPLE.side; row += 1) {
    for (let column = 0; column < SAMPLE.side; column += 1) {
      const x = (column + hash(column, row, SALT.sample)) * step - SAMPLE.size / 2
      const z = (row + hash(column, row, SALT.sample + 1)) * step - SAMPLE.size / 2
      sorted.drift.push(rawDrift(x, z))
      sorted.autumn.push(getNoise(x, z, autumnNoise))
      sorted.tone.push(getNoise(x, z, toneNoise))
    }
  }
  for (const key in sorted) sorted[key] = Float64Array.from(sorted[key]).sort()
  const rank = (key, value) => lowerBound(sorted[key], value) / sorted[key].length

  const threshold = settings.depositionThreshold / 100
  const strength = settings.driftStrength / 100
  // Mean of the drift curve over uniform ranks, so drifts average 1.
  let mean = 0
  for (let k = 0; k < 200; k += 1) mean += smoothstep(threshold, threshold + EDGE, (k + 0.5) / 200)
  mean = Math.max(mean / 200, 1e-3)
  const autumnShare = settings.autumn / 100

  return {
    /** Drift density multiplier at (x, z): averages 1 over the world. */
    drift(x, z) {
      const inDrift = smoothstep(threshold, threshold + EDGE, rank('drift', rawDrift(x, z))) / mean
      return 1 + (inDrift - 1) * strength
    },

    /**
     * The wind direction leaves feel at (x, z), as a unit vector [x, z]
     * blowing toward: the local wind (wx, wz) turned by a slow wobble.
     */
    windAt(x, z, wx, wz) {
      let length = Math.hypot(wx, wz)
      if (length < 1e-6) {
        wx = bx
        wz = bz
        length = 1
      }
      const turn = ((WOBBLE_DEGREES * Math.PI) / 180) * (settings.windVariation / 100) * getNoise(x, z, wobbleNoise)
      const ux = wx / length
      const uz = wz / length
      return [ux * Math.cos(turn) - uz * Math.sin(turn), ux * Math.sin(turn) + uz * Math.cos(turn)]
    },

    /**
     * Related colours shared by neighbouring leaves: { autumn, palette,
     * shade } for the current autumn share, plus autumnRank (the share at
     * which this spot turns autumn), greenPalette and autumnPalette (indexes
     * into LEAF_COLORS.green / .autumn).
     */
    colorAt(x, z) {
      const autumnRank = rank('autumn', getNoise(x, z, autumnNoise))
      const autumn = autumnRank < autumnShare
      const tone = rank('tone', getNoise(x, z, toneNoise))
      const index = (count) => Math.min(Math.floor(tone * count), count - 1)
      const greenPalette = index(LEAF_COLORS.green.length)
      const autumnPalette = index(LEAF_COLORS.autumn.length)
      return {
        autumn,
        palette: autumn ? autumnPalette : greenPalette,
        autumnRank,
        greenPalette,
        autumnPalette,
        shade: 0.5 + 0.35 * getNoise(x, z, shadeNoise),
      }
    },
  }
}
