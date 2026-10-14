import { getNoise } from '../../utils/noise'
import { windVector } from '../../utils/windField'
import { TILE_SIZE } from '../terrain/heightField'

/**
 * Habitat: the conditions on the forest floor that decide what grows and
 * gathers where. Each field is a pure function of world position, the seed,
 * the ground settings, and the habitat settings, so every tile agrees with
 * its neighbours and a spot is the same each time you come back.
 *
 *   slope      degrees, of the ground without pebbles (~1 cm scale)
 *   concavity  -1 on ridges and bumps … +1 in hollows (~2 cm scale)
 *   shade      0 open … 1 deep shade: canopy gaps (~1.5 m) and trunk
 *              shadows cast away from the sun
 *   sunlight   0 … 1: how squarely the ground faces the sun, less shade,
 *              cut at the light threshold
 *   wind       speed 0 … 1 and direction (windX, windZ): the set wind with
 *              slow variation, faster on windward slopes and ridges, calm
 *              in hollows
 *   moisture   0 dry … 1 wet: wet/dry patches, wetter in hollows, near bark
 *              and in shade, drier on steep ground (runoff)
 *
 * Fields are worked out on a coarse world-aligned lattice (16 cells per
 * tile, 1.25 cm apart) and interpolated to each tile's grid, which keeps
 * them cheap and smooth (no flicker from millimetre grain).
 *
 * Plain data only, no Three.js.
 */

export const DEFAULT_HABITAT = {
  // Size of the wet/dry patches (cm); 30 cm follows the broad slopes.
  moistureScale: 30,
  // How far moisture spreads from the middle (%), and the overall level (%).
  moistureContrast: 100,
  wetness: 50,
  // Compass angle (°) toward the sun and its height above the horizon (°).
  sunDirection: 61,
  sunElevation: 47,
  // Light (%) a spot needs to count as sunny.
  lightThreshold: 50,
  // Degrees the wind comes FROM; strength and variation in %.
  windDirection: 45,
  windStrength: 40,
  windVariation: 30,
  // How much slope and concavity shape the other fields (%).
  slopeInfluence: 100,
  concavityInfluence: 100,
}

/** Fields that can be previewed on the ground: [id, label]. */
export const HABITAT_FIELDS = [
  ['moisture', 'Moisture'],
  ['sunlight', 'Sunlight'],
  ['shade', 'Shade'],
  ['slope', 'Slope'],
  ['concavity', 'Concavity'],
  ['wind', 'Wind'],
]

const CELLS = 16
const SPACING = TILE_SIZE / CELLS
const POINTS = CELLS + 1
// The broad-slope wavelength (cm) the moisture scale is measured against.
const BROAD_CM = 30
// Curvature (1/m) that counts as a clear hollow or ridge; at this scale
// concavity matches the size of the old hollow term (the bump noise).
const CONCAVITY_SCALE = 60
// Moisture weights; at the default settings they match the old moisture
// (0.5 − 0.35 · broad − 0.3 · bump, damper by trunks).
const MOISTURE = { patch: 0.35, hollow: 0.3, runoff: 0.12, runoffSlope: [15, 40], shade: 0.1, shadeMean: 0.37 }
const TRUNK_DAMP = { amount: 0.3, reach: 0.25 }
const CANOPY = { wavelength: 1.5, open: 0.15, closed: 0.75 }
// Trunks are a few metres tall; their shadows stop at maxLength.
const TRUNK_SHADOW = { height: 3, maxLength: 4, strength: 0.8, spread: 0.05 }
const WIND = { turn: 50, gust: 0.6, variationWavelength: 0.6, gustWavelength: 0.4, windward: 0.6, shelter: 0.5, ridge: 0.2 }
const SALT = { canopy: 11, windTurn: 12, windGust: 13 }

const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}
const clamp01 = (value) => Math.min(Math.max(value, 0), 1)
const radians = (degrees) => (degrees * Math.PI) / 180

/** Unit vector toward the sun [x, y, z] for these settings. */
export function sunDirectionOf(habitat) {
  const azimuth = radians(habitat.sunDirection)
  const elevation = radians(habitat.sunElevation)
  return [Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth)]
}

/**
 * sampler: the ground (terrain/heightField.js); trunks: the trunk field or
 * null; habitat: settings (DEFAULT_HABITAT's keys).
 */
