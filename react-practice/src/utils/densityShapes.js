import { getNoise } from './noise'

/**
 * Signed density fields for voxel carving.
 * Positive = solid, negative = empty (after threshold).
 * Coordinates are normalized to roughly -1..1.
 */

export const DENSITY_SHAPES = [
  { id: 'terrain', label: 'Noise Terrain' },
  { id: 'sphere', label: 'Sphere' },
  { id: 'box', label: 'Box' },
  { id: 'cylinder', label: 'Cylinder' },
  { id: 'torus', label: 'Torus' },
  { id: 'cross', label: 'Cross' },
  { id: 'gyroid', label: 'Gyroid' },
]

export function densitySphere(x, y, z, radius = 0.72) {
  return radius - Math.hypot(x, y, z)
}

export function densityBox(x, y, z, size = 0.62) {
  const dx = Math.abs(x) - size
  const dy = Math.abs(y) - size
  const dz = Math.abs(z) - size
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0))
  const inside = Math.min(Math.max(dx, dy, dz), 0)
  return -(outside + inside)
}

export function densityCylinder(x, y, z, radius = 0.55, height = 0.75) {
  const radial = radius - Math.hypot(x, z)
  const vertical = height - Math.abs(y)
  return Math.min(radial, vertical)
}

export function densityTorus(x, y, z, major = 0.48, minor = 0.2) {
  const q = Math.hypot(x, z) - major
  return minor - Math.hypot(q, y)
}

export function densityCross(x, y, z, arm = 0.78, thickness = 0.22) {
  const barX = densityBox(x / arm, y / thickness, z / thickness, 1)
  const barY = densityBox(x / thickness, y / arm, z / thickness, 1)
  const barZ = densityBox(x / thickness, y / thickness, z / arm, 1)
  return Math.max(barX, barY, barZ)
}

export function densityGyroid(x, y, z, scale = 4.2) {
  const sx = x * scale
  const sy = y * scale
  const sz = z * scale
  return (
    Math.sin(sx) * Math.cos(sy) +
    Math.sin(sy) * Math.cos(sz) +
    Math.sin(sz) * Math.cos(sx)
  )
}

/**
 * Evaluate a density shape at a voxel, optionally warped by noise.
 */
export function sampleDensity(shape, x, y, z, params) {
  const { noiseScale, noiseType, octaves, seed, noiseWarp } = params
  let px = x
  let py = y
  let pz = z

  if (noiseWarp > 0) {
    const warp = getNoise(x * 40 + 10, z * 40 + 10, {
      type: noiseType,
      scale: noiseScale * 8,
      octaves: Math.min(octaves, 3),
      persistence: 0.5,
      lacunarity: 2,
      seed,
    })
    const amount = noiseWarp * 0.22
    px += warp * amount
    py +=
      getNoise(y * 40 + 50, x * 40 + 50, {
        type: noiseType,
        scale: noiseScale * 8,
        octaves: Math.min(octaves, 3),
        persistence: 0.5,
        lacunarity: 2,
        seed: seed + 17,
      }) * amount
    pz +=
      getNoise(z * 40 + 90, y * 40 + 90, {
        type: noiseType,
        scale: noiseScale * 8,
        octaves: Math.min(octaves, 3),
        persistence: 0.5,
        lacunarity: 2,
        seed: seed + 91,
      }) * amount
  }

  switch (shape) {
    case 'sphere':
      return densitySphere(px, py, pz)
    case 'box':
      return densityBox(px, py, pz)
    case 'cylinder':
      return densityCylinder(px, py, pz)
    case 'torus':
      return densityTorus(px, py, pz)
    case 'cross':
      return densityCross(px, py, pz)
    case 'gyroid':
      return densityGyroid(px, py, pz)
    default:
      return -1
  }
}
