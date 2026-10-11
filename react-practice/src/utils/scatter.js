import { getNoise } from './noise'
import { clusterDensity, createRandom, distributePoints } from './distributions'

/**
 * Week 5 scattering: place several asset types on a noise terrain.
 *
 * Pipeline per asset (in priority order):
 *   distribution method → terrain sample (height, slope) → filters
 *   → no-overlap check → transform (position, rotation, scale, tint)
 *
 * Plain data only, no Three.js, so the Map tab can reuse it later.
 */

// slope(rockSlope) returns the allowed [min, max] slope in degrees.
// height is the allowed range of normalized height (0 = lowest, 1 = highest).
// footprint: ground radius kept free of other assets. reach: visible radius.
export const SCATTER_ASSETS = [
  {
    id: 'windmill',
    label: 'Windmills',
    method: 'random',
    candidates: 3000,
    maxCount: 6,
    selfSpacing: 12,
    footprint: 2.5,
    reach: 2.0,
    slope: () => [0, 10],
    height: [0.65, 1],
    scale: [0.9, 1.1],
    sink: 0.1,
  },
  {
    id: 'rock',
    label: 'Rocks',
    method: 'poisson',
    spacing: 1.2,
    candidates: 5000,
    maxCount: 300,
    footprint: 0.35,
    reach: 0.75,
    slope: (rockSlope) => [rockSlope - 5, 90],
    height: [0, 1],
    scale: [0.6, 2.4],
    sink: 0.3,
    alignToSurface: true,
  },
  {
    id: 'pine',
    label: 'Pine trees',
    method: 'poisson',
    clustered: true,
    spacing: 1.3,
    candidates: 20000,
    maxCount: 800,
    footprint: 0.45,
    reach: 0.8,
    slope: (rockSlope) => [0, rockSlope],
    height: [0.3, 1],
    scale: [0.75, 1.35],
    sink: 0.1,
  },
  {
    id: 'round',
    label: 'Round trees',
    method: 'poisson',
    clustered: true,
    spacing: 1.5,
    candidates: 20000,
    maxCount: 600,
    footprint: 0.55,
    reach: 0.9,
    slope: (rockSlope) => [0, rockSlope],
    height: [0, 0.7],
    scale: [0.75, 1.2],
    sink: 0.1,
  },
  {
    id: 'bush',
    label: 'Bushes',
    method: 'poisson',
    clustered: true,
    spacing: 1.0,
    candidates: 20000,
    maxCount: 1500,
    footprint: 0.35,
    reach: 0.65,
    slope: (rockSlope) => [0, rockSlope + 5],
    height: [0, 1],
    scale: [0.7, 1.4],
    sink: 0.15,
  },
]

const SLOPE_STEP = 0.2
// Soft edge of a grove in noise units, so forests fade out instead of stopping.
const CLUSTER_EDGE = 0.08
const HASH_CELL = 2
const MAX_FOOTPRINT = Math.max(
  ...SCATTER_ASSETS.map((asset) => asset.footprint * asset.scale[1])
)

