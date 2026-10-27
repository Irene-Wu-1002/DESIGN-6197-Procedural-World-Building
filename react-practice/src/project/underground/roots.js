import * as THREE from 'three'
import { createRandom } from '../../utils/distributions'
import { buildHierarchy } from '../../utils/branching/hierarchy'
import { turnRandomly } from '../../utils/branching/common'
import { smoothGraph } from '../../utils/branching/sweep'

/**
 * The root system under one tree trunk, grown from the trunk's own seed, so
 * a tree has the same roots whenever they're rebuilt and nothing is stored.
 * Shaped like a broadleaf's heart root system, about as deep as it is wide:
 *
 *   surface roots  leave the trunk's flare lobes and run over the ground,
 *                  their top half showing, thinning as they go, then dive
 *                  into the soil and carry on down. Small roots drop from
 *                  them. Grown on their own (growSurfaceRoots), because
 *                  they show in the normal view too.
 *   deep roots     start under the trunk and plunge steeply (Steepness),
 *                  forking into smaller roots that also head down, levelling
 *                  off at the root depth.
 *   fine roots     short thin strands hanging down from the thinner woody
 *                  roots, drawn as lines.
 *
 * Woody roots carry their own radius: each thins toward its planned end,
 * and a fork takes some of its parent's cross-section (the pipe model at
 * every fork). Paths are smoothed into curves; underground points stay
 * under the ground, thickness included, and surface roots sit exactly at
 * their planned depth in the ground, so nothing floats.
 *
 * growRoots returns the deep roots and the fine roots: { segments, radii,
 * hierarchy, maxDepth, fine: { positions, tints, kinds, strandEnds },
 * center, reach }; growSurfaceRoots returns the same without `fine`.
 * Units are metres.
 */

export const DEFAULT_ROOTS = {
  roots: true,
  colors: 'natural',
  surface: 5,
  deep: 6,
  steepness: 0.6,
  rootDepth: 1,
  reach: 1.2,
  branching: 0.25,
  fine: 40,
}

const STEP = 0.015
const WANDER = 9 * (Math.PI / 180)
const FORK_ANGLE = 35 * (Math.PI / 180)
const FINE_RADIUS = 0.0008
// Starting radius, as a share of the trunk radius.
const SURFACE_SHARE = [0.2, 0.32]
const DEEP_SHARE = [0.22, 0.38]
// radius = start × (1 − progress)^TAPER: thick for a while, then thinning.
const TAPER = 0.7
// A fork's radius, as a share of its parent's, and its share of the
// parent's remaining length.
const FORK_RADIUS = [0.35, 0.65]
const FORK_LENGTH = [0.45, 0.8]
// How far a deep root dives below horizontal: Steepness 0 – 1 maps to these.
const ANGLE_RANGE = [15 * (Math.PI / 180), 72 * (Math.PI / 180)]
// How quickly a root turns to its dive angle (per step).
const GRAVITROPISM = 0.12
// Surface roots: how far their centre sits under the ground, in radii,
// near the trunk (mostly showing) and once they have dived in.
const SURFACE_SINK = [0.15, 1.6]
// Share of a surface root's run spent above ground before it dives.
const SURFACE_RUN = 0.75
// Air gap kept between an underground root's top and the ground (m).
const CLEARANCE = 0.004
// The ground is sampled once per node of this grid (m) around the trunk;
// roots stay under the lowest node around them, so small bumps don't make
// them zig-zag.
const GROUND_CELL = 0.02
// Past this many growing tips, roots stop forking (but keep growing).
const MAX_GROWING = 300
const MAX_SEGMENTS = 40000
// The trunk mesh's flare lobes (cover/coverMeshes.js ROOT_LOBES).
const FLARE_LOBES = 5

// Fine roots: strands at fine = 100%, and each strand's shape. They grow
// only from woody roots thinner than FINE_FROM.
const MAX_FINE = 2500
const FINE_FROM = 0.02
const FINE_STEP = 0.015
const FINE_STEPS = [4, 16]
const FINE_WANDER = 20 * (Math.PI / 180)
const FINE_DROOP = 0.3
const FINE_FORK = 0.3

const DOWN = new THREE.Vector3(0, -1, 0)
const between = ([low, high], random) => low + random() * (high - low)

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

const radiusAt = (tip, k) => Math.max(FINE_RADIUS, tip.start * (1 - Math.min(k / tip.length, 1)) ** TAPER)

function diveAngle(settings, random) {
  const base = ANGLE_RANGE[0] + (ANGLE_RANGE[1] - ANGLE_RANGE[0]) * settings.steepness
  return THREE.MathUtils.clamp(base + (random() - 0.5) * 0.35, 0, Math.PI / 2 - 0.05)
}

/**
 * Grow tips step by step. A tip: { position, dir, start (radius), k,
 * length (steps), kind: 'surface' | 'deep', angle (dive, rad) }.
 * Returns { segments, radii, sinks } (sinks: Map point → how far a surface
 * point's centre sits under the ground, in radii).
 */
