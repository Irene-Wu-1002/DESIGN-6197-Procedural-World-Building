import * as THREE from 'three'
import { createRandom } from '../../utils/distributions'
import { buildHierarchy } from '../../utils/branching/hierarchy'
import { turnRandomly } from '../../utils/branching/common'
import { smoothGraph } from '../../utils/branching/sweep'

/**
 * The root system under one tree trunk, grown from the trunk's own seed, so
 * a tree has the same roots whenever they're rebuilt and nothing is stored.
 * It has two layers:
 *
 *   woody roots  drawn as smooth tubes. Structural roots leave the root
 *                flare (the first ones exactly at the trunk mesh's five
 *                flare lobes) just under the surface, mostly level,
 *                wandering a little and bending gently downward (depth
 *                bias). They fork often close to the trunk and less further
 *                out, so they are thick only in the first few tens of
 *                centimetres. Sinker roots go nearly straight down.
 *   fine roots   drawn as lines: thousands of short, thin strands that
 *                sprout along the woody roots, curve outward and droop
 *                down, so the roots read as a dense fibrous mass.
 *
 * The growth is the Topic 6 stochastic method, tuned for roots. Woody
 * thickness follows the pipe model (utils/branching/hierarchy.js), scaled so
 * each structural root starts at about a third of the trunk radius, thinning
 * further with distance from the trunk and to a point over each root's last
 * ~20 cm. The paths are smoothed into curves, and every point, thickness
 * included, is kept under the ground: roots never poke through the surface.
 *
 * Returns { segments: [{ start, end, depth }], tips, maxDepth, radii
 * (Float32Array per segment), hierarchy, fine: { positions, tints,
 * strandEnds }, center, reach }. Units are metres.
 */

export const DEFAULT_ROOTS = {
  roots: true,
  colors: 'reference',
  reach: 1.3,
  structural: 9,
  branching: 0.15,
  depthBias: 0.25,
  sinkers: 2,
  fine: 60,
}

const STEP = 0.015
const WANDER = 10 * (Math.PI / 180)
const SIDE_ANGLE = 40 * (Math.PI / 180)
// A side root lives this share of its parent's remaining steps.
const SIDE_LIFE = 0.6
const STOP_CHANCE = 0.004
// Within this distance of the trunk (m), roots fork this many times as often.
const NEAR_TRUNK = 0.4
const NEAR_FORKING = 3
// Structural roots stay mostly level; sinkers don't.
const FLATNESS = 0.7
const MAX_DEPTH = 0.6
const SINKER_LENGTH = [0.25, 0.55]
const FINE_RADIUS = 0.0006
// Every root thins to a point over its last this-many steps (~20 cm).
const TIP_TAPER_STEPS = 14
// Each structural root's base, as a share of the trunk radius.
const BASE_SHARE = 0.35
// Woody roots thin with distance from the trunk (m) down to this share.
const DISTANCE_THINNING = 0.35
const THIN_SHARE = 0.3
// Air gap kept between a root's top and the ground (m).
const CLEARANCE = 0.004
// The ground is sampled once per node of this grid (m) around the trunk;
// roots stay under the lowest node around them, so small bumps don't make
// them zig-zag.
const GROUND_CELL = 0.02
// Past this many growing tips, roots stop splitting (but keep growing), so
// every root still reaches its full length.
const MAX_GROWING = 400
const MAX_SEGMENTS = 60000
// The trunk mesh's flare lobes (cover/coverMeshes.js ROOT_LOBES).
const FLARE_LOBES = 5

// Fine roots: strands at fine = 100%, and each strand's shape.
const MAX_FINE = 5000
const FINE_STEP = 0.015
const FINE_STEPS = [4, 16]
const FINE_WANDER = 25 * (Math.PI / 180)
const FINE_DROOP = 0.12
const FINE_FORK = 0.35

const DOWN = new THREE.Vector3(0, -1, 0)

/**
 * The ground under a root system, sampled lazily on a grid around the
 * trunk (sampling the height field is most of the growth's cost).
 * below(x, z, span): the lowest node within `span` nodes of the point.
 */
function createLocalGround(height, centerX, centerZ, radius) {
  const size = Math.ceil((radius * 2) / GROUND_CELL) + 1
  const originX = centerX - radius
  const originZ = centerZ - radius
  const nodes = new Float32Array(size * size).fill(NaN)
  const node = (i, j) => {
    if (i < 0 || j < 0 || i >= size || j >= size) return height(originX + i * GROUND_CELL, originZ + j * GROUND_CELL)
    const index = j * size + i
    if (Number.isNaN(nodes[index])) nodes[index] = height(originX + i * GROUND_CELL, originZ + j * GROUND_CELL)
    return nodes[index]
  }
  return {
    below(x, z, span) {
      const i = Math.round((x - originX) / GROUND_CELL)
      const j = Math.round((z - originZ) / GROUND_CELL)
      let lowest = Infinity
      for (let dj = -span; dj <= span; dj += 1) {
        for (let di = -span; di <= span; di += 1) lowest = Math.min(lowest, node(i + di, j + dj))
      }
      return lowest
    },
  }
}

