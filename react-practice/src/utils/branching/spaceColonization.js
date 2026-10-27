import * as THREE from 'three'
import { createRandom } from '../distributions'
import { MAX_SEGMENTS, UP } from './common'

/**
 * Topic 6: space colonization (Runions et al., 2007).
 *
 * Attraction points fill a volume. On every iteration each point pulls on the
 * nearest branch node within the influence radius; every node that is pulled
 * grows one step toward the average direction of its points. A point is
 * removed once a node comes within the kill distance. Branches split wherever
 * points pull in different directions, and growth stops when no points are
 * left (or nothing can grow any more).
 *
 * A segment's depth is the iteration it grew in, and each attraction point
 * records the iteration it was removed in, so growth can be replayed with the
 * points disappearing as branches reach them.
 */

export const DEFAULT_COLONIZATION = {
  shape: 'crown',
  size: 3,
  height: 5,
  points: 800,
  influence: 1.5,
  killDistance: 0.3,
  stepLength: 0.15,
  maxIterations: 300,
  tropism: 0,
  startPoints: 1,
  seed: 1,
  showTips: false,
  showAttractors: true,
}

export const COLONIZATION_SHAPES = [
  ['crown', 'Crown (sphere)'],
  ['cone', 'Cone'],
  ['column', 'Column'],
  ['slab', 'Soil slab (underground)'],
]

export const COLONIZATION_PRESETS = {
  crown: {
    label: 'Crown tree',
    params: { shape: 'crown', size: 3, height: 5, points: 800, influence: 1.5, killDistance: 0.3, stepLength: 0.15, tropism: 0, startPoints: 1 },
  },
  canopy: {
    label: 'Wide canopy',
    params: { shape: 'crown', size: 5, height: 6, points: 1600, influence: 2, killDistance: 0.35, stepLength: 0.18, tropism: 0.15, startPoints: 1 },
  },
  column: {
    label: 'Column / poplar',
    params: { shape: 'column', size: 3.5, height: 5, points: 900, influence: 1.2, killDistance: 0.25, stepLength: 0.14, tropism: 0.3, startPoints: 1 },
  },
  mycelium: {
    label: 'Mycelium',
    params: { shape: 'slab', size: 4, height: 0, points: 2400, influence: 1, killDistance: 0.2, stepLength: 0.1, tropism: 0, startPoints: 4 },
  },
}

// Random point inside the chosen volume.
function samplePoint(shape, size, height, random) {
  const signed = () => random() * 2 - 1
  for (;;) {
    const x = signed()
    const y = signed()
    const z = signed()
    if (shape === 'crown' && x * x + y * y + z * z <= 1) {
      return new THREE.Vector3(x * size, height + y * size, z * size)
    }
    if (shape === 'cone') {
      // Widest at the bottom, a point at the top, like a conifer.
      const t = (y + 1) / 2
      if (x * x + z * z <= (1 - t) ** 2) {
        return new THREE.Vector3(x * size, height - size + t * size * 2.2, z * size)
      }
    }
    if (shape === 'column' && x * x + z * z <= 1) {
      return new THREE.Vector3(x * size * 0.4, height + y * size * 1.3, z * size * 0.4)
    }
    if (shape === 'slab' && x * x + z * z <= 1) {
      // A flat layer of soil just below the grid.
      return new THREE.Vector3(x * size * 2, -0.7 + y * 0.5, z * size * 2)
    }
  }
}

// Buckets items (anything with a `position`) by cell, so a search within
// `radius` (radius <= cellSize) only checks the 27 cells around a point.
function createGrid(cellSize) {
  const cells = new Map()
  const key = (x, y, z) => `${x},${y},${z}`
  const cellOf = (value) => Math.floor(value / cellSize)
  // The buckets around a point.
  const near = (point) => {
    const cx = cellOf(point.x)
    const cy = cellOf(point.y)
    const cz = cellOf(point.z)
    const buckets = []
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = cells.get(key(cx + dx, cy + dy, cz + dz))
          if (bucket) buckets.push(bucket)
        }
      }
    }
    return buckets
  }
  return {
    add(item) {
      const id = key(cellOf(item.position.x), cellOf(item.position.y), cellOf(item.position.z))
      if (!cells.has(id)) cells.set(id, [])
      cells.get(id).push(item)
    },
    near,
    // Is any item within `radius` of the point?
    any(point, radius) {
      return near(point).some((bucket) =>
        bucket.some((item) => item.position.distanceToSquared(point) < radius * radius)
      )
    },
  }
}

