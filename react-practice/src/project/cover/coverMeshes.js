import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Shapes for the ground cover. Small items are built at unit size and
 * scaled per instance (leaf/twig length, cushion radius, mushroom height);
 * the trunk is built at unit radius.
 */

// --- Leaves: three outlines, slightly curled with a raised midrib.
const LEAF_OUTLINES = [
  // Oval (birch).
  (t) => 0.3 * Math.sin(Math.PI * t) ** 0.8,
  // Lobed (oak).
  (t) => 0.3 * Math.sin(Math.PI * t) ** 0.7 * (0.72 + 0.28 * Math.cos(t * Math.PI * 2 * 3.5)),
  // Pointed (beech).
  (t) => 0.28 * Math.sin(Math.PI * t) ** 1.2 * (1.1 - 0.35 * t),
]
const LEAF_STEPS = 12
const LEAF_ACROSS = [-1, -0.5, 0, 0.5, 1]

function leafGeometry(outline) {
  const positions = []
  const indices = []
  const across = LEAF_ACROSS.length
  for (let i = 0; i <= LEAF_STEPS; i += 1) {
    const t = i / LEAF_STEPS
    const width = outline(t)
    for (const side of LEAF_ACROSS) {
      // Edges curl up a little; the middle sags slightly along the length.
      const y = 0.06 * side * side * width + 0.03 * (t - 0.5) ** 2 + (side === 0 ? 0.004 : 0)
      positions.push(t - 0.5, y, side * width)
    }
  }
  for (let i = 0; i < LEAF_STEPS; i += 1) {
    for (let j = 0; j < across - 1; j += 1) {
      const a = i * across + j
      const b = a + 1
      const c = a + across
      const d = c + 1
      indices.push(a, b, c, b, d, c)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export function createLeafGeometries() {
  return LEAF_OUTLINES.map(leafGeometry)
}

// --- Twigs and branches: thin bent tubes lying on the ground (unit length).
function stick(points, radius) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)))
  return new THREE.TubeGeometry(curve, 10, radius, 5, false)
}

export function createTwigGeometry() {
  const geometry = stick([[-0.5, 0, 0], [-0.1, 0.004, 0.03], [0.5, 0, -0.02]], 0.018)
  geometry.translate(0, 0.018, 0)
  return geometry
}

export function createBranchGeometry() {
  const main = stick([[-0.5, 0, 0], [0, 0.006, 0.04], [0.5, 0, 0]], 0.022)
  const side = stick([[0.02, 0.003, 0.03], [0.2, 0.004, 0.13], [0.35, 0, 0.22]], 0.012)
  const geometry = mergeGeometries([main, side])
  main.dispose()
  side.dispose()
  geometry.translate(0, 0.022, 0)
  return geometry
}

// --- Moss cushion: a lumpy dome (unit radius, unit height).
export function createMossGeometry() {
  const geometry = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)
  const position = geometry.attributes.position
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const angle = Math.atan2(z, x)
    const lumps = 1 + 0.08 * Math.sin(angle * 7) * Math.cos(y * 9) + 0.05 * Math.sin(angle * 13 + y * 5)
    position.setXYZ(i, x * lumps, y * lumps, z * lumps)
  }
  geometry.computeVertexNormals()
  return geometry
}

// --- Mushroom (unit height): stem and cap built from profile curves.
const lathe = (points, segments = 16) =>
  new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments)

export function createMushroomGeometries() {
  const stem = lathe([
    [0, -0.05],
    [0.085, -0.05],
    [0.08, 0.1],
    [0.07, 0.5],
    [0.065, 0.8],
    [0, 0.8],
  ])
  // Underside centre → rim → over the top, so the lathe faces outward.
  const cap = lathe([
    [0, 0.79],
    [0.07, 0.79],
    [0.3, 0.77],
    [0.44, 0.75],
    [0.46, 0.79],
    [0.38, 0.89],
    [0.22, 0.97],
    [0, 1],
  ])
  return { stem, cap }
}

// --- Wood anemone (unit height): a slender stem with a whorl of three
// leaves, and a cupped six-petal flower on top. aPetal runs 0 → 1 from a
// petal's base to its tip (-1 on the stamens), for the nectar-guide shader.
const FLOWER_TOP = 0.87

