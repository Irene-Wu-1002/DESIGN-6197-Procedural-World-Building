import { clusterDensity, createRandom, distributePoints } from './distributions'

/**
 * Week 5 scattering: place layers of assets on the noise terrain.
 *
 * Every layer follows the same protocol, checked in this order:
 *   1. Underwater   – nothing below the water line unless allowed (and shallow)
 *   2. Surface      – grass, rock, or any (follows the ground colours)
 *   3. Max slope    – extra strictness on top of the surface
 *   4. Height band  – lowland / highland only
 *   5. Cliff buffer – stay this many metres from any cliff
 *   6. Water        – avoid: at least N m from shore; near: at most N m
 * then the placement checks: grouping (groves or scattered), spacing within
 * the layer, and no overlap with any other layer.
 *
 * Plain data only, no Three.js, so the Map tab can reuse it later.
 */

// Fixed shape data. footprint: ground radius kept free of other layers.
// reach: visible radius (keeps the shape on the field). sink: how far the
// base is pushed into the ground, as a share of height.
export const SCATTER_LAYERS = [
  {
    id: 'windmill',
    label: 'Windmills',
    isCount: true,
    maxCount: 6,
    baseSpacing: 1,
    footprint: 2.5,
    reach: 2.0,
    scale: [0.9, 1.1],
    sink: 0.1,
  },
  {
    id: 'rock',
    label: 'Rocks',
    maxCount: 300,
    baseSpacing: 1.2,
    footprint: 0.35,
    reach: 0.75,
    scale: [0.6, 2.4],
    sink: 0.3,
    alignToSurface: true,
  },
  {
    id: 'pine',
    label: 'Pine trees',
    maxCount: 800,
    baseSpacing: 1.3,
    footprint: 0.45,
    reach: 0.8,
    scale: [0.75, 1.35],
    sink: 0.1,
  },
  {
    id: 'round',
    label: 'Round trees',
    maxCount: 600,
    baseSpacing: 1.5,
    footprint: 0.55,
    reach: 0.9,
    scale: [0.75, 1.2],
    sink: 0.1,
  },
  {
    id: 'bush',
    label: 'Bushes',
    maxCount: 1500,
    baseSpacing: 1.0,
    footprint: 0.35,
    reach: 0.65,
    scale: [0.7, 1.4],
    sink: 0.15,
  },
]

// How strongly terrain data shapes each instance (all in %). 0 = off,
// 100 = as designed, 200 = exaggerated. randomness = plain per-instance noise.
const DEFAULT_RESPONSE = {
  sizeResponse: 100,
  colorResponse: 100,
  densityResponse: 100,
  randomness: 30,
}

// Editable protocol per layer. amount: count for windmills, density % otherwise.
export const DEFAULT_LAYER_RULES = {
  windmill: {
    on: true,
    amount: 3,
    surface: 'grass',
    maxSlope: 10,
    heightMin: 55,
    heightMax: 100,
    cliffBuffer: 2,
    water: 'avoid',
    waterDistance: 4,
    underwater: false,
    spacing: 12,
    grouping: 'scattered',
    clumping: 4,
    ...DEFAULT_RESPONSE,
  },
  rock: {
    on: true,
    amount: 40,
    surface: 'rock',
    maxSlope: 90,
    heightMin: 0,
    heightMax: 100,
    cliffBuffer: 0,
    water: 'ignore',
    waterDistance: 0,
    underwater: true,
    spacing: 1.2,
    grouping: 'scattered',
    clumping: 4,
    ...DEFAULT_RESPONSE,
  },
  pine: {
    on: true,
    amount: 60,
    surface: 'grass',
    maxSlope: 30,
    heightMin: 30,
    heightMax: 100,
    cliffBuffer: 0.5,
    water: 'avoid',
    waterDistance: 1.5,
    underwater: false,
    spacing: 1.3,
    grouping: 'groves',
    clumping: 4,
    ...DEFAULT_RESPONSE,
  },
  round: {
    on: true,
    amount: 50,
    surface: 'grass',
    maxSlope: 25,
    heightMin: 0,
    heightMax: 70,
    cliffBuffer: 1,
    water: 'avoid',
    waterDistance: 0.5,
    underwater: false,
    spacing: 1.5,
    grouping: 'groves',
    clumping: 4,
    ...DEFAULT_RESPONSE,
  },
  bush: {
    on: true,
    amount: 50,
    surface: 'any',
    maxSlope: 35,
    heightMin: 0,
    heightMax: 100,
    cliffBuffer: 0,
    water: 'near',
    waterDistance: 6,
    underwater: false,
    spacing: 1.0,
    grouping: 'groves',
    clumping: 4,
    ...DEFAULT_RESPONSE,
  },
}

