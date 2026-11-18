import { agaricSpot } from '../cover/flyAgaric'
import { antHills } from '../terrain/antHills'
import { ANT_HILL, hash } from '../terrain/heightField'
import { DEFAULT_STREAM } from '../terrain/stream'

/**
 * The ant trail: a worn strip of ground from the ant hill to the fly
 * agaric, along a Catmull-Rom spline. It starts at the tunnel entrance
 * facing the agaric and ends at its stem; trail curvature swings the three
 * middle control points sideways (seeded). Depends only on the seed and the
 * Paths settings, like the rest of the world.
 *
 * Also here: the Paths settings (DEFAULT_PATHS) and the tunnel entrances,
 * shared by the trail, the ants' world, and the exclusion zones.
 *
 * Plain data only, no Three.js.
 */

export const DEFAULT_PATHS = {
  // Ant trail: width (cm), curvature, darkness (%), compression (mm), how
  // cleared of litter it is, and fine crumbs on its surface (%).
  showTrail: true,
  trailWidth: 1.2,
  trailCurvature: 40,
  trailDarkness: 50,
  compression: 1,
  clearing: 70,
  detail: 40,
  // Pheromones: shown in every view (not just the ant's), strength and
  // ribbon width (%).
  showPheromones: false,
  pheromoneIntensity: 70,
  pheromoneWidth: 100,
  // Ant colony (ants/colony.js): agents on (off: the seeded scent ribbons),
  // how many, simulation speed (×), scent half-life (s), diffusion (%),
  // sensor angle (°) and distance (cm), wander and slope avoidance (%),
  // and how often ants walk the tunnels between nests (%).
  antAgents: true,
  colonySize: 50,
  simSpeed: 1,
  scentHalfLife: 40,
  diffusion: 35,
  sensorAngle: 40,
  sensorDistance: 2.5,
  wander: 25,
  slopeAvoidance: 50,
  tunnelTraffic: 50,
  // Exclusion zones (cm): beyond the mound's edge, around the agaric's
  // stem, around the start view, beyond the trail's edge, around tunnel
  // entrances; and the soft edge where small things fade back in.
  antHillClearance: 1,
  agaricClearance: 6,
  spawnClearance: 3,
  trailClearance: 0.5,
  interactionClearance: 1.5,
  softEdge: 3,
  // The stream (terrain/stream.js).
  ...DEFAULT_STREAM,
}

// Tunnel entrances: one in the crater, a few on the mound's sides. The
// satellite nests are smaller, with fewer side entrances.
const ENTRANCE = { main: 0.006, side: 0.0035, sideCount: 3, distance: [0.035, 0.06] }
const SATELLITE_ENTRANCE = { main: 0.005, side: 0.0035, sideCount: [1, 2], distance: [0.018, 0.03] }
const ENTRANCE_SALT = 4401
// The trail stops this far short of the agaric's centre (its stem).
const STEM_GAP = 0.012
// Sideways swing of the middle control points at 100% curvature (share of
// the trail's length), and the resampled point spacing (m).
const SWING = 0.35
const STEP = 0.002
const SALT = 4501

/**
 * Tunnel entrances [{ x, z, radius, hill, main }] for this seed: the main
 * hill's first (its crater first), then each satellite nest's, for the
 * first `nests` nests (terrain/antHills.js). hill: the nest's index; main:
 * the crater entrance.
 */
export function antHillEntrances(seed, nests = 1) {
  const entrances = []
  for (const hill of antHills(seed, nests)) {
    const spec = hill.main ? ENTRANCE : SATELLITE_ENTRANCE
    entrances.push({ x: hill.x, z: hill.z, radius: spec.main, hill: hill.index, main: true })
    // The main hill keeps its old hashes, so its entrances never move.
    const salt = ENTRANCE_SALT + hill.index * 97
    const sides = hill.main
      ? ENTRANCE.sideCount
      : spec.sideCount[0] + Math.floor(hash(seed, 5, salt) * (spec.sideCount[1] - spec.sideCount[0] + 1))
    const turn = hash(seed, 1, salt) * Math.PI * 2
    for (let k = 0; k < sides; k += 1) {
      const angle = turn + (k / sides) * Math.PI * 2 + (hash(seed, 10 + k, salt) - 0.5) * 0.8
      const d = spec.distance[0] + hash(seed, 20 + k, salt) * (spec.distance[1] - spec.distance[0])
      entrances.push({
        x: hill.x + Math.cos(angle) * d,
        z: hill.z + Math.sin(angle) * d,
        radius: spec.side,
        hill: hill.index,
        main: false,
      })
    }
  }
  return entrances
}

/** The main hill's side entrance facing (x, z), or its crater if it has none. */
export function entranceFacing(entrances, x, z) {
  const heading = Math.atan2(z - ANT_HILL.z, x - ANT_HILL.x)
  const own = entrances.filter((entrance) => (entrance.hill ?? 0) === 0)
  let found = own[0]
  let best = Infinity
  for (const entrance of own.slice(1)) {
    const angle = Math.atan2(entrance.z - ANT_HILL.z, entrance.x - ANT_HILL.x)
    const gap = Math.abs(Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading)))
    if (gap < best) {
      best = gap
      found = entrance
    }
  }
  return found
}

