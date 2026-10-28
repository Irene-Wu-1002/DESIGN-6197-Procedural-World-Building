import * as THREE from 'three'
import { growColonization } from '../../utils/branching/spaceColonization'
import { buildHierarchy } from '../../utils/branching/hierarchy'
import { LOD_LEVELS, chooseLevel } from '../../utils/branching/lod'
import { smoothGraph, sweepGeometry } from '../../utils/branching/sweep'
import { TILE_SIZE } from '../terrain/heightField'
import { createRandom } from '../../utils/distributions'
import { LEAF_COLORS } from './coverRules'

/**
 * Tree crowns: the branches and leaves above every trunk.
 *
 * A handful of crown variants are grown with space colonization (the Topic 6
 * Crown tree): the trunk carries on up into a crown volume and splits into
 * limbs, branches and twigs that reach for points scattered through it.
 * Thickness follows the pipe model from the trunk's own radius down to the
 * twigs, and the branches are smooth swept tubes (utils/branching/sweep.js),
 * so the trunk flows into the limbs. Leaves are small folded cards in
 * clusters along the twigs, green with a few tones, one merged geometry
 * per variant.
 *
 * Water grows them (underground/treeWater.js): each tree instance carries
 * aTree = (growth, leaves, dryness). Every branch vertex knows when its
 * segment grew (aOrder, from the space colonization's iterations), and
 * every leaf when its twig grew and its rank; the shaders shrink branches
 * not grown yet onto their axes (so they extend from their parents, thin
 * at the growing tips) and leaves not grown or beyond the leaf share onto
 * their stalks, and yellow the leaves of thirsty trees and in autumn. The
 * shadows follow the same growth. Nothing is rebuilt as trees grow.
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
  leaves: true,
  // How fast water grows the crowns (% of the standard rate,
  // underground/treeWater.js).
  growthSpeed: 100,
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
// Leaves: per variant at full detail, their length (m), how many per twig
// (a segment feeding at most twigTips tips), and the share drawn at each
// level of detail (larger when fewer, so the crown keeps its weight).
const LEAF = { max: 6000, length: [0.18, 0.28], perTwig: [8, 14], twigTips: 2 }
const LEAF_SHARE = [1, 0.45, 0.2, 0.08]
// Ranks run to this, so at full leaves every leaf is full size.
const LEAF_RANK_TOP = 0.88
// Growth: how far behind the growing front a branch reaches full
// thickness, and a leaf full size.
const GROW_FRONT = 0.05
const LEAF_FRONT = 0.12
const DRY_LEAF = new THREE.Color('#a8893f')
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
  const maxDepth = segments.reduce((most, segment) => Math.max(most, segment.depth), 1)
  return { segments, hierarchy, radii, maxDepth, height: size * 2 * 0.85 + OVERLAP + 0.3 }
}

// A leaf card along +x from its stalk: base, the two sides (raised a
// little, so it folds along the midrib) and the tip.
const LEAF_SHAPE = [
  [0, 0, 0],
  [0.45, 0.06, -0.2],
  [1, 0, 0],
  [0.45, 0.06, 0.2],
]
const LEAF_TRIANGLES = [0, 1, 2, 0, 2, 3]

/**
 * The leaves of a variant, in random order (so a prefix is an even
 * thinning): { base, points (4 Vector3), order, rank, turn, green, autumn }.
 */
function placeLeaves({ segments, hierarchy, maxDepth }, seed) {
  const random = createRandom(seed * 31 + 7)
  const between = ([low, high]) => low + random() * (high - low)
  const twigs = segments.map((_, index) => index).filter((index) => hierarchy.tipsFed[index] <= LEAF.twigTips)
  const leaves = []
  const along = new THREE.Vector3()
  const euler = new THREE.Euler()
  const turn = new THREE.Quaternion()
  for (const index of twigs) {
    const { start, end, depth } = segments[index]
    const count = Math.round(between(LEAF.perTwig))
    for (let k = 0; k < count && leaves.length < LEAF.max; k += 1) {
      const base = along.copy(start).lerp(end, 0.3 + 0.7 * random()).clone()
      // Any heading, tilted between level and drooping.
      turn.setFromEuler(euler.set(0, random() * Math.PI * 2, -0.2 - random() * 0.9, 'YXZ'))
      const length = between(LEAF.length)
      const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (random() - 0.5) * 0.8)
      const points = LEAF_SHAPE.map(([x, y, z]) =>
        new THREE.Vector3(x, y, z).multiplyScalar(length).applyQuaternion(roll).applyQuaternion(turn).add(base)
      )
      leaves.push({
        base,
        points,
        order: (depth / maxDepth) * (1 - GROW_FRONT * 2),
        rank: random() * LEAF_RANK_TOP,
        turn: random(),
        green: LEAF_COLORS.green[Math.floor(random() * LEAF_COLORS.green.length)],
        autumn: LEAF_COLORS.autumn[Math.floor(random() * LEAF_COLORS.autumn.length)],
      })
    }
  }
  // Shuffle (Fisher–Yates).
  for (let k = leaves.length - 1; k > 0; k -= 1) {
    const j = Math.floor(random() * (k + 1))
    ;[leaves[k], leaves[j]] = [leaves[j], leaves[k]]
  }
  return leaves
}