function growTips(tips, ground, settings, random) {
  const segments = []
  const radii = []
  const sinks = new Map()
  for (const tip of tips) if (tip.kind === 'surface') sinks.set(tip.position, SURFACE_SINK[0])
  const floorDepth = settings.rootDepth * 1.1
  let active = tips
  for (let step = 0; active.length && segments.length < MAX_SEGMENTS; step += 1) {
    const next = []
    for (const tip of active) {
      if (tip.k >= tip.length) continue
      const dir = turnRandomly(tip.dir, random() * WANDER, random)
      const end = new THREE.Vector3()
      const radius = radiusAt(tip, tip.k + 1)
      if (tip.kind === 'surface') {
        // Run along the ground, sinking in toward the end of the run.
        dir.y = 0
        dir.normalize()
        end.copy(tip.position).addScaledVector(dir, STEP)
        const dive = THREE.MathUtils.smoothstep(tip.k / tip.length, SURFACE_RUN * 0.6, SURFACE_RUN)
        const sink = SURFACE_SINK[0] + (SURFACE_SINK[1] - SURFACE_SINK[0]) * dive
        end.y = ground.below(end.x, end.z, 1) - radius * sink
        sinks.set(end, sink)
      } else {
        // Turn toward the dive angle (gravitropism).
        dir.y += (-Math.sin(tip.angle) - dir.y) * GRAVITROPISM
        dir.normalize()
        end.copy(tip.position).addScaledVector(dir, STEP)
        const floor = ground.below(end.x, end.z, 0) - floorDepth
        if (end.y < floor) {
          // The soil gets too hard: level off.
          end.y = floor
          dir.y = Math.max(dir.y, 0)
          dir.normalize()
          tip.angle = 0
        }
      }
      segments.push({ start: tip.position, end, depth: step })
      radii.push(radius)
      const grown = { ...tip, position: end, dir, k: tip.k + 1 }
      // A surface root that has dived carries on down as a deep root.
      if (tip.kind === 'surface' && grown.k >= tip.length * SURFACE_RUN) {
        Object.assign(grown, {
          kind: 'deep',
          start: radius,
          k: 0,
          length: Math.round((settings.rootDepth * 0.6) / STEP),
          dir: dir.clone().addScaledVector(DOWN, 0.6).normalize(),
        })
      }
      next.push(grown)

      // Fork: more often while the root is thick.
      const crowded = active.length + next.length >= MAX_GROWING
      const remaining = grown.length - grown.k
      if (!crowded && remaining > 6 && random() < settings.branching * 0.08 * (radius / tip.start + 0.3)) {
        const childRadius = radius * between(FORK_RADIUS, random)
        // The parent keeps the rest of the cross-section.
        grown.start *= Math.sqrt(1 - (childRadius / radius) ** 2)
        next.push({
          position: end,
          dir: turnRandomly(dir, FORK_ANGLE, random).addScaledVector(DOWN, 0.3).normalize(),
          start: childRadius,
          k: 0,
          length: Math.max(4, Math.round(remaining * between(FORK_LENGTH, random))),
          kind: 'deep',
          angle: diveAngle(settings, random) + 0.15,
        })
      }
    }
    active = next
  }
  return { segments, radii, sinks }
}

/** Smooth, settle into the ground, and add the hierarchy. */
function finish({ segments, radii, sinks }, trunk, height, ground, settings) {
  smoothGraph(segments, 3, 0.5)
  // Each point's thickest root.
  const thickest = new Map()
  segments.forEach((segment, index) => {
    for (const point of [segment.start, segment.end]) {
      thickest.set(point, Math.max(thickest.get(point) ?? 0, radii[index]))
    }
  })
  for (const [point, radius] of thickest) {
    const sink = sinks.get(point)
    if (sink !== undefined) point.y = ground.below(point.x, point.z, 1) - radius * sink
    else point.y = Math.min(point.y, ground.below(point.x, point.z, 2) - radius - CLEARANCE)
  }
  return {
    segments,
    radii: Float32Array.from(radii),
    hierarchy: buildHierarchy(segments),
    maxDepth: segments.reduce((max, segment) => Math.max(max, segment.depth), 0),
    center: new THREE.Vector3(trunk.x, height(trunk.x, trunk.z), trunk.z),
    reach: settings.reach,
  }
}

// The trunk mesh is turned by (seed mod 360)° about +y; its lobes sit at
// local angles k·72°, which that turn moves to k·72° − turn in the world.
function lobeAngle(trunk, index, random) {
  const turn = (trunk.seed % 360) * (Math.PI / 180)
  return index < FLARE_LOBES
    ? (index / FLARE_LOBES) * Math.PI * 2 - turn
    : ((index - FLARE_LOBES + 0.5) / FLARE_LOBES) * Math.PI * 2 - turn + (random() - 0.5) * 0.4
}