/**
 * trunk: { x, z, radius, seed }; height(x, z): ground height (m);
 * settings: DEFAULT_ROOTS.
 */
export function growRoots(trunk, height, settings) {
  const random = createRandom(trunk.seed * 7 + 13)
  const steps = Math.round(settings.reach / STEP)
  const baseRadius = trunk.radius * BASE_SHARE
  // The trunk mesh is turned by (seed mod 360)° about +y; its lobes sit at
  // local angles k·72°, which that turn moves to k·72° − turn in the world.
  const turn = (trunk.seed % 360) * (Math.PI / 180)
  const fromTrunk = (point) => Math.hypot(point.x - trunk.x, point.z - trunk.z)
  const ground = createLocalGround(height, trunk.x, trunk.z, settings.reach + 0.5)

  const segments = []
  const rootOf = []
  let active = []

  for (let index = 0; index < settings.structural; index += 1) {
    const angle =
      index < FLARE_LOBES
        ? (index / FLARE_LOBES) * Math.PI * 2 - turn
        : ((index - FLARE_LOBES + 0.5) / FLARE_LOBES) * Math.PI * 2 - turn + (random() - 0.5) * 0.4
    const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
    const x = trunk.x + out.x * trunk.radius * 0.8
    const z = trunk.z + out.z * trunk.radius * 0.8
    const start = new THREE.Vector3(x, height(x, z) - baseRadius - 0.01, z)
    const dir = out.clone().addScaledVector(DOWN, 0.1 + random() * 0.25).normalize()
    active.push({ position: start, dir, life: steps * (0.75 + random() * 0.25), root: index, flat: FLATNESS })
  }
  for (let index = 0; index < settings.sinkers; index += 1) {
    const angle = random() * Math.PI * 2
    const offset = trunk.radius * 0.5 * random()
    const x = trunk.x + Math.cos(angle) * offset
    const z = trunk.z + Math.sin(angle) * offset
    const length = SINKER_LENGTH[0] + random() * (SINKER_LENGTH[1] - SINKER_LENGTH[0])
    active.push({
      position: new THREE.Vector3(x, height(x, z) - 0.12, z),
      dir: DOWN.clone(),
      life: length / STEP,
      root: settings.structural + index,
      flat: 0,
    })
  }

  // Side roots split off more often near the trunk than at the tips.
  const tips = []
  for (let step = 0; active.length && segments.length < MAX_SEGMENTS; step += 1) {
    const next = []
    for (const tip of active) {
      if (tip.life <= 0 || (step > 0 && random() < STOP_CHANCE)) {
        tips.push(tip.position)
        continue
      }
      const dir = turnRandomly(tip.dir, random() * WANDER, random)
      if (tip.flat > 0) {
        dir.addScaledVector(DOWN, settings.depthBias * 0.06)
        dir.y *= 1 - tip.flat
      }
      dir.normalize()
      const end = tip.position.clone().addScaledVector(dir, STEP)
      // Deep down the soil gets too hard: level off.
      const floor = ground.below(end.x, end.z, 0) - MAX_DEPTH
      if (end.y < floor) {
        end.y = floor
        dir.y = Math.max(dir.y, 0)
        dir.normalize()
      }
      segments.push({ start: tip.position, end, depth: step })
      rootOf.push(tip.root)
      next.push({ ...tip, position: end, dir, life: tip.life - 1 })

      const crowded = active.length + next.length >= MAX_GROWING
      const forking = fromTrunk(end) < NEAR_TRUNK ? NEAR_FORKING : 1
      if (!crowded && random() < (settings.branching * forking * tip.life) / steps) {
        const side = turnRandomly(dir, SIDE_ANGLE, random)
        if (tip.flat > 0) side.y *= 1 - tip.flat
        next.push({ ...tip, position: end, dir: side.normalize(), life: tip.life * SIDE_LIFE })
      }
    }
    active = next
  }
  active.forEach((tip) => tips.push(tip.position))

  // Pipe model, scaled per root so each structural root starts at its base
  // radius (sinkers a little thinner).
  const hierarchy = buildHierarchy(segments)
  const rootTips = new Float32Array(settings.structural + settings.sinkers)
  segments.forEach((segment, index) => {
    if (hierarchy.parent[index] < 0) rootTips[rootOf[index]] = hierarchy.tipsFed[index]
  })
  // Steps from each segment to the furthest tip beyond it. Segments were
  // made step by step, so walking them backwards meets children first.
  const beyond = new Float32Array(segments.length)
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const parent = hierarchy.parent[index]
    if (parent >= 0) beyond[parent] = Math.max(beyond[parent], beyond[index] + 1)
  }
  const radii = new Float32Array(segments.length)
  segments.forEach((segment, index) => {
    const root = rootOf[index]
    const base = root < settings.structural ? baseRadius : baseRadius * 0.6
    const pipe = base * Math.sqrt(hierarchy.tipsFed[index] / Math.max(rootTips[root], 1))
    const thinning = THIN_SHARE + (1 - THIN_SHARE) * Math.exp(-fromTrunk(segment.end) / DISTANCE_THINNING)
    const taper = Math.min(1, beyond[index] / TIP_TAPER_STEPS)
    radii[index] = Math.max(FINE_RADIUS, pipe * thinning * taper)
  })

  // Smooth the random walk into curves, then keep every root, thickness
  // included, under the ground. Points are shared between a segment and its
  // children, so moving one moves both.
  smoothGraph(segments, 3, 0.5)
  const thickest = new Map()
  segments.forEach((segment, index) => {
    for (const point of [segment.start, segment.end]) {
      thickest.set(point, Math.max(thickest.get(point) ?? 0, radii[index]))
    }
  })
  for (const [point, radius] of thickest) {
    point.y = Math.min(point.y, ground.below(point.x, point.z, 2) - radius - CLEARANCE)
  }

  const fine = growFineRoots(segments, radii, trunk, ground, settings, random)
  const maxDepth = segments.reduce((max, segment) => Math.max(max, segment.depth), 0)
  return {
    segments,
    tips,
    maxDepth,
    radii,
    hierarchy,
    fine,
    center: new THREE.Vector3(trunk.x, height(trunk.x, trunk.z), trunk.z),
    reach: settings.reach,
  }
}