export function createFlowerGeometries() {
  const stalk = stick([[0, 0, 0], [0.01, 0.45, 0.005], [0, FLOWER_TOP, 0]], 0.012)
  stalk.deleteAttribute('uv')
  const leaves = [0, 1, 2].map((k) => {
    const leaf = leafGeometry(LEAF_OUTLINES[1])
    leaf.scale(0.24, 0.24, 0.3)
    leaf.translate(0.12, 0.5, 0)
    leaf.rotateY((k / 3) * Math.PI * 2 + 0.4)
    return leaf
  })
  const stem = mergeGeometries([stalk, ...leaves])
  stalk.dispose()
  for (const leaf of leaves) leaf.dispose()

  const positions = []
  const petal = []
  const indices = []
  const PETALS = 6
  const ALONG = 6
  const ACROSS = [-1, -0.5, 0, 0.5, 1]
  for (let k = 0; k < PETALS; k += 1) {
    const angle = (k / PETALS) * Math.PI * 2
    const rx = Math.cos(angle)
    const rz = Math.sin(angle)
    const base = positions.length / 3
    for (let i = 0; i <= ALONG; i += 1) {
      const t = i / ALONG
      // Cupped: steeper toward the tip.
      const rise = 0.3 + 0.45 * t
      const out = 0.012 + 0.16 * t * Math.cos(rise)
      const up = FLOWER_TOP + 0.16 * t * Math.sin(rise)
      const width = 0.075 * Math.sin(Math.PI * Math.min(t * 0.95 + 0.05, 1)) ** 0.6
      for (const side of ACROSS) {
        positions.push(rx * out - rz * side * width, up, rz * out + rx * side * width)
        petal.push(t)
      }
    }
    for (let i = 0; i < ALONG; i += 1) {
      for (let j = 0; j < ACROSS.length - 1; j += 1) {
        const a = base + i * ACROSS.length + j
        indices.push(a, a + 1, a + ACROSS.length, a + 1, a + ACROSS.length + 1, a + ACROSS.length)
      }
    }
  }
  const petals = new THREE.BufferGeometry()
  petals.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  petals.setAttribute('aPetal', new THREE.Float32BufferAttribute(petal, 1))
  petals.setIndex(indices)
  petals.computeVertexNormals()
  const stamens = new THREE.SphereGeometry(0.03, 10, 6)
  stamens.deleteAttribute('uv')
  stamens.translate(0, FLOWER_TOP + 0.012, 0)
  stamens.setAttribute('aPetal', new THREE.Float32BufferAttribute(new Array(stamens.attributes.position.count).fill(-1), 1))
  const head = mergeGeometries([petals, stamens])
  petals.dispose()
  stamens.dispose()
  return { stem, head }
}

// --- Trunk (unit radius, 10 m tall): bark ridges, tapered, flared roots.
export const TRUNK_HEIGHT = 10
const TRUNK_BURY = 0.15
const ROOT_HEIGHT = 0.45
const ROOT_LOBES = 5

export function createTrunkGeometry() {
  const geometry = new THREE.CylinderGeometry(1, 1, TRUNK_HEIGHT, 40, 80, true)
  geometry.translate(0, TRUNK_HEIGHT / 2 - TRUNK_BURY, 0)
  const position = geometry.attributes.position
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const angle = Math.atan2(z, x)
    const up = Math.max(y, 0)
    // Slight taper, vertical bark ridges that wander, and root flares.
    let radius = 1 - 0.12 * Math.min(up / TRUNK_HEIGHT, 1)
    radius *= 1 + 0.035 * Math.sin(angle * 16 + 2 * Math.sin(y * 3)) + 0.02 * Math.sin(angle * 37 + y * 9)
    if (y < ROOT_HEIGHT) {
      const low = (1 - Math.max(y, 0) / ROOT_HEIGHT) ** 2
      const lobe = 0.55 + 0.45 * Math.max(Math.cos(angle * ROOT_LOBES), 0)
      radius += 0.7 * low * lobe
    }
    position.setXYZ(i, x * radius, y, z * radius)
  }
  geometry.computeVertexNormals()
  return geometry
}