// Rocks spill a little onto the grass border so slopes don't end abruptly.
const ROCK_SURFACE_MARGIN = 5
// Deepest water an "underwater" asset may stand in, in metres.
export const MAX_UNDERWATER_DEPTH = 0.5
// Soft edge of a grove in noise units, so forests fade out instead of stopping.
const CLUSTER_EDGE = 0.08
const HASH_CELL = 2
// Terrain size response can grow an instance up to ~3× (at 200%), so the
// overlap search reaches that far.
const MAX_SIZE_GROWTH = 3
const MAX_FOOTPRINT =
  MAX_SIZE_GROWTH *
  Math.max(...SCATTER_LAYERS.map((layer) => layer.footprint * layer.scale[1]))

/**
 * The protocol check, shared by placement and the rule preview.
 * sample comes from terrainFields.sample(); fields gives water and rock slope.
 */
export function passesRules(rules, sample, fields) {
  if (sample.depth > 0) {
    if (!rules.underwater || sample.depth > MAX_UNDERWATER_DEPTH) return false
  }
  if (rules.surface === 'grass' && sample.slope > fields.rockSlope) return false
  if (rules.surface === 'rock' && sample.slope < fields.rockSlope - ROCK_SURFACE_MARGIN) {
    return false
  }
  if (sample.slope > rules.maxSlope) return false
  const level = sample.level * 100
  if (level < rules.heightMin || level > rules.heightMax) return false
  if (rules.cliffBuffer > 0 && sample.cliffDistance < rules.cliffBuffer) return false
  // Without water the water rules have nothing to measure, so they switch off.
  if (fields.hasWater) {
    if (rules.water === 'avoid' && sample.waterDistance < rules.waterDistance) return false
    if (rules.water === 'near' && sample.waterDistance > rules.waterDistance) return false
  }
  return true
}

// Spatial hash of placed circles, so overlap checks stay fast.
function createOccupancy(maxRadius) {
  const cells = new Map()
  const key = (column, row) => `${column},${row}`

  return {
    isFree(x, z, radius) {
      const column = Math.floor(x / HASH_CELL)
      const row = Math.floor(z / HASH_CELL)
      const steps = Math.ceil((radius + maxRadius) / HASH_CELL)
      for (let y = row - steps; y <= row + steps; y += 1) {
        for (let c = column - steps; c <= column + steps; c += 1) {
          const bucket = cells.get(key(c, y))
          if (!bucket) continue
          for (const other of bucket) {
            const limit = radius + other.radius
            if ((other.x - x) ** 2 + (other.z - z) ** 2 < limit * limit) return false
          }
        }
      }
      return true
    },
    add(x, z, radius) {
      const id = key(Math.floor(x / HASH_CELL), Math.floor(z / HASH_CELL))
      if (!cells.has(id)) cells.set(id, [])
      cells.get(id).push({ x, z, radius })
    },
  }
}

function shuffle(items, random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[items[index], items[swap]] = [items[swap], items[index]]
  }
  return items
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

const clamp01 = (value) => Math.min(Math.max(value, 0), 1)
// 1 right at a feature, fading to 0 over roughly `reach` metres.
const nearness = (distance, reach) => Math.exp(-Math.max(distance, 0) / reach)
// 1 on bone-dry ground, 0 once moisture reaches about 0.5.
const dryness = (moisture) => 1 - smoothstep(0.15, 0.5, moisture)
const LEAN_MAX_DEGREES = 6
const MIN_SIZE_FACTOR = 0.35

/**
 * Terrain response per layer: how terrain data reshapes each instance.
 * t holds 0–1 terrain readings at the spot (see terrainReadings).
 * Each value is a delta, scaled by the layer's response sliders:
 *   size    → scale × (1 + size)
 *   width   → foliage width × (1 + width)
 *   color   → hue / saturation / lightness offsets for foliage or stone
 *   moss    → how far stone is tinted toward moss green
 *   flatten → squash height (and widen) – worn rocks by the water
 *   density → keep chance × (1 + density); only ever thins
 *   lean    → lean a little downhill on slopes
 */