export function createHabitatField(sampler, trunks, habitat) {
  const seed = sampler.seed
  const slopeInfluence = habitat.slopeInfluence / 100
  const concavityInfluence = habitat.concavityInfluence / 100
  const contrast = habitat.moistureContrast / 100
  const wetness = habitat.wetness / 100
  const threshold = habitat.lightThreshold / 100
  const strength = habitat.windStrength / 100
  const variation = habitat.windVariation / 100
  const sun = sunDirectionOf(habitat)
  const sunFlat = Math.hypot(sun[0], sun[2]) || 1
  // Shadows fall away from the sun.
  const away = [-sun[0] / sunFlat, -sun[2] / sunFlat]
  const shadowLength = Math.min(TRUNK_SHADOW.height / Math.tan(radians(habitat.sunElevation)), TRUNK_SHADOW.maxLength)
  const blow = windVector(habitat.windDirection)
  const noise = (wavelength, octaves, salt) => ({
    type: 'perlin',
    scale: 1 / wavelength,
    octaves,
    persistence: 0.5,
    lacunarity: 2,
    seed: seed * 53 + salt,
  })
  const patchNoise = { ...sampler.broadNoise, scale: sampler.broadNoise.scale * (BROAD_CM / habitat.moistureScale) }
  const canopyNoise = noise(CANOPY.wavelength, 2, SALT.canopy)
  const turnNoise = noise(WIND.variationWavelength, 2, SALT.windTurn)
  const gustNoise = noise(WIND.gustWavelength, 1, SALT.windGust)

  const nearTrunks = (x, z, reach) => (trunks ? trunks.trunksNear(x, z, reach) : [])
  const trunkReach = Math.max(shadowLength, 1) + TILE_SIZE

  // Shade and bark distance from a list of nearby trunks.
  const shadeAt = (x, z, list, out) => {
    const canopy = CANOPY.open + (CANOPY.closed - CANOPY.open) * smoothstep(-0.3, 0.3, getNoise(x, z, canopyNoise))
    let shadow = 0
    let bark = 3
    for (const trunk of list) {
      const dx = x - trunk.x
      const dz = z - trunk.z
      bark = Math.min(bark, Math.max(Math.hypot(dx, dz) - trunk.radius, 0))
      const along = dx * away[0] + dz * away[1]
      if (along < -trunk.radius || along > shadowLength) continue
      const across = Math.abs(dx * away[1] - dz * away[0])
      // Softer and a little wider further from the trunk.
      const edge = trunk.radius + Math.max(along, 0) * TRUNK_SHADOW.spread
      const inside = smoothstep(edge + 0.03, edge - 0.01, across)
      const fade = 1 - smoothstep(0.7 * shadowLength, shadowLength, along)
      shadow = Math.max(shadow, TRUNK_SHADOW.strength * inside * fade)
    }
    out.shade = 1 - (1 - canopy) * (1 - shadow)
    out.trunkDistance = bark
    return out
  }

  /**
   * Every field at one point from the local ground shape: gradient (dx, dz)
   * and slope in degrees, concavity −1…1, plus a list of nearby trunks.
   */
  const fieldsAt = (x, z, dx, dz, slope, concavity, list, out) => {
    shadeAt(x, z, list, out)
    out.slope = slope
    out.concavity = concavity

    // Sunlight on the ground's normal (slope influence tilts it).
    const nx = -dx * slopeInfluence
    const nz = -dz * slopeInfluence
    const facing = Math.max((nx * sun[0] + sun[1] + nz * sun[2]) / Math.hypot(nx, 1, nz), 0)
    out.sunlight = smoothstep(threshold - 0.2, threshold + 0.2, facing * (1 - out.shade))

    // Wind: the set direction, turned and gusting a little from place to
    // place, faster up windward slopes and over ridges, calm in hollows.
    const turn = radians(WIND.turn) * variation * getNoise(x, z, turnNoise)
    const bx = blow[0] * Math.cos(turn) - blow[1] * Math.sin(turn)
    const bz = blow[0] * Math.sin(turn) + blow[1] * Math.cos(turn)
    const gust = 1 + WIND.gust * variation * getNoise(x, z, gustNoise)
    const windward = WIND.windward * slopeInfluence * Math.max(Math.min(dx * bx + dz * bz, 1), -1)
    const terrain =
      1 +
      windward +
      concavityInfluence * (WIND.ridge * Math.max(-concavity, 0) - WIND.shelter * Math.max(concavity, 0))
    out.wind = clamp01(strength * gust * Math.max(terrain, 0))
    out.windX = bx * out.wind
    out.windZ = bz * out.wind

    // Moisture around 0.5, then contrast and overall wetness.
    const patch = getNoise(x, z, patchNoise)
    const raw =
      0.5 -
      MOISTURE.patch * patch +
      MOISTURE.hollow * concavityInfluence * concavity -
      MOISTURE.runoff * slopeInfluence * smoothstep(...MOISTURE.runoffSlope, slope) +
      TRUNK_DAMP.amount * Math.exp(-out.trunkDistance / TRUNK_DAMP.reach) +
      MOISTURE.shade * (out.shade - MOISTURE.shadeMean)
    out.moisture = clamp01(wetness + (raw - 0.5) * contrast)
    return out
  }

  return {
    settings: habitat,
    sun,

    /**
     * The lattice for one tile: { points, spacing, fields: { name:
     * Float32Array(points²) } }, row-major from the tile's corner.
     */
    tileLattice(tileX, tileZ) {
      const wide = POINTS + 2
      const heights = new Float32Array(wide * wide)
      const sample = {}
      for (let row = 0; row < wide; row += 1) {
        for (let column = 0; column < wide; column += 1) {
          // Integer lattice coordinates, so shared edges match exactly.
          sampler.sample((tileX * CELLS + column - 1) * SPACING, (tileZ * CELLS + row - 1) * SPACING, sample)
          heights[row * wide + column] = sample.height - sample.pebbleHeight
        }
      }
      const centerX = (tileX + 0.5) * TILE_SIZE
      const centerZ = (tileZ + 0.5) * TILE_SIZE
      const list = nearTrunks(centerX, centerZ, trunkReach)
      const count = POINTS * POINTS
      const fields = {}
      for (const name of ['moisture', 'sunlight', 'shade', 'slope', 'concavity', 'wind', 'windX', 'windZ']) {
        fields[name] = new Float32Array(count)
      }
      const out = {}
      for (let row = 0; row < POINTS; row += 1) {
        for (let column = 0; column < POINTS; column += 1) {
          const a = (row + 1) * wide + column + 1
          const h = heights[a]
          const dx = (heights[a + 1] - heights[a - 1]) / (2 * SPACING)
          const dz = (heights[a + wide] - heights[a - wide]) / (2 * SPACING)
          const laplacian = (heights[a + 1] + heights[a - 1] + heights[a + wide] + heights[a - wide] - 4 * h) / (SPACING * SPACING)
          const slope = (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI
          const x = (tileX * CELLS + column) * SPACING
          const z = (tileZ * CELLS + row) * SPACING
          fieldsAt(x, z, dx, dz, slope, Math.tanh(laplacian / CONCAVITY_SCALE), list, out)
          const index = row * POINTS + column
          for (const name in fields) fields[name][index] = out[name]
        }
      }
      return { points: POINTS, spacing: SPACING, fields }
    },

    /**
     * Every field at one world point, measured with the same stencil as the
     * lattice (for things decided in world space, like flower colonies that
     * cross tile edges). Also fills hill and pebble from the ground there.
     */
    at(x, z, out) {
      const sample = {}
      const height = (px, pz) => {
        sampler.sample(px, pz, sample)
        return sample.height - sample.pebbleHeight
      }
      const east = height(x + SPACING, z)
      const west = height(x - SPACING, z)
      const north = height(x, z + SPACING)
      const south = height(x, z - SPACING)
      const h = height(x, z)
      const dx = (east - west) / (2 * SPACING)
      const dz = (north - south) / (2 * SPACING)
      const laplacian = (east + west + north + south - 4 * h) / (SPACING * SPACING)
      const slope = (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI
      fieldsAt(x, z, dx, dz, slope, Math.tanh(laplacian / CONCAVITY_SCALE), nearTrunks(x, z, trunkReach), out)
      out.hill = sample.hill
      out.pebble = sample.pebble
      return out
    },

    /**
     * Rough fields for the far ground, from one ground sample there: flat,
     * with concavity guessed from the bump noise (bumps: 0–1, how much of
     * the bumps still shows). Fills { moisture, sunlight, shade }.
     */
    farPoint(x, z, sample, bumps, out) {
      const list = nearTrunks(x, z, Math.max(shadowLength, 1))
      return fieldsAt(x, z, 0, 0, 0, -sample.bump * bumps, list, out)
    },
  }
}

/**
 * Write the habitat fields into tile data (terrain/tileData.js), on its own
 * grid: moisture, sunlight, shade, habitatSlope, concavity, wind, windX,
 * windZ. Called when a tile is built and again when the habitat changes.
 */
export function applyHabitat(data, field) {
  const { points, spacing, fields } = field.tileLattice(data.tileX, data.tileZ)
  const { n, step } = data
  const count = n * n
  const target = {
    moisture: 'moisture',
    sunlight: 'sunlight',
    shade: 'shade',
    slope: 'habitatSlope',
    concavity: 'concavity',
    wind: 'wind',
    windX: 'windX',
    windZ: 'windZ',
  }
  for (const name in target) {
    if (!data[target[name]] || data[target[name]].length !== count) data[target[name]] = new Float32Array(count)
  }
  for (let row = 0; row < n; row += 1) {
    const gz = Math.min((row * step) / spacing, points - 1)
    const r = Math.min(Math.floor(gz), points - 2)
    const fz = gz - r
    for (let column = 0; column < n; column += 1) {
      const gx = Math.min((column * step) / spacing, points - 1)
      const c = Math.min(Math.floor(gx), points - 2)
      const fx = gx - c
      const i = r * points + c
      const index = row * n + column
      for (const name in target) {
        const f = fields[name]
        const top = f[i] + (f[i + 1] - f[i]) * fx
        const bottom = f[i + points] + (f[i + points + 1] - f[i + points]) * fx
        data[target[name]][index] = top + (bottom - top) * fz
      }
    }
  }
  return data
}