/**
 * The fine roots: strands from random points along the woody roots, each a
 * short random walk that leans away from the trunk and droops downward,
 * sometimes forking once. Strands come in random order, so drawing the
 * first part of them is an even thinning (a level of detail).
 *
 * Returns { positions (line-segment pairs), tints (0 at the woody root – 1
 * at the strand's tip, per vertex), kinds (0 warm / 1 cool, per vertex),
 * strandEnds (vertex count after each strand) }.
 */
function growFineRoots(segments, radii, trunk, ground, settings, random) {
  const count = segments.length ? Math.round((settings.fine / 100) * MAX_FINE) : 0
  const positions = []
  const tints = []
  const kinds = []
  const strandEnds = []
  const dir = new THREE.Vector3()
  const away = new THREE.Vector3()

  const walk = (from, heading, length, kind, tintStart) => {
    const point = from.clone()
    dir.copy(heading)
    for (let step = 0; step < length; step += 1) {
      const next = turnRandomly(dir, random() * FINE_WANDER, random)
        .addScaledVector(DOWN, FINE_DROOP)
        .normalize()
      dir.copy(next)
      const end = point.clone().addScaledVector(dir, FINE_STEP)
      end.y = Math.min(end.y, ground.below(end.x, end.z, 1) - CLEARANCE)
      positions.push(point.x, point.y, point.z, end.x, end.y, end.z)
      const t = tintStart + (1 - tintStart) * (step / length)
      tints.push(t, tintStart + (1 - tintStart) * ((step + 1) / length))
      kinds.push(kind, kind)
      point.copy(end)
    }
  }

  for (let strand = 0; strand < count; strand += 1) {
    const index = Math.floor(random() * segments.length)
    const { start, end } = segments[index]
    const from = start.clone().lerp(end, random())
    // Lean outward from the trunk, a little sideways and down.
    away.set(from.x - trunk.x, 0, from.z - trunk.z).normalize()
    const heading = turnRandomly(away, (random() * 70 * Math.PI) / 180, random)
      .addScaledVector(DOWN, 0.3 + random() * 0.6)
      .normalize()
    from.addScaledVector(heading, radii[index])
    const length = Math.round(FINE_STEPS[0] + random() * (FINE_STEPS[1] - FINE_STEPS[0]))
    const kind = random() < 0.45 ? 1 : 0
    walk(from, heading, length, kind, 0)
    if (random() < FINE_FORK) {
      // Fork from a point part-way along the strand just grown.
      const back = Math.floor(length * (0.3 + random() * 0.4))
      const at = positions.length - (length - back) * 6
      const fork = new THREE.Vector3(positions[at], positions[at + 1], positions[at + 2])
      walk(fork, turnRandomly(dir, 0.8, random), Math.round(length * 0.5), kind, back / length)
    }
    strandEnds.push(positions.length / 3)
  }
  return {
    positions: new Float32Array(positions),
    tints: new Float32Array(tints),
    kinds: new Float32Array(kinds),
    strandEnds: Uint32Array.from(strandEnds),
  }
}