/** The leaves at one level of detail: the first `share`, scaled up to keep the weight. */
function leafGeometry(leaves, share) {
  const kept = leaves.slice(0, Math.max(1, Math.ceil(leaves.length * share)))
  const grow = Math.min(1 / Math.sqrt(share), 2.5)
  const count = kept.length * LEAF_SHAPE.length
  const positions = new Float32Array(count * 3)
  const bases = new Float32Array(count * 3)
  const info = new Float32Array(count * 3)
  const greens = new Float32Array(count * 3)
  const autumns = new Float32Array(count * 3)
  const indices = []
  const color = new THREE.Color()
  const point = new THREE.Vector3()
  kept.forEach((leaf, n) => {
    leaf.points.forEach((corner, k) => {
      const v = n * LEAF_SHAPE.length + k
      point.copy(corner).sub(leaf.base).multiplyScalar(grow).add(leaf.base).toArray(positions, v * 3)
      leaf.base.toArray(bases, v * 3)
      info.set([leaf.order, leaf.rank, leaf.turn], v * 3)
      color.set(leaf.green).toArray(greens, v * 3)
      color.set(leaf.autumn).toArray(autumns, v * 3)
    })
    for (const corner of LEAF_TRIANGLES) indices.push(n * LEAF_SHAPE.length + corner)
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aBase', new THREE.BufferAttribute(bases, 3))
  geometry.setAttribute('aLeaf', new THREE.BufferAttribute(info, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(greens, 3))
  geometry.setAttribute('aAutumn', new THREE.BufferAttribute(autumns, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return { geometry, triangles: indices.length / 3 }
}

/** The four LOD geometries of a variant. */
function levelGeometries({ segments, hierarchy, radii, maxDepth }) {
  const span = Math.log(radii.reduce((most, radius) => Math.max(most, radius), TWIG_RADIUS) / TWIG_RADIUS) || 1
  return LOD_LEVELS.map(({ fraction, sides }) => {
    const keep = new Set(hierarchy.importance.slice(0, Math.max(1, Math.ceil(segments.length * fraction))))
    return sweepGeometry(segments, hierarchy, {
      keep,
      sides,
      radiusOf: (segment) => radii[segment],
      colorOf: (segment, color) => color.copy(BARK).lerp(TWIG, 1 - Math.log(radii[segment] / TWIG_RADIUS) / span),
      orderOf: (segment) => (segments[segment].depth / maxDepth) * (1 - GROW_FRONT * 2),
    })
  })
}

// Per tree: aTree = (growth, leaves, dryness). Branch vertices shrink onto
// their axis (along the normal, by their ring radius) until grown.
const BRANCH_VERTEX = /* glsl */ `
attribute vec3 aTree;
attribute vec2 aOrder;
`
const BRANCH_GROW = /* glsl */ `
#include <begin_vertex>
transformed -= normal * aOrder.y * (1.0 - smoothstep(aOrder.x, aOrder.x + ${GROW_FRONT.toFixed(3)}, aTree.x));
`
// Leaves shrink onto their stalks until their twig has grown and the
// tree's leaf share reaches their rank; thirst and autumn turn them.
const LEAF_VERTEX = /* glsl */ `
attribute vec3 aTree;
attribute vec3 aBase;
attribute vec3 aLeaf;
attribute vec3 aAutumn;
uniform float uAutumn;
varying float vTurn;
varying vec3 vAutumn;
`
const LEAF_GROW = /* glsl */ `
#include <begin_vertex>
float grown = smoothstep(aLeaf.x, aLeaf.x + ${GROW_FRONT.toFixed(3)}, aTree.x);
float full = smoothstep(aLeaf.y, aLeaf.y + ${LEAF_FRONT.toFixed(3)}, aTree.y);
transformed = aBase + (transformed - aBase) * grown * full;
// Thirst yellows a share of the leaves, autumn turns its share.
vTurn = max(smoothstep(aLeaf.z - 0.15, aLeaf.z, aTree.z * 0.9), smoothstep(aLeaf.z - 0.1, aLeaf.z, uAutumn));
vAutumn = aAutumn;
`
const LEAF_FRAGMENT = /* glsl */ `
uniform vec3 uDry;
varying float vTurn;
varying vec3 vAutumn;
`
const LEAF_COLOR = /* glsl */ `
#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, mix(uDry, vAutumn, 0.6), vTurn);
`

export function createCrownRenderer(scene) {
  const group = new THREE.Group()
  scene.add(group)
  const patch = (target, name, vertex, grow, fragment) => {
    target.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, leafUniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${vertex}`)
        .replace('#include <begin_vertex>', grow)
      if (fragment) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${fragment[0]}`)
          .replace('#include <color_fragment>', fragment[1])
      }
    }
    target.customProgramCacheKey = () => name
    return target
  }
  const leafUniforms = { uAutumn: { value: 0 }, uDry: { value: DRY_LEAF.clone() } }
  const material = patch(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
    'crown-branches',
    BRANCH_VERTEX,
    BRANCH_GROW
  )
  // Shadows follow the growth.
  const depthMaterial = patch(
    new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    'crown-branches-depth',
    BRANCH_VERTEX,
    BRANCH_GROW
  )
  const leafMaterial = patch(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }),
    'crown-leaves',
    LEAF_VERTEX,
    LEAF_GROW,
    [LEAF_FRAGMENT, LEAF_COLOR]
  )
  // variants[k] = { height, meshes, leafMeshes: [InstancedMesh per level], triangles, leafTriangles } | undefined
  let variants = []
  let settingsKey = null
  let listKey = null
  let list = []

  const clear = () => {
    for (const variant of variants) {
      variant?.meshes.concat(variant.leafMeshes).forEach((mesh) => {
        group.remove(mesh)
        mesh.geometry.dispose()
        mesh.dispose()
      })
    }
    variants = []
  }
  const instanced = (geometry, materialOf, shadows) => {
    geometry.setAttribute('aTree', new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage))
    const mesh = new THREE.InstancedMesh(geometry, materialOf, CAPACITY)
    mesh.count = 0
    mesh.castShadow = shadows
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    if (shadows) mesh.customDepthMaterial = depthMaterial
    group.add(mesh)
    return mesh
  }
  const grow = (index, settings) => {
    const crown = growCrown(index, settings)
    const levels = levelGeometries(crown)
    const leaves = placeLeaves(crown, index)
    const leafLevels = LEAF_SHARE.map((share) => leafGeometry(leaves, share))
    variants[index] = {
      height: crown.height,
      meshes: levels.map(({ geometry }) => instanced(geometry, material, true)),
      leafMeshes: leafLevels.map(({ geometry }) => instanced(geometry, leafMaterial, false)),
      triangles: levels.map((level) => level.triangles),
      leafTriangles: leafLevels.map((level) => level.triangles),
    }
  }

  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const middle = new THREE.Vector3()
  const FULL = { growth: 1, leaves: 1, dryness: 0 }
  let drawn = { trees: 0, triangles: 0, leaves: 0, perLevel: [0, 0, 0, 0] }

  return {
    /**
     * Once per frame. trunks: the trunk field (null when trunks are off);
     * ground(trunk): the height the trunk mesh stands at; trees: the tree
     * water states (underground/treeWater.js; trees without one are fully
     * grown); autumn: the season's autumn share 0 – 1.
     */
    update({ trunks, ground, focusX, focusZ, camera, viewportHeight, settings, version, trees, autumn = 0 }) {
      const key = `${settings.crownSize}|${settings.branchDensity}`
      if (key !== settingsKey) {
        clear()
        settingsKey = key
      }
      group.visible = Boolean(settings.crowns && trunks)
      if (!group.visible) {
        drawn = { trees: 0, triangles: 0, leaves: 0, perLevel: [0, 0, 0, 0] }
        return
      }
      leafUniforms.uAutumn.value = autumn

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

      for (const variant of variants) variant?.meshes.concat(variant.leafMeshes).forEach((mesh) => (mesh.count = 0))
      const pixelsPerUnit = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360))
      const perLevel = [0, 0, 0, 0]
      let triangles = 0
      let leafTriangles = 0
      let count = 0
      const place = (mesh, state) => {
        const n = mesh.count
        mesh.setMatrixAt(n, matrix)
        mesh.geometry.attributes.aTree.setXYZ(n, state.growth, state.leaves, state.dryness)
        mesh.count += 1
      }
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
        matrix.compose(position, quaternion, scale)
        const state = trees?.stateOf(trunk) ?? FULL
        place(mesh, state)
        if (settings.leaves) {
          place(variant.leafMeshes[item.level], state)
          leafTriangles += variant.leafTriangles[item.level]
        }
        perLevel[item.level] += 1
        triangles += variant.triangles[item.level]
        count += 1
      }
      for (const variant of variants) {
        variant?.meshes.concat(variant.leafMeshes).forEach((mesh) => {
          mesh.instanceMatrix.needsUpdate = true
          mesh.geometry.attributes.aTree.needsUpdate = true
        })
      }
      drawn = { trees: count, triangles: triangles + leafTriangles, leaves: leafTriangles / 2, perLevel }
    },

    /** { trees, triangles, leaves (cards), perLevel } drawn last frame. */
    stats() {
      return drawn
    },

    dispose() {
      clear()
      scene.remove(group)
      material.dispose()
      depthMaterial.dispose()
      leafMaterial.dispose()
    },
  }
}