const RESPONSES = {
  pine: (t) => ({
    // Big where moist; stunted toward the treeline and next to cliffs.
    size: 0.35 * (t.moisture - 0.5) - 0.45 * smoothstep(0.6, 1, t.level) - 0.25 * t.cliffNear,
    // Narrow and tall deep in a grove, wider at the edge.
    width: 0.35 * (0.5 - t.grove),
    // Moist: deep blue-green. Dry or high: yellow-olive. Sun: a little lighter.
    color: {
      h: 0.05 * (t.moisture - 0.5) - 0.04 * t.level,
      s: 0.12 * (t.moisture - 0.5) - 0.1 * t.level,
      l: -0.05 * (t.moisture - 0.5) + 0.06 * (t.sun - 0.6),
    },
    // Soft treeline over the top of the height range.
    density: -0.9 * smoothstep(0.8, 1, t.level),
    lean: true,
  }),
  round: (t) => ({
    size: 0.4 * (t.moisture - 0.5) - 0.3 * t.steepness,
    width: 0.4 * (0.5 - t.grove),
    color: {
      h: 0.06 * (t.moisture - 0.5),
      s: 0.15 * (t.moisture - 0.5),
      l: 0.08 * (t.sun - 0.6),
    },
    // Only dry ground thins them out.
    density: -0.7 * dryness(t.moisture),
    lean: true,
  }),
  bush: (t) => ({
    // Largest and darkest at the shore.
    size: 0.5 * (t.moisture - 0.5),
    width: 0.15 * (t.moisture - 0.5),
    color: {
      h: 0.05 * (t.moisture - 0.5),
      s: 0.1 * (t.moisture - 0.5),
      l: -0.06 * (t.moisture - 0.5),
    },
    density: -0.7 * dryness(t.moisture),
  }),
  rock: (t) => ({
    // Boulders on steep ground and below cliffs; small worn pebbles by water.
    // Centered on typical rock ground, so only unusually steep spots grow.
    size: 0.6 * (t.steepness - 0.75) + 0.4 * (t.cliffNear - 0.4) - 0.6 * t.wet,
    flatten: 0.35 * t.wet,
    // Wet rock is darker; high rock is paler; shaded damp rock grows moss.
    color: { h: 0, s: 0, l: -0.15 * t.wet + 0.1 * (t.level - 0.5) },
    moss: clamp01(t.moisture * (1 - t.sun) * 2 - 0.2),
  }),
  windmill: () => ({}),
}

// 0–1 terrain readings that the responses use.
function terrainReadings(sample, fields, grove) {
  let wet = 0
  if (fields.hasWater) wet = sample.depth > 0 ? 1 : nearness(sample.waterDistance, 1.5)
  return {
    moisture: sample.moisture,
    sun: sample.sun,
    level: sample.level,
    steepness: Math.min(sample.slope / 45, 1),
    cliffNear: nearness(sample.cliffDistance, 2),
    wet,
    grove,
  }
}

// Tilt "up" part of the way toward the surface normal, at most LEAN_MAX_DEGREES.
function leanVector(sample, strength) {
  if (sample.slope < 0.5 || strength <= 0) return [0, 1, 0]
  const angle = LEAN_MAX_DEGREES * Math.min(sample.slope / 30, 1) * strength
  const amount = Math.min(angle / sample.slope, 1)
  const [nx, ny, nz] = sample.normal
  const x = nx * amount
  const y = 1 + (ny - 1) * amount
  const z = nz * amount
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}

/**
 * Returns { [layerId]: [item] } where each item is
 *   { x, y, z, rotationY, scale: [sx, sy, sz], normal, shade,
 *     foliageWidth, color: { h, s, l }, moss, windSpeed }.
 * windDirection (degrees) is the way the windmills face.
 */
