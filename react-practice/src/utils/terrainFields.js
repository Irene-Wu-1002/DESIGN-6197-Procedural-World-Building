import { getNoise } from './noise'

/**
 * Terrain data maps for Week 5, sampled on the same grid as the terrain mesh.
 *
 *   heights        world height (y) per grid point
 *   level          normalized height, 0 = lowest point, 1 = highest
 *   slope          degrees, 0 = flat
 *   cliffDistance  metres to the nearest cliff (slope > rock slope + CLIFF_MARGIN)
 *   waterDistance  metres to the nearest lake or river; negative under water
 *   moisture       0 dry → 1 wet (near water, low, flat)
 *   sun            0 shaded → 1 facing the sun
 *   roadDistance   metres to the nearest road
 *
 * Built in two steps so rivers and roads can reshape the ground in between:
 *   createHeightGrid()   heights from noise
 *   buildTerrainFields() every map above, from (possibly carved) heights
 *
 * Index = row * points + column, with x = -size/2 + column * step and
 * z = -size/2 + row * step.
 */

export const CLIFF_MARGIN = 10
// Direction toward the sun; the scene's sun light is placed along it.
export const SUN_DIRECTION = (() => {
  const length = Math.hypot(-22, 26, 14)
  return [-22 / length, 26 / length, 14 / length]
})()
// Moisture fades with distance from water over roughly this many metres.
const MOISTURE_REACH = 5
// Stand-in for "no such feature anywhere" in the distance maps.
const FAR = 1000

// Two-pass chamfer distance transform: distance (in metres) from every cell
// to the nearest cell where isSource is true.
export function distanceTransform(isSource, points, step) {
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

/**
 * Step 1: heights from noise. min/max are kept from this original surface so
 * normalized height and the lake level don't shift when rivers carve in.
 */
export function createHeightGrid({ size, segments, height, noise, waterLevel, showWater }) {
  const points = segments + 1
  const step = size / segments
  const heights = new Float32Array(points * points)
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
  // Lake: a flat plane at waterLevel% of the height range.
  const hasLake = showWater && waterLevel > 0
  return {
    size,
    segments,
    points,
    step,
    heights,
    min,
    max,
    range,
    hasLake,
    lakeY: hasLake ? min + (waterLevel / 100) * range : -FAR,
  }
}

/**
 * Step 2: every terrain map from a height grid.
 *   rivers: { mask, surface } – river water cells and their surface height
 *   roads:  { mask }          – road cells
 * heights may differ from grid.heights (carved / flattened copies).
 */
export function buildTerrainFields(grid, { heights = grid.heights, rockSlope, rivers, roads }) {
  const { size, points, step, min, range, hasLake, lakeY } = grid
  const count = points * points

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

  // Water: lake cells below the lake plane, plus river channels. depth is how
  // far below the local water surface the ground is (negative on dry land).
  const isLake = new Uint8Array(count)
  const isRiver = rivers ? rivers.mask : new Uint8Array(count)
  const isWater = new Uint8Array(count)
  const isLand = new Uint8Array(count)
  const depth = new Float32Array(count)
  let hasRiver = false
  for (let index = 0; index < count; index += 1) {
    isLake[index] = hasLake && heights[index] < lakeY ? 1 : 0
    isWater[index] = isLake[index] || isRiver[index] ? 1 : 0
    isLand[index] = 1 - isWater[index]
    depth[index] = isRiver[index] && !isLake[index]
      ? rivers.surface[index] - heights[index]
      : lakeY - heights[index]
    if (isRiver[index]) hasRiver = true
  }
  const hasWater = hasLake || hasRiver
  const toWater = distanceTransform(isWater, points, step)
  const toLand = distanceTransform(isLand, points, step)
  const waterDistance = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    waterDistance[index] = isWater[index] ? -toLand[index] : toWater[index]
  }

  const hasRoads = Boolean(roads)
  const roadDistance = hasRoads
    ? distanceTransform(roads.mask, points, step)
    : new Float32Array(count).fill(FAR)

  // Moisture (0 dry → 1 wet): closeness to water, plus low and flat ground
  // where water collects. Sun exposure (0 shaded → 1 facing the sun).
  const moisture = new Float32Array(count)
  const sun = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    const low = 1 - level[index]
    const flat = 1 - Math.min(slope[index] / 45, 1)
    const wet = hasWater
      ? Math.exp(-Math.max(waterDistance[index], 0) / MOISTURE_REACH)
      : 0
    moisture[index] = hasWater
      ? Math.min(0.65 * wet + 0.25 * low + 0.1 * flat, 1)
      : 0.65 * low + 0.35 * flat

    const length = Math.hypot(gradientX[index], 1, gradientZ[index])
    const facing =
      (-gradientX[index] * SUN_DIRECTION[0] +
        SUN_DIRECTION[1] -
        gradientZ[index] * SUN_DIRECTION[2]) /
      length
    sun[index] = Math.max(facing, 0)
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
      depth: values.depth,
      moisture: values.moisture,
      sun: values.sun,
      roadDistance: values.roadDistance,
    }
  }

  return {
    size,
    points,
    step,
    heights,
    // Lake plane height (lakeY) and whether it's shown.
    waterY: lakeY,
    hasLake,
    hasWater,
    hasRoads,
    rockSlope,
    // Raw grids, for routing roads and drawing previews.
    grids: { slope, level, cliffDistance, waterDistance, isLake, isRiver, roadDistance },
    // Everything the placement rules need at one world position.
    sample(x, z) {
      return toSample(lookup(heights, x, z), {
        dx: lookup(gradientX, x, z),
        dz: lookup(gradientZ, x, z),
        level: lookup(level, x, z),
        slope: lookup(slope, x, z),
        cliffDistance: lookup(cliffDistance, x, z),
        waterDistance: lookup(waterDistance, x, z),
        depth: lookup(depth, x, z),
        moisture: lookup(moisture, x, z),
        sun: lookup(sun, x, z),
        roadDistance: lookup(roadDistance, x, z),
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
        depth: depth[index],
        moisture: moisture[index],
        sun: sun[index],
        roadDistance: roadDistance[index],
      })
    },
  }
}

/** One-call version (heights straight from noise, no rivers or roads). */
export function createTerrainFields(options) {
  const grid = createHeightGrid(options)
  return buildTerrainFields(grid, { rockSlope: options.rockSlope })
}
