import * as THREE from 'three'
import { createRandom } from '../../utils/distributions'
import { buildHierarchy } from '../../utils/branching/hierarchy'
import { turnRandomly } from '../../utils/branching/common'

/**
 * The root system under one tree trunk, grown from the trunk's own seed, so
 * a tree has the same roots whenever they're rebuilt and nothing is stored.
 *
 *   structural roots  leave the root flare (the first ones exactly at the
 *                     trunk mesh's five flare lobes) just under the
 *                     surface, mostly horizontal, wandering a little,
 *                     bending gently downward (depth bias), and splitting
 *                     into side roots that live shorter the further out
 *                     they start, so roots fan out toward their tips
 *   sinker roots      go nearly straight down from under the trunk
 *
 * The growth is the Topic 6 stochastic method, tuned for roots. Thickness
 * follows the pipe model (utils/branching/hierarchy.js): a root carries all
 * the fine roots beyond it, so radius ∝ √(tips fed), scaled so each
 * structural root starts at about a third of the trunk radius, and every
 * root also thins to a fine point over its last ~20 cm. Finally every
 * point is pushed down until the root, thickness included, stays under the
 * ground: roots never poke through the surface.
 *
 * Returns { segments: [{ start, end, depth }], tips, maxDepth, radii
 * (Float32Array per segment), hierarchy, center, reach }. Units are metres.
 */

export const DEFAULT_ROOTS = {
  roots: true,
  reach: 1.5,
  structural: 6,
  branching: 0.2,
  depthBias: 0.2,
  sinkers: 2,
}

const STEP = 0.015
const WANDER = 10 * (Math.PI / 180)
const SIDE_ANGLE = 45 * (Math.PI / 180)
// A side root lives this share of its parent's remaining steps.
const SIDE_LIFE = 0.55
const STOP_CHANCE = 0.004
// Structural roots stay mostly level; sinkers don't.
const FLATNESS = 0.7
const MAX_DEPTH = 0.6
const SINKER_LENGTH = [0.25, 0.55]
const FINE_RADIUS = 0.0006
// Every root thins to a point over its last this-many steps (~20 cm).
const TIP_TAPER_STEPS = 14
// Each structural root's base, as a share of the trunk radius.
const BASE_SHARE = 0.35
// Air gap kept between a root's top and the ground (m).
const CLEARANCE = 0.003
// Past this many growing tips, roots stop splitting (but keep growing), so
// every root still reaches its full length.
const MAX_GROWING = 400
const MAX_SEGMENTS = 60000
// The trunk mesh's flare lobes (cover/coverMeshes.js ROOT_LOBES).
const FLARE_LOBES = 5

const DOWN = new THREE.Vector3(0, -1, 0)

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

  const segments = []
  const rootOf = []
  let active = []

  for (let index = 0; index < settings.structural; index += 1) {
    const angle =
      index < FLARE_LOBES
        ? (index / FLARE_LOBES) * Math.PI * 2 - turn
        : ((index - FLARE_LOBES + 0.5) / FLARE_LOBES) * Math.PI * 2 - turn + (random() - 0.5) * 0.4
    const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
    const x = trunk.x + out.x * trunk.radius
    const z = trunk.z + out.z * trunk.radius
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
      const floor = height(end.x, end.z) - MAX_DEPTH
      if (end.y < floor) {
        end.y = floor
        dir.y = Math.max(dir.y, 0)
        dir.normalize()
      }
      segments.push({ start: tip.position, end, depth: step })
      rootOf.push(tip.root)
      next.push({ ...tip, position: end, dir, life: tip.life - 1 })

      const crowded = active.length + next.length >= MAX_GROWING
      if (!crowded && random() < (settings.branching * tip.life) / steps) {
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
  segments.forEach((_, index) => {
    const root = rootOf[index]
    const base = root < settings.structural ? baseRadius : baseRadius * 0.6
    const pipe = base * Math.sqrt(hierarchy.tipsFed[index] / Math.max(rootTips[root], 1))
    const taper = Math.min(1, beyond[index] / TIP_TAPER_STEPS)
    radii[index] = Math.max(FINE_RADIUS, pipe * taper)
  })

  // Keep every root, thickness included, under the ground. Points are
  // shared between a segment and its children, so moving one moves both.
  const thickest = new Map()
  segments.forEach((segment, index) => {
    for (const point of [segment.start, segment.end]) {
      thickest.set(point, Math.max(thickest.get(point) ?? 0, radii[index]))
    }
  })
  for (const [point, radius] of thickest) {
    point.y = Math.min(point.y, height(point.x, point.z) - radius - CLEARANCE)
  }

  const maxDepth = segments.reduce((max, segment) => Math.max(max, segment.depth), 0)
  return {
    segments,
    tips,
    maxDepth,
    radii,
    hierarchy,
    center: new THREE.Vector3(trunk.x, height(trunk.x, trunk.z), trunk.z),
    reach: settings.reach,
  }
}