export function scatterLayers({ fields, seed, rules: allRules, windDirection = 0 }) {
  const size = fields.size
  const occupancy = createOccupancy(MAX_FOOTPRINT)
  const result = {}

  SCATTER_LAYERS.forEach((layer, layerIndex) => {
    const rules = allRules[layer.id]
    // Windmills: amount is a count. Groves: amount is how much of the land
    // the groves cover. Scattered: amount is the chance to keep a point.
    const target = rules.on ? (layer.isCount ? rules.amount : layer.maxCount) : 0
    const density = layer.isCount ? 1 : rules.amount / 100
    const placed = []
    result[layer.id] = placed
    if (target === 0 || density === 0) return

    const layerSeed = seed * 7919 + layerIndex * 1013
    const random = createRandom(layerSeed + 1)
    const candidates = shuffle(
      distributePoints({
        method: 'poisson',
        count: 20000,
        size,
        seed: layerSeed,
        minDistance: Math.min(layer.baseSpacing, rules.spacing),
      }),
      random
    )
    const sameLayer = createOccupancy(rules.spacing / 2)
    const threshold = 1 - density
    const respond = RESPONSES[layer.id]
    const sizeStrength = rules.sizeResponse / 100
    const colorStrength = rules.colorResponse / 100
    const densityStrength = rules.densityResponse / 100
    const randomness = rules.randomness / 100
    const windRadians = (windDirection * Math.PI) / 180

    for (const point of candidates) {
      if (placed.length >= target) break
      // Grove value: 1 deep inside a grove, 0 outside; 0.5 when scattered.
      let grove = 0.5
      if (rules.grouping === 'groves') {
        grove = clusterDensity(point.x, point.y, size, rules.clumping, layerSeed)
        const keep = smoothstep(threshold - CLUSTER_EDGE, threshold + CLUSTER_EDGE, grove)
        if (density < 1 && random() >= keep) continue
      } else if (random() >= density) {
        continue
      }

      const x = point.x - size / 2
      const z = point.y - size / 2
      const sample = fields.sample(x, z)
      if (!passesRules(rules, sample, fields)) continue

      const response = respond(terrainReadings(sample, fields, grove))
      const thinning = clamp01(1 + densityStrength * (response.density ?? 0))
      if (thinning < 1 && random() >= thinning) continue

      // Random size around the middle of the range (randomness = how far it
      // strays), then grown or shrunk by the terrain.
      const middle = (layer.scale[0] + layer.scale[1]) / 2
      const spread = (layer.scale[1] - layer.scale[0]) * randomness
      const sizeFactor = Math.min(
        Math.max(1 + sizeStrength * (response.size ?? 0), MIN_SIZE_FACTOR),
        MAX_SIZE_GROWTH
      )
      const scale = (middle + (random() - 0.5) * spread) * sizeFactor
      const radius = layer.footprint * scale
      // Keep the visible shape on the field so nothing hangs over the edge.
      if (Math.max(Math.abs(x), Math.abs(z)) > size / 2 - layer.reach * scale) continue
      if (!occupancy.isFree(x, z, radius)) continue
      if (!sameLayer.isFree(x, z, rules.spacing / 2)) continue

      occupancy.add(x, z, radius)
      sameLayer.add(x, z, rules.spacing / 2)
      // Rocks get an uneven, squashed scale; everything else scales evenly.
      const scaleXYZ = layer.alignToSurface
        ? [scale * (0.8 + random() * 0.4), scale * (0.5 + random() * 0.3), scale * (0.8 + random() * 0.4)]
        : [scale, scale, scale]
      const flatten = sizeStrength * (response.flatten ?? 0)
      if (flatten > 0) {
        scaleXYZ[0] *= 1 + flatten * 0.5
        scaleXYZ[1] *= Math.max(1 - flatten, 0.3)
        scaleXYZ[2] *= 1 + flatten * 0.5
      }

      // Windmills face the shared wind with a little jitter; the rest spin freely.
      const spin = random()
      const rotationY =
        layer.id === 'windmill' ? windRadians + (spin - 0.5) * 0.28 : spin * Math.PI * 2

      let normal = [0, 1, 0]
      if (layer.alignToSurface) normal = sample.normal
      else if (response.lean) normal = leanVector(sample, sizeStrength)

      const color = response.color ?? { h: 0, s: 0, l: 0 }
      placed.push({
        x,
        y: sample.y - layer.sink * scaleXYZ[1],
        z,
        rotationY,
        scale: scaleXYZ,
        normal,
        // Random light/dark jitter, shrunk toward 0.5 as randomness drops.
        shade: 0.5 + (random() - 0.5) * randomness,
        foliageWidth: Math.max(1 + sizeStrength * (response.width ?? 0), 0.5),
        color: {
          h: color.h * colorStrength,
          s: color.s * colorStrength,
          l: color.l * colorStrength,
        },
        moss: clamp01((response.moss ?? 0) * colorStrength),
        // Higher windmills catch more wind.
        windSpeed: 0.6 + 1.4 * sample.level,
      })
    }
  })

  return result
}
