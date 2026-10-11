import { getNoise } from './noise'

/**
 * Terrain data maps for Week 5, sampled on the same grid as the terrain mesh.
 *
 *   heights        world height (y) per grid point
 *   level          normalized height, 0 = lowest point, 1 = highest
 *   slope          degrees, 0 = flat
 *   cliffDistance  metres to the nearest cliff (slope > rock slope + CLIFF_MARGIN)
 *   waterDistance  metres to the shoreline; negative under water
 *
 * Index = row * points + column, with x = -size/2 + column * step and
 * z = -size/2 + row * step.
 */

export const CLIFF_MARGIN = 10
// Stand-in for "no such feature anywhere" in the distance maps.
const FAR = 1000

// Two-pass chamfer distance transform: distance (in metres) from every cell
// to the nearest cell where isSource is true.
function distanceTransform(isSource, points, step) {
  const distance = new Float32Array(points * points)
  for (let index = 0; index < distance.length; index += 1) {
    distance[index] = isSource[index] ? 0 : Infinity
  }
  const straight = step
  const diagonal = step * Math.SQRT2
  const relax = (index, neighbour, cost) => {
    const candidate = distance[neighbour] + cost
    if (candidate < distance[index]) distance[index] = candidate
  }

  for (let row = 0; row < points; row += 1) {
    for (let column = 0; column < points; column += 1) {
      const index = row * points + column
      if (column > 0) relax(index, index - 1, straight)
      if (row > 0) {
        relax(index, index - points, straight)
        if (column > 0) relax(index, index - points - 1, diagonal)
        if (column < points - 1) relax(index, index - points + 1, diagonal)
      }
    }
  }
  for (let row = points - 1; row >= 0; row -= 1) {
    for (let column = points - 1; column >= 0; column -= 1) {
      const index = row * points + column
      if (column < points - 1) relax(index, index + 1, straight)
      if (row < points - 1) {
        relax(index, index + points, straight)
        if (column < points - 1) relax(index, index + points + 1, diagonal)
        if (column > 0) relax(index, index + points - 1, diagonal)
      }
    }
  }
  // No source at all leaves Infinity, which breaks interpolation; cap it.
  for (let index = 0; index < distance.length; index += 1) {
    if (distance[index] > FAR) distance[index] = FAR
  }
  return distance
}

export function createTerrainFields({
  size,
  segments,
  height,
  noise,
  rockSlope,
  waterLevel,
  showWater,
}) {
  const points = segments + 1
  const step = size / segments
  const count = points * points
  const heights = new Float32Array(count)

  let min = Infinity
  let max = -Infinity
  for (let row = 0; row < points; row += 1) {
    for (let column = 0; column < points; column += 1) {
      const value =
        getNoise(-size / 2 + column * step, -size / 2 + row * step, noise) * height
      heights[row * points + column] = value
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
  }
  const range = Math.max(max - min, 1e-6)

  // Gradient by central differences (one-sided at the border).
  const gradientX = new Float32Array(count)
  const gradientZ = new Float32Array(count)
  const level = new Float32Array(count)
  const slope = new Float32Array(count)
  for (let row = 0; row < points; row += 1) {
    for (let column = 0; column < points; column += 1) {
      const index = row * points + column
      const left = column > 0 ? index - 1 : index
      const right = column < points - 1 ? index + 1 : index
      const up = row > 0 ? index - points : index
      const down = row < points - 1 ? index + points : index
      gradientX[index] = (heights[right] - heights[left]) / ((right - left) * step)
      gradientZ[index] = (heights[down] - heights[up]) / (((down - up) / points) * step)
      slope[index] =
        (Math.atan(Math.hypot(gradientX[index], gradientZ[index])) * 180) / Math.PI
      level[index] = (heights[index] - min) / range
    }
  }

  const isCliff = new Uint8Array(count)
  for (let index = 0; index < count; index += 1) {
    isCliff[index] = slope[index] > rockSlope + CLIFF_MARGIN ? 1 : 0
  }
  const cliffDistance = distanceTransform(isCliff, points, step)

  // Water: a flat plane at waterLevel% of the height range.
  const hasWater = showWater && waterLevel > 0
  const waterY = hasWater ? min + (waterLevel / 100) * range : -Infinity
  const isWater = new Uint8Array(count)
  const isLand = new Uint8Array(count)
  for (let index = 0; index < count; index += 1) {
    isWater[index] = heights[index] < waterY ? 1 : 0
    isLand[index] = 1 - isWater[index]
  }
  const toWater = distanceTransform(isWater, points, step)
  const toLand = distanceTransform(isLand, points, step)
  const waterDistance = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    waterDistance[index] = isWater[index] ? -toLand[index] : toWater[index]
  }

  // Bilinear lookup of any grid field at world (x, z).
  const lookup = (field, x, z) => {
    const gridX = Math.min(Math.max((x + size / 2) / step, 0), points - 1)
    const gridZ = Math.min(Math.max((z + size / 2) / step, 0), points - 1)
    const column = Math.min(Math.floor(gridX), points - 2)
    const row = Math.min(Math.floor(gridZ), points - 2)
    const fx = gridX - column
    const fz = gridZ - row
    const index = row * points + column
    const top = field[index] + (field[index + 1] - field[index]) * fx
    const bottom =
      field[index + points] + (field[index + points + 1] - field[index + points]) * fx
    return top + (bottom - top) * fz
  }

  const toSample = (y, values) => {
    const length = Math.hypot(values.dx, 1, values.dz)
    return {
      y,
      level: values.level,
      slope: values.slope,
      normal: [-values.dx / length, 1 / length, -values.dz / length],
      cliffDistance: values.cliffDistance,
      waterDistance: values.waterDistance,
      depth: waterY - y,
    }
  }

  return {
    size,
    points,
    step,
    heights,
    waterY,
    hasWater,
    rockSlope,
    // Everything the placement rules need at one world position.
    sample(x, z) {
      return toSample(lookup(heights, x, z), {
        dx: lookup(gradientX, x, z),
        dz: lookup(gradientZ, x, z),
        level: lookup(level, x, z),
        slope: lookup(slope, x, z),
        cliffDistance: lookup(cliffDistance, x, z),
        waterDistance: lookup(waterDistance, x, z),
      })
    },
    // Same data at an exact grid point (used for the rule preview tint).
    sampleAt(index) {
      return toSample(heights[index], {
        dx: gradientX[index],
        dz: gradientZ[index],
        level: level[index],
        slope: slope[index],
        cliffDistance: cliffDistance[index],
        waterDistance: waterDistance[index],
      })
    },
  }
}
