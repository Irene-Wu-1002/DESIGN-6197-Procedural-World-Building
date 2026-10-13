import { TILE_SIZE } from './heightField'

/**
 * One terrain tile's data: heights on a (segments + 1)² grid plus the maps
 * derived from them. Heights are sampled with a one-point apron around the
 * tile, so normals and slope at the edges use the neighbours'
 * real ground and the shading is seamless across tiles.
 *
 * Plain data only, no Three.js.
 */

// Moisture: lower broad ground and hollows are wetter. Hollows come from
// the bump noise (smooth over ~3 cm), not from grid curvature, which picks
// up millimetre detail and would flip between wet and dry every few mm.
const MOISTURE = { base: 0.5, low: 0.35, hollow: 0.3 }

export function tileKey(tileX, tileZ) {
  return `${tileX},${tileZ}`
}

export function buildTileData(sampler, tileX, tileZ, segments) {
  const n = segments + 1
  const step = TILE_SIZE / segments
  const wide = n + 2
  const x0 = tileX * TILE_SIZE
  const z0 = tileZ * TILE_SIZE
  const apron = new Float32Array(wide * wide)
  const count = n * n
  const height = new Float32Array(count)
  const broad = new Float32Array(count)
  const bump = new Float32Array(count)
  const pebble = new Float32Array(count)
  const shade = new Float32Array(count)
  const hill = new Float32Array(count)
  const out = {}

  for (let row = 0; row < wide; row += 1) {
    for (let column = 0; column < wide; column += 1) {
      const x = x0 + (column - 1) * step
      const z = z0 + (row - 1) * step
      sampler.sample(x, z, out)
      apron[row * wide + column] = out.height
      const inside = row > 0 && column > 0 && row < wide - 1 && column < wide - 1
      if (!inside) continue
      const index = (row - 1) * n + (column - 1)
      height[index] = out.height
      broad[index] = out.broad
      bump[index] = out.bump
      pebble[index] = out.pebble
      shade[index] = out.shade
      hill[index] = out.hill
    }
  }

  const normal = new Float32Array(count * 3)
  const slope = new Float32Array(count)
  const moisture = new Float32Array(count)
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const a = (row + 1) * wide + (column + 1)
      const left = apron[a - 1]
      const right = apron[a + 1]
      const up = apron[a - wide]
      const down = apron[a + wide]
      const dx = (right - left) / (2 * step)
      const dz = (down - up) / (2 * step)
      const length = Math.hypot(dx, 1, dz)
      const index = row * n + column
      normal[index * 3] = -dx / length
      normal[index * 3 + 1] = 1 / length
      normal[index * 3 + 2] = -dz / length
      slope[index] = (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI
      moisture[index] = Math.min(
        Math.max(
          MOISTURE.base - MOISTURE.low * broad[index] - MOISTURE.hollow * bump[index],
          0
        ),
        1
      )
    }
  }

  return {
    tileX,
    tileZ,
    segments,
    n,
    step,
    height,
    normal,
    slope,
    moisture,
    pebble,
    shade,
    hill,
  }
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
}

const PREVIEW = {
  height: [hex('#13202c'), hex('#f2efe8')],
  slope: [hex('#2f6b3a'), hex('#d9483b')],
  moisture: [hex('#c9a35f'), hex('#1f63b8')],
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
 * Write a colour per grid point into `colors` (n² × 3, linear RGB).
 * mode: off | height | slope | moisture | tiles
 */
export function colorTile(data, mode, colors) {
  const { n } = data
  const c = [0, 0, 0]
  const pebbleColor = [0, 0, 0]
  const checker = (data.tileX + data.tileZ) % 2 === 0
  for (let index = 0; index < n * n; index += 1) {
    if (mode === 'height') {
      const t = (data.height[index] - HEIGHT_RANGE[0]) / (HEIGHT_RANGE[1] - HEIGHT_RANGE[0])
      mix(PREVIEW.height[0], PREVIEW.height[1], Math.min(Math.max(t, 0), 1), c)
    } else if (mode === 'slope') {
      mix(PREVIEW.slope[0], PREVIEW.slope[1], Math.min(data.slope[index] / SLOPE_RANGE, 1), c)
    } else if (mode === 'moisture') {
      mix(PREVIEW.moisture[0], PREVIEW.moisture[1], data.moisture[index], c)
    } else {
      // Natural ground: damp soil in hollows, dry sand where it's driest,
      // reddish fine soil on the ant hill, pebbles on top.
      const wet = data.moisture[index]
      mix(GROUND_COLORS.soil, GROUND_COLORS.damp, smoothstep(0.55, 0.75, wet), c)
      mix(c, GROUND_COLORS.sand, 0.6 * smoothstep(0.42, 0.28, wet), c)
      mix(c, GROUND_COLORS.hill, 0.85 * data.hill[index], c)
      if (data.pebble[index] > 0) {
        mix(GROUND_COLORS.pebbleDark, GROUND_COLORS.pebbleLight, data.shade[index], pebbleColor)
        mix(c, pebbleColor, data.pebble[index], c)
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
