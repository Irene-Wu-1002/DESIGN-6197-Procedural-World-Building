import * as THREE from 'three'
import { perpendicular } from './common'

/**
 * Smooth, continuous tubes for a branching structure (tree crowns and roots
 * in the World).
 *
 * Instead of one short tube per segment, which creases at every bend, the
 * segments are joined into chains: at each fork the thickest child (the one
 * feeding the most tips) carries its parent's chain on, and every other
 * child starts a chain of its own, tucked inside the parent. Each chain is
 * swept as one tube whose rings are carried along it (parallel transport),
 * so it bends and tapers smoothly with no seams.
 *
 * Works on { segments, hierarchy } from utils/branching/hierarchy.js; a
 * segment's start point is its parent's end point (the same Vector3).
 */

/** Chains of segment indices, root first; continuations stay in one chain. */
export function buildChains(segments, hierarchy) {
  const { parent, tipsFed } = hierarchy
  const continuation = new Int32Array(segments.length).fill(-1)
  segments.forEach((_, index) => {
    const up = parent[index]
    if (up < 0) return
    const current = continuation[up]
    if (current < 0 || tipsFed[index] > tipsFed[current]) continuation[up] = index
  })
  const chains = []
  segments.forEach((_, index) => {
    const up = parent[index]
    if (up >= 0 && continuation[up] === index) return
    const chain = [index]
    for (let next = continuation[index]; next >= 0; next = continuation[next]) chain.push(next)
    chains.push(chain)
  })
  return chains
}

/**
 * Pull the points of a branching structure toward their neighbours, a few
 * times, so random-walk jitter becomes smooth curves. Forks, tips and roots
 * stay put. Moves the shared Vector3 points in place.
 */
export function smoothGraph(segments, iterations = 2, strength = 0.5) {
  const neighbours = new Map()
  const link = (a, b) => {
    if (!neighbours.has(a)) neighbours.set(a, [])
    neighbours.get(a).push(b)
  }
  for (const { start, end } of segments) {
    link(start, end)
    link(end, start)
  }
  const average = new THREE.Vector3()
  for (let pass = 0; pass < iterations; pass += 1) {
    const moved = []
    for (const [point, around] of neighbours) {
      if (around.length !== 2) continue
      average.copy(around[0]).add(around[1]).multiplyScalar(0.5)
      moved.push([point, point.clone().lerp(average, strength)])
    }
    for (const [point, next] of moved) point.copy(next)
  }
}

/**
 * One merged geometry of swept tubes.
 * keep: set of segment indices to draw (null = all); a chain stops at its
 * first segment not kept (importance prefixes always keep a chain's start).
 * radiusOf(segment): radius at the segment's end; colorOf(segment, color).
 */
export function sweepGeometry(segments, hierarchy, { keep = null, sides = 8, radiusOf, colorOf }) {
  const chains = buildChains(segments, hierarchy)
  const rings = []
  for (const chain of chains) {
    const kept = []
    for (const index of chain) {
      if (keep && !keep.has(index)) break
      kept.push(index)
    }
    if (!kept.length) continue
    // Points: the chain's start, then each segment's end; the start ring
    // takes the first segment's radius, so a side chain begins tucked
    // inside the thicker one it leaves.
    const points = [segments[kept[0]].start, ...kept.map((index) => segments[index].end)]
    const owner = [kept[0], ...kept]
    rings.push({ points, owner })
  }

  const vertexCount = rings.reduce((sum, { points }) => sum + points.length * sides, 0)
  const indexCount = rings.reduce((sum, { points }) => sum + (points.length - 1) * sides * 6, 0)
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const colors = new Float32Array(vertexCount * 3)
  const indices = new Uint32Array(indexCount)

  const tangent = new THREE.Vector3()
  const previous = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const binormal = new THREE.Vector3()
  const radial = new THREE.Vector3()
  const turn = new THREE.Quaternion()
  const color = new THREE.Color()
  let vertex = 0
  let cursor = 0

  for (const { points, owner } of rings) {
    const base = vertex
    for (let k = 0; k < points.length; k += 1) {
      const ahead = points[Math.min(k + 1, points.length - 1)]
      const behind = points[Math.max(k - 1, 0)]
      tangent.subVectors(ahead, behind)
      if (tangent.lengthSq() < 1e-12) tangent.copy(previous.lengthSq() ? previous : new THREE.Vector3(0, 1, 0))
      tangent.normalize()
      if (k === 0) normal.copy(perpendicular(tangent))
      else {
        // Carry the ring's orientation along the bend (parallel transport).
        turn.setFromUnitVectors(previous, tangent)
        normal.applyQuaternion(turn)
        normal.sub(radial.copy(tangent).multiplyScalar(normal.dot(tangent))).normalize()
      }
      binormal.crossVectors(tangent, normal)
      previous.copy(tangent)

      const segment = owner[k]
      const radius = radiusOf(segment)
      colorOf(segment, color)
      for (let side = 0; side < sides; side += 1) {
        const angle = (side / sides) * Math.PI * 2
        radial.copy(normal).multiplyScalar(Math.cos(angle)).addScaledVector(binormal, Math.sin(angle))
        const point = points[k]
        positions[vertex * 3] = point.x + radial.x * radius
        positions[vertex * 3 + 1] = point.y + radial.y * radius
        positions[vertex * 3 + 2] = point.z + radial.z * radius
        radial.toArray(normals, vertex * 3)
        color.toArray(colors, vertex * 3)
        vertex += 1
      }
    }
    // Quads between consecutive rings, facing outward.
    for (let k = 0; k < points.length - 1; k += 1) {
      for (let side = 0; side < sides; side += 1) {
        const next = (side + 1) % sides
        const a = base + k * sides + side
        const b = base + k * sides + next
        const c = base + (k + 1) * sides + side
        const d = base + (k + 1) * sides + next
        indices.set([a, b, c, b, d, c], cursor)
        cursor += 6
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()
  return { geometry, triangles: indexCount / 3 }
}