const catmullRom = (p0, p1, p2, p3, t) => {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

/**
 * The trail for this seed and Paths settings, or null (no trail shown, no
 * ant hill, or no fly agaric). Returns { points, lengths, count, length,
 * halfWidth, compression, clearing, darkness, detail, distanceTo(x, z),
 * maskAt(x, z) }.
 */
export function createAntTrail({ seed, paths, antHill, agaric }) {
  if (!paths.showTrail || !antHill || !agaric) return null
  const end0 = agaricSpot(seed)
  const start = entranceFacing(antHillEntrances(seed), end0.x, end0.z)
  // Stop at the stem, not its centre.
  const toHill = Math.hypot(end0.x - start.x, end0.z - start.z) || 1
  const end = {
    x: end0.x - ((end0.x - start.x) / toHill) * STEM_GAP,
    z: end0.z - ((end0.z - start.z) / toHill) * STEM_GAP,
  }
  const length = Math.hypot(end.x - start.x, end.z - start.z) || 1
  const px = -(end.z - start.z) / length
  const pz = (end.x - start.x) / length
  const swing = (paths.trailCurvature / 100) * SWING * length
  const control = [start]
  for (let k = 1; k <= 3; k += 1) {
    const t = k / 4
    // Ends swing less than the middle, so the trail leaves and arrives cleanly.
    const offset = swing * (hash(seed, k, SALT) * 2 - 1) * (k === 2 ? 1 : 0.7)
    control.push({ x: start.x + (end.x - start.x) * t + px * offset, z: start.z + (end.z - start.z) * t + pz * offset })
  }
  control.push(end)
  const padded = [control[0], ...control, control[control.length - 1]]

  // Dense samples along the spline, then even spacing by arc length.
  const dense = []
  for (let i = 1; i < padded.length - 2; i += 1) {
    for (let k = 0; k < 64; k += 1) {
      const t = k / 64
      dense.push(
        catmullRom(padded[i - 1].x, padded[i].x, padded[i + 1].x, padded[i + 2].x, t),
        catmullRom(padded[i - 1].z, padded[i].z, padded[i + 1].z, padded[i + 2].z, t)
      )
    }
  }
  dense.push(end.x, end.z)
  const denseLengths = [0]
  for (let i = 2; i < dense.length; i += 2) {
    denseLengths.push(denseLengths.at(-1) + Math.hypot(dense[i] - dense[i - 2], dense[i + 1] - dense[i - 1]))
  }
  const total = denseLengths.at(-1)
  const count = Math.max(Math.ceil(total / STEP), 1) + 1
  const points = new Float32Array(count * 2)
  const lengths = new Float32Array(count)
  let j = 0
  for (let i = 0; i < count; i += 1) {
    const s = (i / (count - 1)) * total
    while (j < denseLengths.length - 2 && denseLengths[j + 1] < s) j += 1
    const span = denseLengths[j + 1] - denseLengths[j] || 1
    const t = Math.min(Math.max((s - denseLengths[j]) / span, 0), 1)
    points[i * 2] = dense[j * 2] + (dense[j * 2 + 2] - dense[j * 2]) * t
    points[i * 2 + 1] = dense[j * 2 + 1] + (dense[j * 2 + 3] - dense[j * 2 + 1]) * t
    lengths[i] = s
  }

  const halfWidth = paths.trailWidth / 200
  // Bounding box for quick rejection.
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

  /** Metres from (x, z) to the trail's centre line (Infinity if beyond `reach`). */
  const distanceTo = (x, z, reach = Infinity) => {
    if (x < minX - reach || x > maxX + reach || z < minZ - reach || z > maxZ + reach) return Infinity
    let best = Infinity
    for (let i = 0; i < count - 1; i += 1) {
      const ax = points[i * 2]
      const az = points[i * 2 + 1]
      const dx = points[i * 2 + 2] - ax
      const dz = points[i * 2 + 3] - az
      const t = Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0), 1)
      best = Math.min(best, (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2)
    }
    return Math.sqrt(best)
  }

  return {
    points,
    lengths,
    count,
    length: total,
    halfWidth,
    compression: paths.compression / 1000,
    clearing: paths.clearing / 100,
    darkness: paths.trailDarkness / 100,
    detail: paths.detail / 100,
    distanceTo,
    /** 0–1: how much (x, z) is on the worn strip (soft shoulder). */
    maskAt(x, z) {
      const d = distanceTo(x, z, halfWidth * 1.4)
      if (!Number.isFinite(d)) return 0
      const t = Math.min(Math.max((d - halfWidth * 0.6) / (halfWidth * 0.8), 0), 1)
      return 1 - t * t * (3 - 2 * t)
    },
  }
}
