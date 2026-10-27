import * as THREE from 'three'
import { growColonization } from '../../utils/branching/spaceColonization'
import { buildHierarchy } from '../../utils/branching/hierarchy'
import { LOD_LEVELS, chooseLevel } from '../../utils/branching/lod'
import { smoothGraph, sweepGeometry } from '../../utils/branching/sweep'
import { TILE_SIZE } from '../terrain/heightField'

/**
 * Tree crowns: the branches above every trunk.
 *
 * A handful of crown variants are grown with space colonization (the Topic 6
 * Crown tree): the trunk carries on up into a crown volume and splits into
 * limbs, branches and twigs that reach for points scattered through it.
 * Thickness follows the pipe model from the trunk's own radius down to the
 * twigs, and the branches are smooth swept tubes (utils/branching/sweep.js),
 * so the trunk flows into the limbs. Branches only, no leaves yet.
 *
 * Each trunk picks a variant from its seed and turns it by the same angle
 * as its trunk mesh, scaled by its radius, so every tree differs a little.
 * Every variant is drawn at the four Topic 6 levels of detail, each one
 * InstancedMesh, so the whole forest is a few dozen draw calls; a tree's
 * level comes from how tall its crown looks on screen. Variants are grown
 * one per frame (about 50 ms each), nearest trees appear first.
 */

export const DEFAULT_CROWNS = {
  crowns: true,
  // Where the crown starts (m above the ground): the visible trunk height.
  crownStart: 3.6,
  // % of the standard crown size and of its branch count.
  crownSize: 100,
  branchDensity: 100,
}

const VARIANTS = 8
const VIEW = 13
const CAPACITY = 256
// The trunk radius a variant is grown for; trunks scale it by theirs.
const REFERENCE_RADIUS = 0.22
// The trunk mesh's top radius, as a share of its base (coverMeshes.js).
const TRUNK_TOP = 0.88
// The crown starts this far inside the trunk's top, hiding the joint.
const OVERLAP = 0.4
const CROWN_RADIUS = 3.4
const POINTS = 700
const TWIG_RADIUS = 0.006
const BARK = new THREE.Color('#3e3128')
const TWIG = new THREE.Color('#6b5848')
// Crowns are big on screen even far away; scale the LOD thresholds up.
const DETAIL_BIAS = 0.25

/** One crown variant (metres, origin at the crown's base) and its radii. */
export function growCrown(seed, settings) {
  const size = CROWN_RADIUS * (settings.crownSize / 100)
  const tree = growColonization({
    shape: 'crown',
    size,
    height: size + OVERLAP + 0.3,
    points: Math.round(POINTS * (settings.branchDensity / 100)),
    influence: size * 0.55,
    killDistance: 0.4,
    stepLength: 0.3,
    maxIterations: 200,
    tropism: 0.1,
    startPoints: 1,
    seed: seed * 101 + 17,
  })
  const { segments } = tree
  // A little flatter than a sphere, like a broadleaf crown.
  const squashed = new Set()
  for (const { start, end } of segments) {
    for (const point of [start, end]) {
      if (squashed.has(point) || point.y <= OVERLAP + 0.3) continue
      squashed.add(point)
      point.y = OVERLAP + 0.3 + (point.y - OVERLAP - 0.3) * 0.85
    }
  }
  smoothGraph(segments, 2, 0.5)
  const hierarchy = buildHierarchy(segments)
  const rootTips = segments.reduce(
    (most, _, index) => (hierarchy.parent[index] < 0 ? Math.max(most, hierarchy.tipsFed[index]) : most),
    1
  )
  const base = REFERENCE_RADIUS * (TRUNK_TOP - 0.02)
  const radii = new Float32Array(segments.length)
  segments.forEach((_, index) => {
    radii[index] = Math.max(TWIG_RADIUS, base * Math.sqrt(hierarchy.tipsFed[index] / rootTips))
  })
  return { segments, hierarchy, radii, height: size * 2 * 0.85 + OVERLAP + 0.3 }
}

