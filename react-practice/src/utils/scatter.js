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
  },
}

// Rocks spill a little onto the grass border so slopes don't end abruptly.
const ROCK_SURFACE_MARGIN = 5
// Deepest water an "underwater" asset may stand in, in metres.
export const MAX_UNDERWATER_DEPTH = 0.5
// Soft edge of a grove in noise units, so forests fade out instead of stopping.
const CLUSTER_EDGE = 0.08
const HASH_CELL = 2
const MAX_FOOTPRINT = Math.max(
  ...SCATTER_LAYERS.map((layer) => layer.footprint * layer.scale[1])
)

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

/**
 * Returns { [layerId]: [{ x, y, z, rotationY, scale: [sx, sy, sz], normal, shade }] }.
 */
export function scatterLayers({ fields, seed, rules: allRules }) {
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

    for (const point of candidates) {
      if (placed.length >= target) break
      if (rules.grouping === 'groves') {
        const grove = clusterDensity(point.x, point.y, size, rules.clumping, layerSeed)
        const keep = smoothstep(threshold - CLUSTER_EDGE, threshold + CLUSTER_EDGE, grove)
        if (density < 1 && random() >= keep) continue
      } else if (random() >= density) {
        continue
      }

      const x = point.x - size / 2
      const z = point.y - size / 2
      const sample = fields.sample(x, z)
      if (!passesRules(rules, sample, fields)) continue

      const scale = layer.scale[0] + random() * (layer.scale[1] - layer.scale[0])
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
      placed.push({
        x,
        y: sample.y - layer.sink * scaleXYZ[1],
        z,
        rotationY: random() * Math.PI * 2,
        scale: scaleXYZ,
        normal: layer.alignToSurface ? sample.normal : [0, 1, 0],
        shade: random(),
      })
    }
  })

  return result
}
