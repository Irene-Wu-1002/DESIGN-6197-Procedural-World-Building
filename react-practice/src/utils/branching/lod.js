import * as THREE from 'three'

/**
 * Topic 6 levels of detail for a branching structure, drawn as tubes.
 *
 * Each level keeps the first part of the importance order (see
 * hierarchy.js), so a coarser level is always the trunk-and-limbs core of a
 * finer one, and it also uses fewer sides per tube.
 *
 * A level is picked from how tall the tree looks on screen, in pixels; the
 * thresholds scale with the detail bias, and a ±15% margin around each one
 * (hysteresis) keeps a tree on the edge from flickering between levels.
 */

export const LOD_LEVELS = [
  { fraction: 1, sides: 8, color: '#9be07a' },
  { fraction: 0.35, sides: 6, color: '#e8d25a' },
  { fraction: 0.1, sides: 4, color: '#f0964a' },
  { fraction: 0.03, sides: 3, color: '#e85a5a' },
]

// On-screen height (px) below which a tree drops from level k to k + 1.
export const LOD_PIXELS = [400, 150, 50]
const HYSTERESIS = 0.15

const BARK = new THREE.Color('#8a5a36')
const LEAF = new THREE.Color('#bfe58f')

/**
 * The level for a tree `pixels` tall that is currently at `current`.
 * Dropping needs the size to fall 15% under a threshold; rising needs it to
 * climb 15% over.
 */
export function chooseLevel(pixels, current, bias) {
  let level = 0
  LOD_PIXELS.forEach((threshold, boundary) => {
    const margin = current <= boundary ? 1 - HYSTERESIS : 1 + HYSTERESIS
    if (pixels < (threshold / bias) * margin) level = boundary + 1
  })
  return level
}

/**
 * One merged tube mesh for the first `fraction` of the importance order,
 * each tube `sides`-sided. By default the radius follows the pipe model
 * (twigRadius × √tips fed) and colour runs bark → leaf by step, as in the
 * line view; options.radiusOf(index) and options.colorOf(index, color) set
 * them per segment instead (the World's roots use both). A tube starts at
 * its parent's radius and ends at its own, so thickness flows smoothly
 * through every joint instead of stepping.
 */
export function buildLevelGeometry(
  { segments, maxDepth },
  hierarchy,
  twigRadius,
  { fraction, sides },
  { radiusOf, colorOf } = {}
) {
  const kept = hierarchy.importance.slice(0, Math.max(1, Math.ceil(segments.length * fraction)))
  const ringSize = sides
  const positions = new Float32Array(kept.length * ringSize * 2 * 3)
  const normals = new Float32Array(positions.length)
  const colors = new Float32Array(positions.length)
  const indices = new Uint32Array(kept.length * sides * 6)

  const axis = new THREE.Vector3()
  const u = new THREE.Vector3()
  const v = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const helper = new THREE.Vector3()
  const color = new THREE.Color()

  kept.forEach((segmentIndex, keptIndex) => {
    const { start, end, depth } = segments[segmentIndex]
    const radiusAt = (index) => (radiusOf ? radiusOf(index) : twigRadius * Math.sqrt(hierarchy.tipsFed[index]))
    const parent = hierarchy.parent[segmentIndex]
    const ringRadii = [radiusAt(parent >= 0 ? parent : segmentIndex), radiusAt(segmentIndex)]
    axis.subVectors(end, start).normalize()
    helper.set(0, 1, 0)
    if (Math.abs(axis.y) > 0.9) helper.set(1, 0, 0)
    u.crossVectors(axis, helper).normalize()
    v.crossVectors(axis, u)
    if (colorOf) colorOf(segmentIndex, color)
    else color.copy(BARK).lerp(LEAF, maxDepth > 0 ? depth / maxDepth : 1)

    const base = keptIndex * ringSize * 2
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * Math.PI * 2
      normal.copy(u).multiplyScalar(Math.cos(angle)).addScaledVector(v, Math.sin(angle))
      ;[start, end].forEach((center, ring) => {
        const vertex = base + ring * ringSize + side
        const radius = ringRadii[ring]
        positions[vertex * 3] = center.x + normal.x * radius
        positions[vertex * 3 + 1] = center.y + normal.y * radius
        positions[vertex * 3 + 2] = center.z + normal.z * radius
        normal.toArray(normals, vertex * 3)
        color.toArray(colors, vertex * 3)
      })

      const next = (side + 1) % sides
      const a = base + side
      const b = base + next
      const c = base + ringSize + side
      const d = base + ringSize + next
      // Counter-clockwise seen from outside, so the faces point outward.
      indices.set([a, b, c, b, d, c], (keptIndex * sides + side) * 6)
    }
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()
  return { geometry, segments: kept.length, triangles: kept.length * sides * 2 }
}
