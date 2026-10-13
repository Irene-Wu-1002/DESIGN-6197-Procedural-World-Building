import { MinHeap } from './heap'
import { CLIFF_MARGIN } from './terrainFields'
import { catmullRom, nearestSampleGrid, resample, smoothValues, thin } from './splines'

/**
 * Week 5 roads: dirt roads linking every windmill, plus one road off the map.
 *
 *   1. Which pairs: a minimum spanning tree over straight-line distance.
 *   2. Route: A* on a coarse grid. Slopes cost more (roads zig-zag up hills),
 *      lakes and cliffs are blocked, rivers cost extra and become bridges.
 *   3. The grid path is thinned and smoothed; road height is smoothed along
 *      its length so the climb stays gentle; bridges get a level deck.
 *   4. The ground is flattened under the road and blended back over a
 *      shoulder. Nothing is flattened inside rivers or lakes.
 */

export const DEFAULT_ROADS = {
  on: true,
  exit: true,
  width: 1.6,
  slopeAvoid: 60,
  bridges: true,
}

// Route on every 2nd grid point (0.4 m cells) – 4× fewer cells to search.
const COARSE = 2
// Extra cost per metre at 100% avoidance when the road itself climbs at
// REFERENCE_GRADE (rise / run). Grows with the square, so a road prefers
// to traverse along a hillside instead of straight up it.
const SLOPE_COST = 6
const REFERENCE_GRADE = 0.12
const BRIDGE_COST = 25
const SHOULDER = 1
const SAMPLE_SPACING = 0.25
const THIN_EVERY = 3
// Road height is averaged over ±2 m (8 samples), 3 times.
const GRADE_RADIUS = 8
const GRADE_PASSES = 3
// Roads stop this far (× windmill scale) from the windmill centre.
const WINDMILL_CLEARANCE = 1.2
const BRIDGE_CLEARANCE = 0.35
// Samples added to each end of a bridge so it lands on the banks.
const BRIDGE_OVERHANG = 2

const NEIGHBOURS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
]