function growSurface(trunk, ground, settings) {
  const random = createRandom(trunk.seed * 7 + 13)
  const tips = []
  for (let index = 0; index < settings.surface; index += 1) {
    const angle = lobeAngle(trunk, index, random)
    const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
    const x = trunk.x + out.x * trunk.radius * 0.85
    const z = trunk.z + out.z * trunk.radius * 0.85
    const start = trunk.radius * between(SURFACE_SHARE, random)
    tips.push({
      position: new THREE.Vector3(x, ground.below(x, z, 1) - start * SURFACE_SINK[0], z),
      dir: out,
      start,
      k: 0,
      length: Math.round((settings.reach * between([0.5, 1], random)) / STEP),
      kind: 'surface',
      angle: diveAngle(settings, random),
    })
  }
  return growTips(tips, ground, settings, random)
}

/** The exposed surface roots (and what they grow into underground). */
export function growSurfaceRoots(trunk, height, settings) {
  const ground = createLocalGround(height, trunk.x, trunk.z, settings.reach + 0.5)
  return finish(growSurface(trunk, ground, settings), trunk, height, ground, settings)
}

/** The deep roots, and the fine roots (from the deep and surface roots). */
export function growRoots(trunk, height, settings) {
  const ground = createLocalGround(height, trunk.x, trunk.z, settings.reach + 0.5)
  const random = createRandom(trunk.seed * 11 + 5)
  const tips = []
  for (let index = 0; index < settings.deep; index += 1) {
    const heading = ((index + random() * 0.6) / settings.deep) * Math.PI * 2
    const out = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading))
    const angle = diveAngle(settings, random)
    const x = trunk.x + out.x * trunk.radius * 0.4
    const z = trunk.z + out.z * trunk.radius * 0.4
    tips.push({
      position: new THREE.Vector3(x, ground.below(x, z, 1) - 0.12, z),
      dir: out.clone().multiplyScalar(Math.cos(angle)).addScaledVector(DOWN, Math.sin(angle)).normalize(),
      start: trunk.radius * between(DEEP_SHARE, random),
      k: 0,
      length: Math.round(Math.min(settings.rootDepth / Math.max(Math.sin(angle), 0.4), settings.reach * 1.6) / STEP),
      kind: 'deep',
      angle,
    })
  }
  const deep = finish(growTips(tips, ground, settings, random), trunk, height, ground, settings)
  // Fine roots also hang from the surface roots' buried ends (grown again
  // here; it's cheap).
  const surface = finish(growSurface(trunk, ground, settings), trunk, height, ground, settings)
  deep.fine = growFineRoots([deep, surface], ground, settings, random)
  return deep
}

/**
 * The fine roots: strands from random points along the thinner woody roots
 * (underground only), each a short random walk that hangs downward,
 * sometimes forking once. Strands come in random order, so drawing the
 * first part of them is an even thinning (a level of detail).
 *
 * Returns { positions (line-segment pairs), tints (0 at the woody root – 1
 * at the strand's tip, per vertex), kinds (0 / 1, two colour families, per
 * vertex), strandEnds (vertex count after each strand) }.
 */
function growFineRoots(systems, ground, settings, random) {
  const hosts = []
  for (const { segments, radii } of systems) {
    segments.forEach((segment, index) => {
      const { end } = segment
      if (radii[index] < FINE_FROM && end.y < ground.below(end.x, end.z, 0) - 0.02) hosts.push([segment, radii[index]])
    })
  }
  const count = hosts.length ? Math.round((settings.fine / 100) * MAX_FINE) : 0
  const positions = []
  const tints = []
  const kinds = []
  const strandEnds = []
  const dir = new THREE.Vector3()

  const walk = (from, heading, length, kind, tintStart) => {
    const point = from.clone()
    dir.copy(heading)
    for (let step = 0; step < length; step += 1) {
      dir.copy(turnRandomly(dir, random() * FINE_WANDER, random).addScaledVector(DOWN, FINE_DROOP).normalize())
      const end = point.clone().addScaledVector(dir, FINE_STEP)
      end.y = Math.min(end.y, ground.below(end.x, end.z, 1) - CLEARANCE)
      positions.push(point.x, point.y, point.z, end.x, end.y, end.z)
      tints.push(tintStart + (1 - tintStart) * (step / length), tintStart + (1 - tintStart) * ((step + 1) / length))
      kinds.push(kind, kind)
      point.copy(end)
    }
  }

  for (let strand = 0; strand < count; strand += 1) {
    const [{ start, end }, radius] = hosts[Math.floor(random() * hosts.length)]
    const from = start.clone().lerp(end, random())
    // Mostly down, leaning a little to one side.
    const heading = turnRandomly(DOWN, (random() * 60 * Math.PI) / 180, random)
    from.addScaledVector(heading, radius)
    const length = Math.round(between(FINE_STEPS, random))
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
