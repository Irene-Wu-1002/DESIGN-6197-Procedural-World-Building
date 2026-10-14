import { applyHabitat } from '../habitat/habitatFields'
import { TILE_SIZE } from './heightField'

/**
 * One terrain tile's data: heights on a (segments + 1)² grid plus the maps
 * derived from them, and a smooth version of the surface (smoothHeight,
 * smoothNormal) that the tile morphs into with distance (see
 * groundMaterial.js). Heights are sampled with a one-point apron around the
 * tile, so normals and slope at the edges use the neighbours'
 * real ground and the shading is seamless across tiles.
 *
 * Moisture, sunlight, shade, wind and the other habitat fields come from
 * habitat/habitatFields.js (applyHabitat), so they can be redone without
 * rebuilding the tile's shape.
 *
 * Plain data only, no Three.js.
 */

// How far around a tile to look for trunks (beyond this they don't matter).
const TRUNK_REACH = 3

export function tileKey(tileX, tileZ) {
  return `${tileX},${tileZ}`
}

/**
 * The smooth ground (the 30 cm slopes + ant hill) from a sampler result:
 * what distant tiles morph into and what the far ground is built from. It
 * changes slowly enough for the coarse far-ground mesh to follow closely.
 */
export function smoothHeightOf(sample) {
  return sample.broadLowHeight + sample.hillHeight
}

/**
 * trunks: the trunk field (cover/trunks.js) or null. Adds per point
 * trunkDistance (m to the nearest bark) and litter (0–1) for ground cover.
 * habitat: the habitat field (habitat/habitatFields.js) for moisture etc.
 * pebbles: false leaves the pebble domes out of the height (middle-ring
 * tiles, whose coarse grid can't draw them); their coverage and shade are
 * kept, so pebble colour and the cover rules stay the same.
 */
export function buildTileData(sampler, tileX, tileZ, segments, trunks, habitat, { pebbles = true } = {}) {
  const n = segments + 1
  const step = TILE_SIZE / segments
  const wide = n + 2
  const x0 = tileX * TILE_SIZE
  const z0 = tileZ * TILE_SIZE
  // Only a handful of trunks can matter for one tile; check those directly.
  const nearTrunks = trunks
    ? trunks.trunksNear(x0 + TILE_SIZE / 2, z0 + TILE_SIZE / 2, TRUNK_REACH + TILE_SIZE)
    : []
  const trunkDistanceAt = (x, z) => {
    let best = TRUNK_REACH
    for (const trunk of nearTrunks) {
      best = Math.min(best, Math.max(Math.hypot(trunk.x - x, trunk.z - z) - trunk.radius, 0))
    }
    return best
  }
  const apron = new Float32Array(wide * wide)
  // The smooth surface (broad slopes + ant hill, no bumps or pebbles) that
  // far-away tiles morph into, matching the far ground.
  const smoothApron = new Float32Array(wide * wide)
  const count = n * n
  const height = new Float32Array(count)
  const pebble = new Float32Array(count)
  const pebbleShade = new Float32Array(count)
  const hill = new Float32Array(count)
  const litter = new Float32Array(count)
  const trailTone = new Float32Array(count)
  const trunkDistance = new Float32Array(count)
  const out = {}

  for (let row = 0; row < wide; row += 1) {
    for (let column = 0; column < wide; column += 1) {
      const x = x0 + (column - 1) * step
      const z = z0 + (row - 1) * step
      sampler.sample(x, z, out)
      apron[row * wide + column] = pebbles ? out.height : out.height - out.pebbleHeight
      smoothApron[row * wide + column] = smoothHeightOf(out)
      const inside = row > 0 && column > 0 && row < wide - 1 && column < wide - 1
      if (!inside) continue
      const index = (row - 1) * n + (column - 1)
      height[index] = apron[row * wide + column]
      pebble[index] = out.pebble
      pebbleShade[index] = out.shade
      hill[index] = out.hill
      litter[index] = out.litter
      trailTone[index] = out.trailTone
      trunkDistance[index] = trunkDistanceAt(x, z)
    }
  }

  const normal = new Float32Array(count * 3)
  const smoothHeight = new Float32Array(count)
  const smoothNormal = new Float32Array(count * 3)
  const slope = new Float32Array(count)
  // Normal from the apron neighbours; returns the slope gradient length.
  const writeNormal = (field, a, target, index) => {
    const dx = (field[a + 1] - field[a - 1]) / (2 * step)
    const dz = (field[a + wide] - field[a - wide]) / (2 * step)
    const length = Math.hypot(dx, 1, dz)
    target[index * 3] = -dx / length
    target[index * 3 + 1] = 1 / length
    target[index * 3 + 2] = -dz / length
    return Math.hypot(dx, dz)
  }
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const a = (row + 1) * wide + (column + 1)
      const index = row * n + column
      const gradient = writeNormal(apron, a, normal, index)
      writeNormal(smoothApron, a, smoothNormal, index)
      smoothHeight[index] = smoothApron[a]
      slope[index] = (Math.atan(gradient) * 180) / Math.PI
    }
  }

  const data = {
    tileX,
    tileZ,
    segments,
    // false for a middle-ring tile (no pebble shapes, thinner ground cover).
    pebbles,
    n,
    step,
    height,
    normal,
    smoothHeight,
    smoothNormal,
    slope,
    pebble,
    pebbleShade,
    hill,
    litter,
    trailTone,
    trunkDistance,
  }
  return applyHabitat(data, habitat)
}