/** The four LOD geometries of a variant. */
function levelGeometries({ segments, hierarchy, radii }) {
  const span = Math.log(radii.reduce((most, radius) => Math.max(most, radius), TWIG_RADIUS) / TWIG_RADIUS) || 1
  return LOD_LEVELS.map(({ fraction, sides }) => {
    const keep = new Set(hierarchy.importance.slice(0, Math.max(1, Math.ceil(segments.length * fraction))))
    return sweepGeometry(segments, hierarchy, {
      keep,
      sides,
      radiusOf: (segment) => radii[segment],
      colorOf: (segment, color) => color.copy(BARK).lerp(TWIG, 1 - Math.log(radii[segment] / TWIG_RADIUS) / span),
    })
  })
}

export function createCrownRenderer(scene) {
  const group = new THREE.Group()
  scene.add(group)
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
  // variants[k] = { height, meshes: [InstancedMesh per level], triangles } | undefined
  let variants = []
  let settingsKey = null
  let listKey = null
  let list = []

  const clear = () => {
    for (const variant of variants) {
      variant?.meshes.forEach((mesh) => {
        group.remove(mesh)
        mesh.geometry.dispose()
        mesh.dispose()
      })
    }
    variants = []
  }
  const grow = (index, settings) => {
    const crown = growCrown(index, settings)
    const levels = levelGeometries(crown)
    const meshes = levels.map(({ geometry }) => {
      const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY)
      mesh.count = 0
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      group.add(mesh)
      return mesh
    })
    variants[index] = { height: crown.height, meshes, triangles: levels.map((level) => level.triangles) }
  }

  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const middle = new THREE.Vector3()
  let drawn = { trees: 0, triangles: 0, perLevel: [0, 0, 0, 0] }

  return {
    /**
     * Once per frame. trunks: the trunk field (null when trunks are off);
     * ground(trunk): the height the trunk mesh stands at.
     */
    update({ trunks, ground, focusX, focusZ, camera, viewportHeight, settings, version }) {
      const key = `${settings.crownSize}|${settings.branchDensity}`
      if (key !== settingsKey) {
        clear()
        settingsKey = key
      }
      group.visible = Boolean(settings.crowns && trunks)
      if (!group.visible) {
        drawn = { trees: 0, triangles: 0, perLevel: [0, 0, 0, 0] }
        return
      }

      const nextListKey = `${Math.floor(focusX / TILE_SIZE)},${Math.floor(focusZ / TILE_SIZE)},${version},${settings.crownStart}`
      if (nextListKey !== listKey) {
        listKey = nextListKey
        list = trunks
          .trunksNear(focusX, focusZ, VIEW)
          .slice(0, CAPACITY)
          .map((trunk) => ({ trunk, base: ground(trunk) + settings.crownStart - OVERLAP, level: 0 }))
      }
      // Grow the variant the nearest tree still waits for.
      const waiting = list.find(({ trunk }) => !variants[trunk.seed % VARIANTS])
      if (waiting) grow(waiting.trunk.seed % VARIANTS, settings)

      for (const variant of variants) variant?.meshes.forEach((mesh) => (mesh.count = 0))
      const pixelsPerUnit = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360))
      const perLevel = [0, 0, 0, 0]
      let triangles = 0
      let trees = 0
      for (const item of list) {
        const { trunk, base } = item
        const variant = variants[trunk.seed % VARIANTS]
        if (!variant) continue
        const size = trunk.radius / REFERENCE_RADIUS
        middle.set(trunk.x, base + (variant.height * size) / 2, trunk.z)
        const distance = Math.max(camera.position.distanceTo(middle), 0.1)
        const pixels = ((variant.height * size) / distance) * pixelsPerUnit
        item.level = chooseLevel(pixels, item.level, DETAIL_BIAS)
        const mesh = variant.meshes[item.level]
        if (mesh.count >= CAPACITY) continue
        position.set(trunk.x, base, trunk.z)
        quaternion.setFromAxisAngle(up, (trunk.seed % 360) * (Math.PI / 180))
        scale.setScalar(size)
        mesh.setMatrixAt(mesh.count, matrix.compose(position, quaternion, scale))
        mesh.count += 1
        perLevel[item.level] += 1
        triangles += variant.triangles[item.level]
        trees += 1
      }
      for (const variant of variants) variant?.meshes.forEach((mesh) => (mesh.instanceMatrix.needsUpdate = true))
      drawn = { trees, triangles, perLevel }
    },

    /** { trees, triangles, perLevel } drawn last frame. */
    stats() {
      return drawn
    },

    dispose() {
      clear()
      scene.remove(group)
      material.dispose()
    },
  }
}
