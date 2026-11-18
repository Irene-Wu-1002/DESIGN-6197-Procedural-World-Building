import { agaricSpot, possibleAntHills } from './antHills'
import { createGroundSampler, hash } from './heightField'

/**
 * The stream: a forest-floor rill a few centimetres wide (a river to an
 * ant) that crosses the world past the ant hill. Like the trail, it depends
 * only on the seed, the ground and the Paths settings.
 *
 * How it is made:
 *   route     a walker starts 6 m out on a seeded guide line and steps
 *             along it, at each step turning toward the lowest ground just
 *             ahead (so the stream finds the valleys and crosses ridges at
 *             their saddles), kept near the guide line (Meander widens the
 *             band it may wander in) and away from trunks, nests, the fly
 *             agaric and the start view; then smoothed
 *   flow      downhill: from the higher end to the lower one
 *   level     the water surface along the stream: the smooth ground (30 cm
 *             slopes + nests) a little under the banks, never rising
 *             downstream (where the ground rises ahead, the stream cuts
 *             through it), then eased; so water never runs uphill
 *   channel   carved into the ground at every point: a rounded bed under
 *             the water, banks rising from the water's edge, and a low lip
 *             where the ground beside it would otherwise fall below the
 *             water (so it never spills); it blends back into the natural
 *             ground a few centimetres out
 *
 * carve(x, z, natural, smooth, extra) reshapes one ground sample (detail
 * and smooth surface alike); nearest(x, z) is the closest point on the
 * centre line (a grid of segments keeps it cheap for every terrain
 * sample).
 *
 * Plain data only, no Three.js. Units are metres.
 */

// Paths settings for the stream (DEFAULT_PATHS spreads these in): on, width
// (cm), water depth at the centre (cm), meander (%), flow speed (%),
// clearance for ground cover beyond the water's edge (cm).
export const DEFAULT_STREAM = {
  showStream: true,
  streamWidth: 7,
  streamDepth: 0.8,
  streamMeander: 50,
  streamFlow: 100,
  streamClearance: 1,
}

// Half the length of the stream along its guide line (m), and how close the
// guide line passes the ant hill.
const HALF_LENGTH = 6
const PASS = [0.5, 0.7]
const WALK = {
  step: 0.01,
  // Where the next step is judged (m ahead: the ground just ahead, and
  // obstacles further on too), and the headings tried.
  look: 0.06,
  lookFar: 0.3,
  spread: 0.6,
  candidates: 9,
  // Most the heading turns in one step (rad).
  turn: 0.06,
  // The band the stream may wander from its guide line (m), at 0% and 100%
  // meander.
  band: [0.05, 0.6],
}
// Clearance around obstacles (m beyond their edge).
const KEEP = { trunk: 0.12, nest: 0.1, agaric: 0.09, spawn: 0.08 }
// Obstacles are felt this far beyond their keep-out radius (m).
const SENSE = 0.3
// Smoothing passes over the walked points (each a 5-point average).
const SMOOTH_PASSES = 6
// Water surface sits this far under the smooth ground along the centre.
const FREEBOARD = 0.006
// Easing of the water surface along the stream (points either side).
const LEVEL_EASE = 12
// Banks: slope up from the water's edge; lip height and how fast it falls
// away; how far out (beyond the edge) the channel blends back.
const BANK_SLOPE = 0.8
const LIP = { height: 0.0015, width: 0.2, fall: 0.2 }
const REACH = 0.12
const BLEND = 0.04
// Grid cell for the segment lookup (m).
const CELL = 0.1
const SALT = 6301

const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}
// Smooth minimum (k: blend size, m).
const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - (h * h * k) / 4
}

/**
 * The stream for this ground and these Paths settings, or null (off).
 * ground: Terrain settings (seed, slopes, bumps, warp, antHill, nests);
 * trunks: the trunk field (cover/trunks.js) or null.
 *
 * Returns { points (x, z pairs), lengths, level (water surface per point),
 * slope (fall per metre per point), count, length, halfWidth, depth, flow,
 * clearance, nearest(x, z, reach), carve(...), wet(x, z), bankAt(x, z) }.
 */