export function createTerrainSampler({ size, height, noise }) {
  const sampleHeight = (x, z) => getNoise(x, z, noise) * height

  // Coarse pass to find the lowest and highest point for normalized height.
  let min = Infinity
  let max = -Infinity
  const steps = 80
  for (let row = 0; row <= steps; row += 1) {
    for (let column = 0; column <= steps; column += 1) {
      const value = sampleHeight(
        -size / 2 + (column / steps) * size,
        -size / 2 + (row / steps) * size
      )
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
  }
  const range = Math.max(max - min, 1e-6)

  return (x, z) => {
    const y = sampleHeight(x, z)
    const dx = (sampleHeight(x + SLOPE_STEP, z) - sampleHeight(x - SLOPE_STEP, z)) / (2 * SLOPE_STEP)
    const dz = (sampleHeight(x, z + SLOPE_STEP) - sampleHeight(x, z - SLOPE_STEP)) / (2 * SLOPE_STEP)
    const length = Math.hypot(dx, 1, dz)
    return {
      y,
      level: (y - min) / range,
      slope: (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI,
      normal: [-dx / length, 1 / length, -dz / length],
    }
  }
}

// Spatial hash of placed footprints, so overlap checks stay fast.
function createOccupancy() {
  const cells = new Map()
  const key = (column, row) => `${column},${row}`
  const reach = (radius) => Math.ceil((radius + MAX_FOOTPRINT) / HASH_CELL)

  return {
    isFree(x, z, radius) {
      const column = Math.floor(x / HASH_CELL)
      const row = Math.floor(z / HASH_CELL)
      const steps = reach(radius)
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

const between = (value, [min, max]) => value >= min && value <= max

function smoothstep(edge0, edge1, value) {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * Returns { [assetId]: [{ x, y, z, rotationY, scale: [sx, sy, sz], normal, shade }] }.
 */
export function scatterAssets({ size, sampleTerrain, rockSlope, seed, clumping, settings }) {
  const occupancy = createOccupancy()
  const result = {}

  SCATTER_ASSETS.forEach((asset, assetIndex) => {
    const { on, amount } = settings[asset.id]
    // Windmills: amount is a count. Clustered assets: amount is how much of
    // the land the groves cover. Others: amount is the chance to keep a point.
    const isCount = asset.id === 'windmill'
    const target = on ? (isCount ? amount : asset.maxCount) : 0
    const density = isCount ? 1 : amount / 100
    const placed = []
    result[asset.id] = placed
    if (target === 0 || density === 0) return

    const assetSeed = seed * 7919 + assetIndex * 1013
    const random = createRandom(assetSeed + 1)
    const candidates = shuffle(
      distributePoints({
        method: asset.method,
        count: asset.candidates,
        size,
        seed: assetSeed,
        minDistance: asset.spacing,
      }),
      random
    )
    const slopeRange = asset.slope(rockSlope)
    const threshold = 1 - density

    for (const point of candidates) {
      if (placed.length >= target) break
      if (asset.clustered) {
        const grove = clusterDensity(point.x, point.y, size, clumping, assetSeed)
        const keep = smoothstep(threshold - CLUSTER_EDGE, threshold + CLUSTER_EDGE, grove)
        if (density < 1 && random() >= keep) continue
      } else if (random() >= density) {
        continue
      }
      const x = point.x - size / 2
      const z = point.y - size / 2
      const terrain = sampleTerrain(x, z)
      if (!between(terrain.slope, slopeRange) || !between(terrain.level, asset.height)) {
        continue
      }

      const scale = asset.scale[0] + random() * (asset.scale[1] - asset.scale[0])
      const radius = asset.footprint * scale
      // Keep the visible shape on the field so nothing hangs over the edge.
      if (Math.max(Math.abs(x), Math.abs(z)) > size / 2 - asset.reach * scale) continue
      if (!occupancy.isFree(x, z, radius)) continue
      if (
        asset.selfSpacing &&
        placed.some((other) => Math.hypot(other.x - x, other.z - z) < asset.selfSpacing)
      ) {
        continue
      }

      occupancy.add(x, z, radius)
      // Rocks get an uneven, squashed scale; everything else scales evenly.
      const scaleXYZ = asset.alignToSurface
        ? [scale * (0.8 + random() * 0.4), scale * (0.5 + random() * 0.3), scale * (0.8 + random() * 0.4)]
        : [scale, scale, scale]
      placed.push({
        x,
        y: terrain.y - asset.sink * scaleXYZ[1],
        z,
        rotationY: random() * Math.PI * 2,
        scale: scaleXYZ,
        normal: asset.alignToSurface ? terrain.normal : [0, 1, 0],
        shade: random(),
      })
    }
  })

  return result
}