function createRouter(fields, settings) {
  const { points, step, size, grids } = fields
  const coarsePoints = Math.floor((points - 1) / COARSE) + 1
  const coarseStep = step * COARSE
  const count = coarsePoints * coarsePoints
  const fine = (cell) => {
    const row = Math.floor(cell / coarsePoints) * COARSE
    const column = (cell % coarsePoints) * COARSE
    return row * points + column
  }
  const blocked = new Uint8Array(count)
  const river = new Uint8Array(count)
  const height = new Float32Array(count)
  const cliffLimit = fields.rockSlope + CLIFF_MARGIN
  // Fine cells within one fine step: a coarse cell is blocked if any of
  // them is lake or cliff, so the smoothed road can't clip one in between.
  const isBad = (row, column) => {
    for (let r = Math.max(row - 1, 0); r <= Math.min(row + 1, points - 1); r += 1) {
      for (let c = Math.max(column - 1, 0); c <= Math.min(column + 1, points - 1); c += 1) {
        const index = r * points + c
        if (grids.isLake[index] || grids.slope[index] > cliffLimit) return true
      }
    }
    return false
  }
  for (let cell = 0; cell < count; cell += 1) {
    const index = fine(cell)
    height[cell] = fields.heights[index]
    river[cell] = grids.isRiver[index]
    const row = Math.floor(cell / coarsePoints) * COARSE
    const column = (cell % coarsePoints) * COARSE
    blocked[cell] = isBad(row, column) || (river[cell] && !settings.bridges) ? 1 : 0
  }
  const avoid = (settings.slopeAvoid / 100) * SLOPE_COST

  const toCell = (x, z) => {
    const column = Math.min(Math.max(Math.round((x + size / 2) / coarseStep), 0), coarsePoints - 1)
    const row = Math.min(Math.max(Math.round((z + size / 2) / coarseStep), 0), coarsePoints - 1)
    return row * coarsePoints + column
  }
  const toWorld = (cell) => [
    -size / 2 + (cell % coarsePoints) * coarseStep,
    -size / 2 + Math.floor(cell / coarsePoints) * coarseStep,
  ]
  const isBorder = (cell) => {
    const row = Math.floor(cell / coarsePoints)
    const column = cell % coarsePoints
    return row === 0 || column === 0 || row === coarsePoints - 1 || column === coarsePoints - 1
  }

  // A* from start until isGoal(cell); heuristic(cell) must not overestimate.
  const route = (start, isGoal, heuristic) => {
    const cost = new Float32Array(count).fill(Infinity)
    const came = new Int32Array(count).fill(-1)
    const closed = new Uint8Array(count)
    const heap = new MinHeap()
    cost[start] = 0
    heap.push(start, heuristic(start))
    while (heap.size > 0) {
      const cell = heap.pop()
      if (closed[cell]) continue
      closed[cell] = 1
      if (isGoal(cell)) {
        const path = [cell]
        while (came[path[path.length - 1]] !== -1) path.push(came[path[path.length - 1]])
        return path.reverse()
      }
      const row = Math.floor(cell / coarsePoints)
      const column = cell % coarsePoints
      for (const [dc, dr] of NEIGHBOURS) {
        const r = row + dr
        const c = column + dc
        if (r < 0 || c < 0 || r >= coarsePoints || c >= coarsePoints) continue
        const next = r * coarsePoints + c
        if (closed[next] || blocked[next]) continue
        const length = coarseStep * (dc && dr ? Math.SQRT2 : 1)
        // River banks are carved, so don't count the dip into a bridge crossing.
        const grade = river[next] || river[cell] ? 0 : Math.abs(height[next] - height[cell]) / length
        let stepCost = length * (1 + avoid * (grade / REFERENCE_GRADE) ** 2)
        if (river[next]) stepCost += length * BRIDGE_COST
        const total = cost[cell] + stepCost
        if (total < cost[next]) {
          cost[next] = total
          came[next] = cell
          heap.push(next, total + heuristic(next))
        }
      }
    }
    return null
  }

  return { route, toCell, toWorld, isBorder, coarseStep, size }
}

// Shortest set of links joining all windmills (Prim, straight-line distance).
function spanningPairs(windmills) {
  if (windmills.length < 2) return []
  const inTree = [0]
  const pairs = []
  while (inTree.length < windmills.length) {
    let best = null
    for (const a of inTree) {
      windmills.forEach((windmill, b) => {
        if (inTree.includes(b)) return
        const d = Math.hypot(windmill.x - windmills[a].x, windmill.z - windmills[a].z)
        if (!best || d < best.d) best = { a, b, d }
      })
    }
    pairs.push([best.a, best.b])
    inTree.push(best.b)
  }
  return pairs
}

/**
 * Returns { heights, mask, roads } – flattened heights, road cells, and per
 * road { samples: [{ x, z, t, y, bridge }], bridges: [{ from, to, y }] }.
 * Returns null when roads are off or there is nothing to connect.
 */
