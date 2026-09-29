import { applyTerrainShaping, getNoise } from './noise'

/**
 * Terrain generation — turns noise parameters into a height field.
 *
 * Pipeline:  grid (x,z) → fractal Perlin → shaping → height in [-1, 1]
 */

export const DEFAULT_TERRAIN_PARAMS = {
  seed: 42,
  resolution: 64,
  scale: 0.045,
  amplitude: 2.4,
  octaves: 5,
  persistence: 0.5,
  lacunarity: 2,
  shaping: 'normal',
  worldSize: 14,
}

/**
 * Sample one terrain height at integer grid coordinates.
 */
export function sampleTerrainHeight(gridX, gridZ, params) {
  const raw = getNoise(gridX, gridZ, {
    type: 'perlin',
    scale: params.scale,
    octaves: params.octaves,
    persistence: params.persistence,
    lacunarity: params.lacunarity ?? 2,
    seed: params.seed,
  })
  return applyTerrainShaping(raw, params.shaping)
}

/**
 * Build a resolution × resolution height map (values in -1..1).
 * Index = z * resolution + x.
 */
export function generateHeightMap(params) {
  const resolution = params.resolution
  const heights = new Float32Array(resolution * resolution)

  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      heights[z * resolution + x] = sampleTerrainHeight(x, z, params)
    }
  }

  return heights
}