export function growColonization(params) {
  const random = createRandom(params.seed)
  const growDown = params.shape === 'slab'

  const attractors = []
  for (let index = 0; index < params.points; index += 1) {
    attractors.push({
      position: samplePoint(params.shape, params.size, params.height, random),
      removedAt: Infinity,
      // Nearest node within the influence radius, kept up to date as nodes
      // are added: nodes never move, so only a new node can be nearer.
      nearest: null,
      nearestDistance: params.influence,
    })
  }
  const attractorGrid = createGrid(params.influence)
  attractors.forEach((attractor) => attractorGrid.add(attractor))

  // Small cells for the "is this spot already taken?" check.
  const nodeGrid = createGrid(params.stepLength)
  const nodes = []
  const addNode = (position, parent) => {
    const node = { position, parent, children: 0, pull: new THREE.Vector3(), pulls: 0 }
    if (parent) parent.children += 1
    nodes.push(node)
    nodeGrid.add(node)
    for (const bucket of attractorGrid.near(position)) {
      for (const attractor of bucket) {
        if (attractor.removedAt !== Infinity) continue
        const distance = attractor.position.distanceTo(position)
        if (distance < attractor.nearestDistance) {
          attractor.nearest = node
          attractor.nearestDistance = distance
        }
      }
    }
    return node
  }

  // Roots on a small circle; their trunks grow straight until they reach the points.
  const trunkDir = new THREE.Vector3(0, growDown ? -1 : 1, 0)
  let trunks = []
  for (let index = 0; index < params.startPoints; index += 1) {
    const angle = (index / params.startPoints) * Math.PI * 2
    const position =
      params.startPoints > 1
        ? new THREE.Vector3(Math.cos(angle) * 0.6, 0, Math.sin(angle) * 0.6)
        : new THREE.Vector3()
    trunks.push(addNode(position, null))
  }

  const segments = []
  let live = attractors.length
  let capped = false
  let iteration = 0

  for (; iteration < params.maxIterations && live > 0; iteration += 1) {
    // Each live point pulls its nearest node; a point that a node has reached is removed.
    let pulled = 0
    for (const attractor of attractors) {
      if (attractor.removedAt !== Infinity || !attractor.nearest) continue
      const node = attractor.nearest
      if (attractor.nearestDistance < params.killDistance) {
        attractor.removedAt = iteration
        live -= 1
        continue
      }
      node.pull.add(attractor.position.clone().sub(node.position).normalize())
      node.pulls += 1
      pulled += 1
    }

    const grown = []
    if (pulled === 0) {
      // Nothing in reach yet: the trunks keep growing toward the volume.
      if (!trunks.length) break
      trunks = trunks.map((trunk) => {
        const node = addNode(trunk.position.clone().addScaledVector(trunkDir, params.stepLength), trunk)
        grown.push(node)
        return node
      })
    } else {
      trunks = []
      const pulledNodes = nodes.filter((node) => node.pulls > 0)
      for (const node of pulledNodes) {
        const dir = node.pull.clone().normalize()
        dir.addScaledVector(UP, params.tropism * 0.3).normalize()
        node.pull.set(0, 0, 0)
        node.pulls = 0

        const position = node.position.clone().addScaledVector(dir, params.stepLength)
        // Two points pulling in opposite directions can trap a node; skip a
        // step that lands on an existing node, so growth can't loop forever.
        if (nodeGrid.any(position, params.stepLength * 0.3)) continue
        if (segments.length + grown.length >= MAX_SEGMENTS) {
          capped = true
          continue
        }
        grown.push(addNode(position, node))
      }
    }

    for (const node of grown) {
      segments.push({ start: node.parent.position, end: node.position, depth: iteration })
    }
    if (!grown.length || capped) break
  }

  const tips = nodes.filter((node) => node.children === 0 && node.parent).map((node) => node.position)
  const reached = attractors.length - live
  const maxDepth = segments.reduce((max, segment) => Math.max(max, segment.depth), 0)

  return {
    segments,
    tips,
    attractors,
    maxDepth,
    capped,
    stepName: 'Iteration',
    stats: [
      [segments.length, 'segments'],
      [tips.length, 'tips'],
      [`${reached} / ${attractors.length}`, 'points reached'],
      [iteration, 'iterations'],
    ],
  }
}