export function buildRoads(fields, windmills, settings, baseHeights) {
  if (!settings.on || windmills.length === 0) return null
  const router = createRouter(fields, settings)
  const half = fields.size / 2
  const routes = []

  for (const [a, b] of spanningPairs(windmills)) {
    const from = windmills[a]
    const to = windmills[b]
    const goal = router.toCell(to.x, to.z)
    const [gx, gz] = router.toWorld(goal)
    const path = router.route(
      router.toCell(from.x, from.z),
      (cell) => cell === goal,
      (cell) => {
        const [x, z] = router.toWorld(cell)
        return Math.hypot(x - gx, z - gz)
      }
    )
    if (path) routes.push({ path, ends: [from, to] })
  }

  if (settings.exit) {
    // From the windmill closest to the edge, to whichever border cell is cheapest.
    const edgeGap = (w) => half - Math.max(Math.abs(w.x), Math.abs(w.z))
    const from = windmills.reduce((best, w) => (edgeGap(w) < edgeGap(best) ? w : best))
    const path = router.route(router.toCell(from.x, from.z), router.isBorder, (cell) => {
      const [x, z] = router.toWorld(cell)
      return half - Math.max(Math.abs(x), Math.abs(z))
    })
    if (path) routes.push({ path, ends: [from, null] })
  }

  const heights = Float32Array.from(baseHeights)
  const mask = new Uint8Array(heights.length)
  const { grids } = fields
  const cellAt = (x, z) => {
    const column = Math.min(Math.max(Math.round((x + half) / fields.step), 0), fields.points - 1)
    const row = Math.min(Math.max(Math.round((z + half) / fields.step), 0), fields.points - 1)
    return row * fields.points + column
  }
  const cliffLimit = fields.rockSlope + CLIFF_MARGIN
  const offLimits = (s) => {
    const cell = cellAt(s.x, s.z)
    return grids.isLake[cell] === 1 || grids.slope[cell] > cliffLimit
  }
  const roads = []

  for (const { path, ends } of routes) {
    const raw = path.map(router.toWorld)
    // Smooth, but fall back to a tighter curve (then the raw grid path) if
    // smoothing cuts into a lake or across a cliff.
    let samples = resample(catmullRom(thin(raw, THIN_EVERY), 6), SAMPLE_SPACING)
    if (samples.some(offLimits)) samples = resample(catmullRom(raw, 4), SAMPLE_SPACING)
    if (samples.some(offLimits)) samples = resample(raw, SAMPLE_SPACING)

    // Stop short of the windmills so the road meets the tower, not its centre.
    samples = samples.filter((s) =>
      ends.every(
        (end) => !end || Math.hypot(s.x - end.x, s.z - end.z) > WINDMILL_CLEARANCE * end.scale
      )
    )
    if (samples.length < 2) continue

    // Bridges: runs of samples over river water, widened onto the banks.
    const overRiver = samples.map((s) => grids.isRiver[cellAt(s.x, s.z)] === 1)
    const bridges = []
    for (let index = 0; index < samples.length; index += 1) {
      if (!overRiver[index]) continue
      let end = index
      while (end + 1 < samples.length && overRiver[end + 1]) end += 1
      bridges.push({
        from: Math.max(index - BRIDGE_OVERHANG, 0),
        to: Math.min(end + BRIDGE_OVERHANG, samples.length - 1),
      })
      index = end
    }

    // Road height: ground along the road, smoothed for a gentle climb.
    const ground = samples.map((s) => fields.sample(s.x, s.z))
    const smoothed = smoothValues(
      ground.map((g) => g.y),
      GRADE_RADIUS,
      GRADE_PASSES
    )
    samples.forEach((s, index) => {
      s.y = smoothed[index]
      s.bridge = false
    })
    for (const bridge of bridges) {
      let deck = Math.max(samples[bridge.from].y, samples[bridge.to].y)
      for (let index = bridge.from; index <= bridge.to; index += 1) {
        const g = ground[index]
        if (g.depth > 0) deck = Math.max(deck, g.y + g.depth + BRIDGE_CLEARANCE)
      }
      bridge.y = deck
      for (let index = bridge.from; index <= bridge.to; index += 1) {
        samples[index].y = deck
        samples[index].bridge = true
      }
    }

    // Flatten the ground under the road (never inside water or under bridges).
    const roadHalf = settings.width / 2
    const { nearest, distance } = nearestSampleGrid(samples, roadHalf + SHOULDER, fields)
    for (let index = 0; index < heights.length; index += 1) {
      if (nearest[index] === -1) continue
      const sample = samples[nearest[index]]
      const d = distance[index]
      if (d <= roadHalf) mask[index] = 1
      if (sample.bridge || grids.isRiver[index] || grids.isLake[index]) continue
      const t = Math.min(Math.max((d - roadHalf) / SHOULDER, 0), 1)
      const weight = d <= roadHalf ? 1 : 1 - t * t * (3 - 2 * t)
      heights[index] += (sample.y - heights[index]) * weight
    }

    roads.push({ samples, bridges, width: settings.width })
  }

  return { heights, mask, roads }
}