/**
 * A coarser copy of tile data for drawing: every `factor`-th sample in each
 * direction. Middle-ring tiles scatter their cover from the full data (so
 * placement agrees with the near ring) but draw this lighter mesh.
 */
export function decimateTileData(data, factor) {
  const n = (data.n - 1) / factor + 1
  const pick = (field, stride = 1) => {
    const out = new Float32Array(n * n * stride)
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const from = (row * factor * data.n + column * factor) * stride
        const to = (row * n + column) * stride
        for (let k = 0; k < stride; k += 1) out[to + k] = field[from + k]
      }
    }
    return out
  }
  return {
    ...data,
    segments: data.segments / factor,
    n,
    step: data.step * factor,
    height: pick(data.height),
    normal: pick(data.normal, 3),
    smoothHeight: pick(data.smoothHeight),
    smoothNormal: pick(data.smoothNormal, 3),
    slope: pick(data.slope),
    pebble: pick(data.pebble),
    pebbleShade: pick(data.pebbleShade),
    hill: pick(data.hill),
    litter: pick(data.litter),
    trailTone: pick(data.trailTone),
    trunkDistance: pick(data.trunkDistance),
    ...pickHabitat(data, pick),
  }
}

const HABITAT_ARRAYS = ['moisture', 'sunlight', 'shade', 'habitatSlope', 'concavity', 'wind', 'windX', 'windZ']

/** The habitat arrays of a tile, each passed through pick (e.g. decimated). */
function pickHabitat(data, pick) {
  return Object.fromEntries(HABITAT_ARRAYS.map((name) => [name, pick(data[name])]))
}

// Colours as linear RGB (0–1), matching three.js's working colour space.
const srgbToLinear = (value) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
const hex = (code) => {
  const value = parseInt(code.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => srgbToLinear(c / 255))
}

export const GROUND_COLORS = {
  soil: hex('#5b4331'),
  damp: hex('#2c2119'),
  sand: hex('#b39871'),
  hill: hex('#7b4b33'),
  pebbleLight: hex('#99928a'),
  pebbleDark: hex('#5f5a53'),
  // Rotting leaf litter: the soil tint where fallen leaves gather.
  litter: hex('#5e3d1f'),
  // Ant trail: packed, darker soil.
  trail: hex('#2e2219'),
}

const PREVIEW = {
  height: [hex('#13202c'), hex('#f2efe8')],
  slope: [hex('#2f6b3a'), hex('#d9483b')],
  moisture: [hex('#c9a35f'), hex('#1f63b8')],
  sunlight: [hex('#1d2433'), hex('#f5d36b')],
  shade: [hex('#e8e2c8'), hex('#14261a')],
  // Ridges warm, flat grey, hollows blue.
  concavity: [hex('#d9853b'), hex('#6f6a64'), hex('#2f6fb8')],
  windCalm: hex('#151a22'),
  // Exclusion zones: inside (no cover), and the soft edge (small cover fades).
  zone: hex('#b3261e'),
  softEdge: hex('#f0a020'),
}
const HEIGHT_RANGE = [-0.03, 0.05]
const SLOPE_RANGE = 60