export function createStream({ ground, paths, trunks = null }) {
  if (!paths.showStream) return null
  const seed = ground.seed
  // The ground without the stream (and without pebbles: the route only
  // cares about the smooth shape).
  const base = createGroundSampler({ ...ground, pebbles: 0, trail: null, stream: null })
  const sample = {}
  const smoothAt = (x, z) => {
    base.sample(x, z, sample)
    return sample.broadLowHeight + sample.hillHeight
  }

  // The guide line: a seeded direction, passing the ant hill to one side.
  const angle = hash(seed, 1, SALT) * Math.PI * 2
  const dir = [Math.cos(angle), Math.sin(angle)]
  const side = [-dir[1], dir[0]]
  const pass = (PASS[0] + hash(seed, 2, SALT) * (PASS[1] - PASS[0])) * (hash(seed, 3, SALT) < 0.5 ? -1 : 1)
  const center = [side[0] * pass, side[1] * pass]

  // Obstacles: [x, z, keep-out radius].
  const obstacles = []
  for (const hill of ground.antHill ? possibleAntHills(seed) : []) obstacles.push([hill.x, hill.z, hill.radius + KEEP.nest])
  const agaric = agaricSpot(seed)
  obstacles.push([agaric.x, agaric.z, KEEP.agaric], [agaric.x / 2, agaric.z / 2, KEEP.spawn])
  const obstaclesNear = (x, z) => [
    ...obstacles,
    ...(trunks?.trunksNear(x, z, 0.8) ?? []).map((trunk) => [trunk.x, trunk.z, trunk.radius + KEEP.trunk]),
  ]
  const obstacleCost = (x, z) => {
    let cost = 0
    for (const [ox, oz, radius] of obstaclesNear(x, z)) {
      const d = Math.hypot(x - ox, z - oz)
      cost += 12 * smoothstep(radius + SENSE, radius, d) + (d < radius ? 40 : 0)
    }
    return cost
  }

  // Walk the route.
  const meander = paths.streamMeander / 100
  const band = WALK.band[0] + (WALK.band[1] - WALK.band[0]) * meander
  const walked = []
  let x = center[0] - dir[0] * HALF_LENGTH
  let z = center[1] - dir[1] * HALF_LENGTH
  let heading = angle
  const maxSteps = Math.ceil((HALF_LENGTH * 2 * 1.6) / WALK.step)
  for (let i = 0; i < maxSteps; i += 1) {
    walked.push(x, z)
    const along = (x - center[0]) * dir[0] + (z - center[1]) * dir[1]
    if (along > HALF_LENGTH) break
    let best = heading
    let bestCost = Infinity
    for (let k = 0; k < WALK.candidates; k += 1) {
      const a = heading + WALK.spread * ((k / (WALK.candidates - 1)) * 2 - 1)
      const qx = x + Math.cos(a) * WALK.look
      const qz = z + Math.sin(a) * WALK.look
      const lateral = (qx - center[0]) * side[0] + (qz - center[1]) * side[1]
      const outside = Math.max(Math.abs(lateral) - band, 0) / 0.1
      const cost =
        // Lower ground is better (per cm).
        smoothAt(qx, qz) * 100 * (0.4 + meander) +
        outside * outside * 6 +
        // Keep going roughly along the guide line.
        (1 - Math.cos(a - angle)) * 6 +
        obstacleCost(qx, qz) +
        obstacleCost(x + Math.cos(a) * WALK.lookFar, z + Math.sin(a) * WALK.lookFar)
      if (cost < bestCost) {
        bestCost = cost
        best = a
      }
    }
    const turn = Math.atan2(Math.sin(best - heading), Math.cos(best - heading))
    heading += Math.max(-WALK.turn, Math.min(WALK.turn, turn))
    x += Math.cos(heading) * WALK.step
    z += Math.sin(heading) * WALK.step
  }

  // Smooth the walk (ends stay put), pushing it out of any obstacle it
  // still grazed after each pass.
  let pts = Float64Array.from(walked)
  const count = pts.length / 2
  const clearance = paths.streamWidth / 200 + 0.03
  for (let pass = 0; pass < SMOOTH_PASSES * 2; pass += 1) {
    for (let i = 0; i < count; i += 1) {
      for (const [ox, oz, radius] of obstaclesNear(pts[i * 2], pts[i * 2 + 1])) {
        const keep = radius - KEEP.trunk * 0.5 + clearance * 0.5
        const dx = pts[i * 2] - ox
        const dz = pts[i * 2 + 1] - oz
        const d = Math.hypot(dx, dz)
        if (d >= keep || d < 1e-9) continue
        pts[i * 2] = ox + (dx / d) * keep
        pts[i * 2 + 1] = oz + (dz / d) * keep
      }
    }
    const next = Float64Array.from(pts)
    for (let i = 2; i < count - 2; i += 1) {
      for (let c = 0; c < 2; c += 1) {
        next[i * 2 + c] =
          (pts[(i - 2) * 2 + c] + pts[(i - 1) * 2 + c] + pts[i * 2 + c] + pts[(i + 1) * 2 + c] + pts[(i + 2) * 2 + c]) / 5
      }
    }
    pts = next
  }

  // Flow: from the higher end to the lower one (compare ~0.5 m at each end).
  const ends = Math.min(50, Math.floor(count / 4))
  let startHeight = 0
  let endHeight = 0
  for (let i = 0; i < ends; i += 1) {
    startHeight += smoothAt(pts[i * 2], pts[i * 2 + 1])
    endHeight += smoothAt(pts[(count - 1 - i) * 2], pts[(count - 1 - i) * 2 + 1])
  }
  const points = new Float32Array(count * 2)
  for (let i = 0; i < count; i += 1) {
    const j = startHeight >= endHeight ? i : count - 1 - i
    points[i * 2] = pts[j * 2]
    points[i * 2 + 1] = pts[j * 2 + 1]
  }
  const lengths = new Float32Array(count)
  for (let i = 1; i < count; i += 1) {
    lengths[i] = lengths[i - 1] + Math.hypot(points[i * 2] - points[i * 2 - 2], points[i * 2 + 1] - points[i * 2 - 1])
  }

  // The water surface: under the smooth ground, never rising downstream,
  // then eased (a moving average keeps it never rising).
  const raw = new Float64Array(count)
  let lowest = Infinity
  for (let i = 0; i < count; i += 1) {
    lowest = Math.min(lowest, smoothAt(points[i * 2], points[i * 2 + 1]) - FREEBOARD)
    raw[i] = lowest
  }
  const level = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    let sum = 0
    let n = 0
    for (let k = -LEVEL_EASE; k <= LEVEL_EASE; k += 1) {
      sum += raw[Math.min(Math.max(i + k, 0), count - 1)]
      n += 1
    }
    level[i] = sum / n
  }
  // Fall per metre (riffles where it's steep), over ±5 cm.
  const slope = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    const a = Math.max(i - 5, 0)
    const b = Math.min(i + 5, count - 1)
    slope[i] = b > a ? (level[a] - level[b]) / Math.max(lengths[b] - lengths[a], 1e-6) : 0
  }

  const halfWidth = paths.streamWidth / 200
  const depth = paths.streamDepth / 100
  const reach = halfWidth + REACH

  // Segment grid: each cell lists the segments within `reach` of it.
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < count; i += 1) {
    minX = Math.min(minX, points[i * 2])
    maxX = Math.max(maxX, points[i * 2])
    minZ = Math.min(minZ, points[i * 2 + 1])
    maxZ = Math.max(maxZ, points[i * 2 + 1])
  }
  minX -= reach + CELL
  minZ -= reach + CELL
  maxX += reach + CELL
  maxZ += reach + CELL
  const columns = Math.ceil((maxX - minX) / CELL)
  const rows = Math.ceil((maxZ - minZ) / CELL)
  const cells = new Map()
  for (let i = 0; i < count - 1; i += 1) {
    const ax = points[i * 2]
    const az = points[i * 2 + 1]
    const bx = points[i * 2 + 2]
    const bz = points[i * 2 + 3]
    const c0 = Math.floor((Math.min(ax, bx) - reach - minX) / CELL)
    const c1 = Math.floor((Math.max(ax, bx) + reach - minX) / CELL)
    const r0 = Math.floor((Math.min(az, bz) - reach - minZ) / CELL)
    const r1 = Math.floor((Math.max(az, bz) + reach - minZ) / CELL)
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const key = r * columns + c
        let list = cells.get(key)
        if (!list) cells.set(key, (list = []))
        list.push(i)
      }
    }
  }

  const found = { distance: Infinity, s: 0, index: 0, t: 0, x: 0, z: 0, level: 0, side: 0 }
  /**
   * The closest point on the centre line to (x, z), within `reach` (else
   * distance is Infinity). Fills and returns a shared object: { distance,
   * s (m along, downstream), index, t, x, z, level, side (+1 left / -1
   * right of the flow) }.
   */
  const nearest = (px, pz) => {
    found.distance = Infinity
    if (px < minX || px > maxX || pz < minZ || pz > maxZ) return found
    const c = Math.floor((px - minX) / CELL)
    const r = Math.floor((pz - minZ) / CELL)
    if (c < 0 || r < 0 || c >= columns || r >= rows) return found
    const list = cells.get(r * columns + c)
    if (!list) return found
    let best = Infinity
    for (const i of list) {
      const ax = points[i * 2]
      const az = points[i * 2 + 1]
      const dx = points[i * 2 + 2] - ax
      const dz = points[i * 2 + 3] - az
      const t = Math.min(Math.max(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0), 1)
      const d2 = (px - ax - dx * t) ** 2 + (pz - az - dz * t) ** 2
      if (d2 < best) {
        best = d2
        found.index = i
        found.t = t
        found.x = ax + dx * t
        found.z = az + dz * t
        found.side = dx * (pz - az) - dz * (px - ax) >= 0 ? 1 : -1
      }
    }
    if (best > reach * reach) return found
    found.distance = Math.sqrt(best)
    const i = found.index
    found.s = lengths[i] + (lengths[i + 1] - lengths[i]) * found.t
    found.level = level[i] + (level[i + 1] - level[i]) * found.t
    return found
  }

  // The channel's cross-section at distance d from the centre, for water
  // surface L, applied to one natural height.
  const shape = (d, L, natural, bed) => {
    if (d < halfWidth) return L - depth * (1 - (d / halfWidth) ** 2) + bed
    const bank = L + BANK_SLOPE * (d - halfWidth)
    const lipStart = halfWidth * (1 + LIP.width)
    const lip = L + LIP.height * smoothstep(halfWidth, lipStart, d) - LIP.fall * Math.max(d - lipStart, 0)
    const carved = Math.max(smin(natural, bank, 0.003), lip)
    // Blend back into the natural ground at the edge of reach.
    const keep = smoothstep(reach, reach - BLEND, d)
    return natural + (carved - natural) * keep
  }

  return {
    points,
    lengths,
    level,
    slope,
    count,
    length: lengths[count - 1],
    halfWidth,
    depth,
    flow: paths.streamFlow / 100,
    clearance: paths.streamClearance / 100,
    reach,
    nearest,

    /**
     * Reshape one ground sample: `out` from the sampler, with height (the
     * detailed natural ground), bumpHeight and pebbleHeight (kept, softened,
     * on the bed) and the smooth natural surface `smooth`. Writes
     * out.height, out.streamSmooth (change to the smooth surface), out.water
     * (0–1, under water), out.streamBank (0–1, wet bank), out.waterLevel.
     */
    carve(x, z, out, smooth) {
      out.streamSmooth = 0
      out.water = 0
      out.streamBank = 0
      out.waterLevel = NaN
      const q = nearest(x, z)
      if (!Number.isFinite(q.distance)) return out
      const d = q.distance
      const L = q.level
      // Stones and grit on the bed: the pebbles and a little of the bumps.
      const bed = 0.6 * out.pebbleHeight + 0.3 * out.bumpHeight
      out.height = shape(d, L, out.height, bed)
      out.streamSmooth = shape(d, L, smooth, 0) - smooth
      out.water = smoothstep(halfWidth, halfWidth * 0.85, d)
      out.streamBank = smoothstep(halfWidth + 0.05, halfWidth, d)
      out.waterLevel = L
      return out
    },

    /** True if (x, z) is under water. */
    wet(x, z) {
      return nearest(x, z).distance < halfWidth
    },

    /** 0–1: how close (x, z) is to the water (1 in it, 0 ~5 cm beyond). */
    bankAt(x, z) {
      const d = nearest(x, z).distance
      return Number.isFinite(d) ? smoothstep(halfWidth + 0.05, halfWidth, d) : 0
    },
  }
}
