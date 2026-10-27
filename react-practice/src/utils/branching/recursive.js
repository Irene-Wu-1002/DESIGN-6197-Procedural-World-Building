import * as THREE from 'three'
import { createRandom } from '../distributions'

/**
 * Topic 6: recursive branching.
 *
 * A trunk grows from the origin. At the end of every branch, N children split
 * off: each one tilts away from its parent by the split angle, turns around the
 * parent by an even share of a full circle (plus the spread twist per
 * generation), and is shorter by the length ratio. This repeats until the depth
 * limit. One seed always grows the same tree.
 *
 * Returns { segments: [{ start, end, depth }], tips: [Vector3], maxDepth, capped }.
 * Segments come out generation by generation (breadth first), so a renderer
 * can reveal the tree one generation at a time.
 */

export const DEFAULT_RECURSIVE = {
  depth: 6,
  children: 2,
  splitAngle: 30,
  angleJitter: 10,
  spreadTwist: 137.5,
  lengthRatio: 0.72,
  lengthJitter: 0.15,
  trunkLength: 2,
  tropism: 0,
  prune: 0,
  growDown: false,
  seed: 1,
  showTips: true,
}

export const RECURSIVE_PRESETS = {
  binary: {
    label: 'Binary tree',
    params: { depth: 8, children: 2, splitAngle: 28, angleJitter: 0, spreadTwist: 90, lengthRatio: 0.74, lengthJitter: 0, trunkLength: 2, tropism: 0, prune: 0, growDown: false },
  },
  bush: {
    label: 'Bush',
    params: { depth: 5, children: 4, splitAngle: 42, angleJitter: 14, spreadTwist: 137.5, lengthRatio: 0.68, lengthJitter: 0.25, trunkLength: 0.8, tropism: 0.25, prune: 0.1, growDown: false },
  },
  conifer: {
    label: 'Conifer-ish',
    params: { depth: 7, children: 3, splitAngle: 62, angleJitter: 8, spreadTwist: 137.5, lengthRatio: 0.62, lengthJitter: 0.1, trunkLength: 2.6, tropism: -0.15, prune: 0.05, growDown: false },
  },
  roots: {
    label: 'Roots',
    params: { depth: 7, children: 3, splitAngle: 55, angleJitter: 25, spreadTwist: 137.5, lengthRatio: 0.7, lengthJitter: 0.35, trunkLength: 1, tropism: -0.35, prune: 0.25, growDown: true },
  },
}

// Upper bound on segments so a deep, bushy tree can't freeze the page.
export const MAX_SEGMENTS = 120000

const UP = new THREE.Vector3(0, 1, 0)
const DEG = Math.PI / 180

// Any unit vector perpendicular to `dir`.
function perpendicular(dir) {
  const helper = Math.abs(dir.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)
  return new THREE.Vector3().crossVectors(dir, helper).normalize()
}

export function growRecursive(params) {
  const random = createRandom(params.seed)
  const jitter = (amount) => (random() * 2 - 1) * amount

  const trunkDir = new THREE.Vector3(0, params.growDown ? -1 : 1, 0)
  const trunk = {
    start: new THREE.Vector3(0, 0, 0),
    end: trunkDir.clone().multiplyScalar(params.trunkLength),
    dir: trunkDir,
    // `side` is a perpendicular the children turn around; carrying it down the
    // tree keeps the spread twist consistent from one generation to the next.
    side: perpendicular(trunkDir),
    length: params.trunkLength,
    depth: 0,
  }

  const segments = []
  const tips = []
  let capped = false
  let queue = [trunk]

  while (queue.length) {
    const next = []
    for (const branch of queue) {
      segments.push({ start: branch.start, end: branch.end, depth: branch.depth })

      if (branch.depth >= params.depth) {
        tips.push(branch.end)
        continue
      }

      let grew = 0
      for (let index = 0; index < params.children; index += 1) {
        // The trunk's first split is never pruned, so there is always a tree.
        if (branch.depth > 0 && random() < params.prune) continue
        if (segments.length + queue.length + next.length >= MAX_SEGMENTS) {
          capped = true
          continue
        }

        // Turn around the parent: an even share of the circle per child,
        // plus the spread twist for each generation.
        const azimuth =
          ((360 / params.children) * index + params.spreadTwist * branch.depth + jitter(params.angleJitter)) * DEG
        const tilt = Math.max(0, params.splitAngle + jitter(params.angleJitter)) * DEG

        const side = branch.side.clone().applyAxisAngle(branch.dir, azimuth)
        const dir = branch.dir
          .clone()
          .multiplyScalar(Math.cos(tilt))
          .addScaledVector(side, Math.sin(tilt))

        // Tropism bends toward up (light) or down (gravity).
        dir.addScaledVector(UP, params.tropism * 0.5).normalize()

        const length = branch.length * params.lengthRatio * (1 + jitter(params.lengthJitter))
        const childSide = side.clone().projectOnPlane(dir)
        next.push({
          start: branch.end,
          end: branch.end.clone().addScaledVector(dir, length),
          dir,
          side: childSide.lengthSq() > 1e-6 ? childSide.normalize() : perpendicular(dir),
          length,
          depth: branch.depth + 1,
        })
        grew += 1
      }

      if (grew === 0) tips.push(branch.end)
    }
    queue = next
  }

  return { segments, tips, maxDepth: params.depth, capped }
}