const mix = (a, b, t, out) => {
  out[0] = a[0] + (b[0] - a[0]) * t
  out[1] = a[1] + (b[1] - a[1]) * t
  out[2] = a[2] + (b[2] - a[2]) * t
  return out
}
const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * Soil colour (linear RGB into `out`): damp soil in hollows, dry sand where
 * it's driest, reddish fine soil on the ant hill, packed dark soil on the
 * ant trail (trailTone 0–1).
 */
export function soilColor(moisture, hill, out, litter = 0, trailTone = 0) {
  mix(GROUND_COLORS.soil, GROUND_COLORS.damp, smoothstep(0.55, 0.75, moisture), out)
  mix(out, GROUND_COLORS.sand, 0.6 * smoothstep(0.42, 0.28, moisture), out)
  // Leaf litter darkens and warms the soil where leaves gather.
  mix(out, GROUND_COLORS.litter, 0.45 * smoothstep(0.45, 0.8, litter), out)
  mix(out, GROUND_COLORS.hill, 0.85 * hill, out)
  mix(out, GROUND_COLORS.trail, Math.min(trailTone, 1), out)
  return out
}

/**
 * Write a colour per grid point into `colors` (n² × 3, linear RGB).
 * mode: off | height | tiles, or a habitat field: moisture | sunlight |
 * shade | slope | concavity | wind (hue = direction, brightness = speed),
 * or exclusion (zones over the natural ground; needs `exclusions`, see
 * paths/exclusionZones.js)
 */
export function colorTile(data, mode, colors, exclusions = null) {
  const { n } = data
  const c = [0, 0, 0]
  const pebbleColor = [0, 0, 0]
  const checker = (data.tileX + data.tileZ) % 2 === 0
  for (let index = 0; index < n * n; index += 1) {
    if (mode === 'height') {
      const t = (data.height[index] - HEIGHT_RANGE[0]) / (HEIGHT_RANGE[1] - HEIGHT_RANGE[0])
      mix(PREVIEW.height[0], PREVIEW.height[1], Math.min(Math.max(t, 0), 1), c)
    } else if (mode === 'slope') {
      mix(PREVIEW.slope[0], PREVIEW.slope[1], Math.min(data.habitatSlope[index] / SLOPE_RANGE, 1), c)
    } else if (mode === 'moisture' || mode === 'sunlight' || mode === 'shade') {
      mix(PREVIEW[mode][0], PREVIEW[mode][1], data[mode][index], c)
    } else if (mode === 'concavity') {
      const value = data.concavity[index]
      const [ridge, flat, hollow] = PREVIEW.concavity
      mix(flat, value < 0 ? ridge : hollow, Math.min(Math.abs(value), 1), c)
    } else if (mode === 'wind') {
      // A colour wheel for the direction the wind blows toward.
      const angle = Math.atan2(data.windX[index], data.windZ[index])
      for (let k = 0; k < 3; k += 1) c[k] = 0.15 + 0.85 * (0.5 + 0.5 * Math.cos(angle - (k * 2 * Math.PI) / 3))
      mix(PREVIEW.windCalm, c, Math.min(data.wind[index] * 1.5, 1), c)
    } else {
      // Natural ground, with pebbles on top.
      soilColor(data.moisture[index], data.hill[index], c, data.litter[index], data.trailTone[index])
      if (data.pebble[index] > 0) {
        mix(GROUND_COLORS.pebbleDark, GROUND_COLORS.pebbleLight, data.pebbleShade[index], pebbleColor)
        mix(c, pebbleColor, data.pebble[index], c)
      }
      if (mode === 'exclusion' && exclusions) {
        const x = data.tileX * TILE_SIZE + (index % n) * data.step
        const z = data.tileZ * TILE_SIZE + Math.floor(index / n) * data.step
        const d = exclusions.distance(x, z)
        if (d < 0) mix(c, PREVIEW.zone, 0.75, c)
        else mix(c, PREVIEW.softEdge, 0.7 * (1 - exclusions.fade(d)), c)
      }
      if (mode === 'tiles') {
        const row = Math.floor(index / n)
        const column = index % n
        const edge = row < 2 || column < 2 || row > n - 3 || column > n - 3
        const dim = edge ? 0.25 : checker ? 1 : 0.7
        c[0] *= dim
        c[1] *= dim
        c[2] *= dim
      }
    }
    colors[index * 3] = c[0]
    colors[index * 3 + 1] = c[1]
    colors[index * 3 + 2] = c[2]
  }
  return colors
}
