import { createRandom } from './distributions'
import { MinHeap } from './heap'
import { catmullRom, nearestSampleGrid, resample, thin } from './splines'

/**
 * Week 5 rivers: spring → downhill → lake (or the edge of the map).
 *
 *   1. Pit filling (priority flood) gives every cell a downhill route to a
 *      lake or the border, so a river can't get stuck in a hollow.
 *   2. Springs: seeded picks on high ground, at least SPRING_SPACING apart.
 *      A river that runs into an earlier one stops there (a tributary).
 *   3. The grid path is thinned and smoothed into a curve.
 *   4. Width and channel depth grow downstream; the water surface only ever
 *      goes down. The channel is carved into a copy of the heights.
 */

export const DEFAULT_RIVERS = {
  on: true,
  count: 2,
  seed: 3,
  springMin: 55,
  mouthWidth: 1.8,
  depth: 0.6,
}

const SOURCE_WIDTH = 0.5
const SPRING_MAX_LEVEL = 0.9
const SPRING_SPACING = 10
const MIN_RIVER_LENGTH = 6
// Banks rise at this gradient (≈31°) beside the water.
const BANK_SLOPE = 0.6
const BANK_REACH = 2.5
const SAMPLE_SPACING = 0.2
// Grid cells kept per curve point before smoothing (0.8 m apart).
const THIN_EVERY = 4
// Share of the channel depth that sits above the water (dry bank).
const FREEBOARD = 0.4
const EPSILON = 1e-4

const NEIGHBOURS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
]

// Priority flood from the border and lake cells: downstream[i] is the next
// cell on the way out; isSink marks where rivers end.
function flowDirections(grid) {
  const { points, heights, hasLake, lakeY } = grid
  const count = points * points
  const downstream = new Int32Array(count).fill(-1)
  const filled = new Float32Array(count)
  const visited = new Uint8Array(count)
  const isSink = new Uint8Array(count)
  const heap = new MinHeap()

  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / points)
    const column = index % points
    const onBorder = row === 0 || column === 0 || row === points - 1 || column === points - 1
    if (onBorder || (hasLake && heights[index] < lakeY)) {
      isSink[index] = 1
      visited[index] = 1
      filled[index] = heights[index]
      heap.push(index, heights[index])
    }
  }

  while (heap.size > 0) {
    const index = heap.pop()
    const row = Math.floor(index / points)
    const column = index % points
    for (const [dc, dr] of NEIGHBOURS) {
      const r = row + dr
      const c = column + dc
      if (r < 0 || c < 0 || r >= points || c >= points) continue
      const next = r * points + c
      if (visited[next]) continue
      visited[next] = 1
      filled[next] = Math.max(heights[next], filled[index] + EPSILON)
      downstream[next] = index
      heap.push(next, filled[next])
    }
  }
  return { downstream, isSink }
}

function bilinear(grid, field, x, z) {
  const { points, step, size } = grid
  const gx = Math.min(Math.max((x + size / 2) / step, 0), points - 1)
  const gz = Math.min(Math.max((z + size / 2) / step, 0), points - 1)
  const c = Math.min(Math.floor(gx), points - 2)
  const r = Math.min(Math.floor(gz), points - 2)
  const fx = gx - c
  const fz = gz - r
  const i = r * points + c
  const top = field[i] + (field[i + 1] - field[i]) * fx
  const bottom = field[i + points] + (field[i + points + 1] - field[i + points]) * fx
  return top + (bottom - top) * fz
}

/**
 * Returns { heights, mask, surface, rivers } – carved heights, river cells,
 * water surface per river cell, and per river its samples
 * [{ x, z, t, width, surface }]. Returns null when rivers are off.
 */
export function carveRivers(grid, settings) {
  if (!settings.on || settings.count === 0) return null
  const { points, step, size, heights: original, min, range } = grid
  const count = points * points
  const toWorld = (index) => [
    -size / 2 + (index % points) * step,
    -size / 2 + Math.floor(index / points) * step,
  ]

  const { downstream, isSink } = flowDirections(grid)
  const random = createRandom(settings.seed * 7919 + 17)

  // Spring candidates on a coarse lattice, shuffled by the river seed.
  const candidates = []
  for (let row = 2; row < points - 2; row += 3) {
    for (let column = 2; column < points - 2; column += 3) {
      const index = row * points + column
      const level = (original[index] - min) / range
      if (isSink[index]) continue
      if (level < settings.springMin / 100 || level > SPRING_MAX_LEVEL) continue
      candidates.push(index)
    }
  }
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[candidates[index], candidates[swap]] = [candidates[swap], candidates[index]]
  }

  const taken = new Uint8Array(count)
  const springs = []
  const paths = []
  for (const spring of candidates) {
    if (paths.length >= settings.count) break
    const [sx, sz] = toWorld(spring)
    if (springs.some(([x, z]) => Math.hypot(x - sx, z - sz) < SPRING_SPACING)) continue
    const cells = [spring]
    let cell = spring
    while (!isSink[cell] && !taken[cell] && downstream[cell] !== -1) {
      cell = downstream[cell]
      cells.push(cell)
    }
    if (cells.length * step < MIN_RIVER_LENGTH) continue
    cells.forEach((index) => {
      taken[index] = 1
    })
    springs.push([sx, sz])
    paths.push(cells)
  }

  const heights = Float32Array.from(original)
  const mask = new Uint8Array(count)
  const surface = new Float32Array(count)
  const bestDistance = new Float32Array(count).fill(Infinity)
  const rivers = []

  for (const cells of paths) {
    const curve = catmullRom(thin(cells.map(toWorld), THIN_EVERY), 6)
    const samples = resample(curve, SAMPLE_SPACING)

    // Width and depth grow downstream; the surface never rises.
    let previous = Infinity
    for (const sample of samples) {
      sample.width = SOURCE_WIDTH + (settings.mouthWidth - SOURCE_WIDTH) * sample.t
      const channel = settings.depth * (0.25 + 0.75 * sample.t)
      const ground = bilinear(grid, original, sample.x, sample.z)
      let level = Math.min(ground - FREEBOARD * channel, previous)
      if (grid.hasLake) level = Math.max(level, grid.lakeY)
      sample.surface = level
      sample.bed = level - (1 - FREEBOARD) * channel
      previous = level
    }

    const reach = settings.mouthWidth / 2 + BANK_REACH
    const { nearest, distance } = nearestSampleGrid(samples, reach, grid)
    for (let index = 0; index < count; index += 1) {
      if (nearest[index] === -1) continue
      const sample = samples[nearest[index]]
      const half = sample.width / 2
      const d = distance[index]
      // Rounded channel up to the water's edge, then banks rising outward.
      const profile =
        d <= half
          ? sample.bed + (sample.surface - sample.bed) * (d / half) ** 2
          : sample.surface + (d - half) * BANK_SLOPE
      heights[index] = Math.min(heights[index], profile)
      if (d <= half && d < bestDistance[index]) {
        bestDistance[index] = d
        mask[index] = 1
        surface[index] = sample.surface
      }
    }
    rivers.push({ samples })
  }

  return { heights, mask, surface, rivers }
}
