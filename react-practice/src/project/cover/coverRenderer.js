import * as THREE from 'three'
import { TILE_SIZE } from '../terrain/heightField'
import { FLOWER_COLORS, FLOWER_STEM_COLOR, LEAF_COLORS, MOSS_COLORS, MUSHROOM_COLORS, TWIG_COLORS } from './coverRules'
import {
  createBranchGeometry,
  createFlowerGeometries,
  createLeafGeometries,
  createMossGeometry,
  createMushroomGeometries,
  createTrunkGeometry,
  createTwigGeometry,
} from './coverMeshes'

/**
 * Draws the ground cover with one InstancedMesh per part for the whole
 * world (a handful of draw calls). Each tile's items are turned into
 * matrices and colours once (setTile); sync() packs every loaded tile into
 * the shared buffers only when something changed.
 *
 * Small items shrink to nothing where the ground starts to smooth out with
 * distance (uCoverFade, from the viewer at uMorphCenter), in the colour and
 * shadow passes alike, so they never float above smoothed ground.
 */

const STEM_COLOR = '#e6dcc6'
const DAMP_DARKEN = 0.25

const toLinear = (hex) => new THREE.Color(hex)
const palettes = {
  autumn: LEAF_COLORS.autumn.map(toLinear),
  green: LEAF_COLORS.green.map(toLinear),
  moss: MOSS_COLORS.map(toLinear),
  mushroom: MUSHROOM_COLORS.map(toLinear),
  twig: TWIG_COLORS.map(toLinear),
  stem: toLinear(STEM_COLOR),
  flower: FLOWER_COLORS.map(toLinear),
  flowerStem: toLinear(FLOWER_STEM_COLOR),
}

const FADE_DECLARATIONS = /* glsl */ `
uniform vec2 uMorphCenter;
uniform vec2 uCoverFade;
`
const FADE_VERTEX = /* glsl */ `
#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 coverBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  transformed *= 1.0 - smoothstep(uCoverFade.x, uCoverFade.y, distance(coverBase.xz, uMorphCenter));
#endif
`

// Moss only: fuzzy speckle (bright tips, dark gaps) at ~1–2 mm, so cushions
// read as moss rather than smooth blobs.
const MOSS_VERTEX = /* glsl */ `
#include <worldpos_vertex>
vMossPosition = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
`
const MOSS_FRAGMENT_DECLARATIONS = /* glsl */ `
varying vec3 vMossPosition;
float mossHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
`
const MOSS_COLOR = /* glsl */ `
#include <color_fragment>
{
  vec3 cell = floor(vMossPosition * 900.0);
  float tuft = mossHash(cell);
  float fine = mossHash(floor(vMossPosition * 2400.0));
  diffuseColor.rgb *= 0.7 + 0.45 * tuft + 0.15 * fine;
}
`

// Flowers only: yellow stamens, and the nectar guides that only
// ultraviolet vision sees (uUV, 0–1): a dark violet bullseye at the base of
// the petals around bright, UV-reflecting tips.
const FLOWER_VERTEX = /* glsl */ `
#include <begin_vertex>
vPetal = aPetal;
`
const FLOWER_FRAGMENT_DECLARATIONS = /* glsl */ `
uniform float uUV;
varying float vPetal;
`
const FLOWER_COLOR = /* glsl */ `
#include <color_fragment>
if (vPetal < 0.0) {
  diffuseColor.rgb = mix(vec3(0.95, 0.74, 0.16), vec3(0.32, 0.16, 0.5), uUV * 0.6);
} else {
  float guide = 1.0 - smoothstep(0.25, 0.6, vPetal);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.24, 0.1, 0.52), guide * uUV * 0.85);
  diffuseColor.rgb *= 1.0 + 0.4 * uUV * smoothstep(0.5, 0.95, vPetal);
}
`

function applyFade(material, uniforms, key, { moss = false, flower = false } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    let vertex = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FADE_DECLARATIONS}`)
      .replace('#include <begin_vertex>', FADE_VERTEX)
    if (moss) {
      vertex = vertex
        .replace('#include <common>', '#include <common>\nvarying vec3 vMossPosition;')
        .replace('#include <worldpos_vertex>', MOSS_VERTEX)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${MOSS_FRAGMENT_DECLARATIONS}`)
        .replace('#include <color_fragment>', MOSS_COLOR)
    }
    if (flower) {
      vertex = vertex
        .replace('#include <common>', '#include <common>\nattribute float aPetal;\nvarying float vPetal;')
        .replace('#include <begin_vertex>', FLOWER_VERTEX)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FLOWER_FRAGMENT_DECLARATIONS}`)
        .replace('#include <color_fragment>', FLOWER_COLOR)
    }
    shader.vertexShader = vertex
  }
  material.customProgramCacheKey = () => key
  return material
}

const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * morphUniforms: the ground's morph uniforms (uMorphCenter is shared).
 * Returns { setTile, removeTile, sync, setFadeRange, setUV, dispose }.
 */
export function createCoverRenderer(scene, morphUniforms) {
  const uniforms = {
    uMorphCenter: morphUniforms.uMorphCenter,
    uCoverFade: { value: new THREE.Vector2(1, 2) },
    uUV: { value: 0 },
  }
  const leafGeometries = createLeafGeometries()
  const mushroom = createMushroomGeometries()
  const flower = createFlowerGeometries()
  const depthMaterial = applyFade(
    new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    uniforms,
    'cover-depth'
  )
  const standard = (options, key, extra) =>
    applyFade(new THREE.MeshStandardMaterial({ color: '#ffffff', ...options }), uniforms, key, extra)

  // Each part: geometry, material, capacity, and how to pick its items and colour.
  const parts = [
    ...leafGeometries.map((geometry, variant) => ({
      id: `leaf${variant}`,
      geometry,
      material: standard({ roughness: 0.85, side: THREE.DoubleSide }, 'cover-leaf'),
      capacity: 6000,
      castShadow: false,
      items: (tile) => tile.leaves[variant],
      color: (item, out) => {
        out.copy((item.autumn ? palettes.autumn : palettes.green)[item.palette])
        out.multiplyScalar((0.85 + 0.3 * item.shade) * (1 - DAMP_DARKEN * smoothstep(0.55, 0.85, item.damp)))
      },
    })),
    {
      id: 'twig',
      geometry: createTwigGeometry(),
      material: standard({ roughness: 0.95, flatShading: true }, 'cover-wood'),
      capacity: 2000,
      castShadow: true,
      items: (tile) => tile.twigs,
      color: (item, out) => out.copy(palettes.twig[item.palette]).multiplyScalar(0.8 + 0.4 * item.shade),
    },
    {
      id: 'branch',
      geometry: createBranchGeometry(),
      material: standard({ roughness: 0.95, flatShading: true }, 'cover-wood'),
      capacity: 800,
      castShadow: true,
      items: (tile) => tile.branches,
      color: (item, out) => out.copy(palettes.twig[item.palette]).multiplyScalar(0.8 + 0.4 * item.shade),
    },
    {
      id: 'moss',
      geometry: createMossGeometry(),
      material: standard({ roughness: 1 }, 'cover-moss', { moss: true }),
      capacity: 12000,
      castShadow: true,
      items: (tile) => tile.moss,
      color: (item, out) => out.copy(palettes.moss[item.palette]).multiplyScalar(0.8 + 0.4 * item.shade),
    },
    {
      id: 'mushroomStem',
      geometry: mushroom.stem,
      material: standard({ roughness: 0.8 }, 'cover-mushroom'),
      capacity: 1500,
      castShadow: true,
      items: (tile) => tile.mushrooms,
      color: (item, out) => out.copy(palettes.stem).multiplyScalar(0.9 + 0.15 * item.shade),
    },
    {
      id: 'mushroomCap',
      geometry: mushroom.cap,
      material: standard({ roughness: 0.6 }, 'cover-mushroom'),
      capacity: 1500,
      castShadow: true,
      items: (tile) => tile.mushrooms,
      color: (item, out) => out.copy(palettes.mushroom[item.palette]).multiplyScalar(0.85 + 0.3 * item.shade),
    },
    {
      id: 'flowerStem',
      geometry: flower.stem,
      material: standard({ roughness: 0.8, side: THREE.DoubleSide }, 'cover-flower-stem'),
      capacity: 3000,
      castShadow: true,
      items: (tile) => tile.flowers ?? [],
      color: (item, out) => out.copy(palettes.flowerStem).multiplyScalar(0.85 + 0.3 * item.shade),
    },
    {
      id: 'flowerHead',
      geometry: flower.head,
      material: standard({ roughness: 0.55, side: THREE.DoubleSide }, 'cover-flower-head', { flower: true }),
      capacity: 3000,
      castShadow: true,
      items: (tile) => tile.flowers ?? [],
      color: (item, out) => out.copy(palettes.flower[item.palette]).multiplyScalar(0.92 + 0.08 * item.shade),
    },
  ]

  for (const part of parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, part.capacity)
    mesh.count = 0
    mesh.castShadow = part.castShadow
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    mesh.customDepthMaterial = depthMaterial
    mesh.setColorAt(0, new THREE.Color())
    part.mesh = mesh
    scene.add(mesh)
  }

  const tiles = new Map()
  let dirty = false
  const up = new THREE.Vector3(0, 1, 0)
  const normal = new THREE.Vector3()
  const tiltQ = new THREE.Quaternion()
  const yawQ = new THREE.Quaternion()
  const quaternion = new THREE.Quaternion()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const matrix = new THREE.Matrix4()
  const color = new THREE.Color()

  // Turn one tile's items into packed matrices and colours per part.
  const bake = (items) => {
    const baked = {}
    for (const part of parts) {
      const list = part.items(items)
      const matrices = new Float32Array(list.length * 16)
      const colors = new Float32Array(list.length * 3)
      list.forEach((item, index) => {
        normal.fromArray(item.normal).normalize()
        tiltQ.setFromUnitVectors(up, normal)
        yawQ.setFromAxisAngle(up, item.yaw)
        quaternion.multiplyQuaternions(tiltQ, yawQ)
        position.set(item.x, item.y, item.z)
        scale.fromArray(item.scale)
        matrix.compose(position, quaternion, scale)
        matrix.toArray(matrices, index * 16)
        part.color(item, color)
        colors[index * 3] = color.r
        colors[index * 3 + 1] = color.g
        colors[index * 3 + 2] = color.b
      })
      baked[part.id] = { matrices, colors, count: list.length }
    }
    return baked
  }

  return {
    setTile(key, items) {
      tiles.set(key, bake(items))
      dirty = true
    },
    removeTile(key) {
      if (tiles.delete(key)) dirty = true
    },
    clear() {
      tiles.clear()
      dirty = true
    },
    /** How much the viewer sees in ultraviolet (0–1): flower nectar guides. */
    setUV(value) {
      uniforms.uUV.value = value
    },
    /** Fade small items out between these distances (m) from the viewer. */
    setFadeRange(start, end) {
      uniforms.uCoverFade.value.set(start, end)
    },
    /** Pack all loaded tiles into the instanced meshes (only if changed). */
    sync() {
      if (!dirty) return
      dirty = false
      for (const part of parts) {
        const { mesh, capacity } = part
        let count = 0
        for (const baked of tiles.values()) {
          const block = baked[part.id]
          const take = Math.min(block.count, capacity - count)
          if (take <= 0) continue
          mesh.instanceMatrix.array.set(block.matrices.subarray(0, take * 16), count * 16)
          mesh.instanceColor.array.set(block.colors.subarray(0, take * 3), count * 3)
          count += take
        }
        mesh.count = count
        mesh.instanceMatrix.needsUpdate = true
        mesh.instanceColor.needsUpdate = true
      }
    },
    counts() {
      return Object.fromEntries(parts.map((part) => [part.id, part.mesh.count]))
    },
    dispose() {
      for (const part of parts) {
        scene.remove(part.mesh)
        part.geometry.dispose()
        part.material.dispose()
        part.mesh.dispose()
      }
      depthMaterial.dispose()
    },
  }
}

// --- Trunks: always drawn out into the haze, refreshed when you cross a tile.
const TRUNK_VIEW = 13
const TRUNK_CAPACITY = 256

export function createTrunkRenderer(scene) {
  const geometry = createTrunkGeometry()
  const material = new THREE.MeshStandardMaterial({ color: '#3e3128', roughness: 1 })
  const mesh = new THREE.InstancedMesh(geometry, material, TRUNK_CAPACITY)
  mesh.count = 0
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  scene.add(mesh)
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  let lastKey = null

  return {
    mesh,
    update(trunks, sampler, focusX, focusZ, version) {
      const key = `${Math.floor(focusX / TILE_SIZE)},${Math.floor(focusZ / TILE_SIZE)},${version}`
      if (key === lastKey || !trunks || !sampler) return
      lastKey = key
      const list = trunks.trunksNear(focusX, focusZ, TRUNK_VIEW).slice(0, TRUNK_CAPACITY)
      list.forEach((trunk, index) => {
        // Sit on the lowest ground around the trunk so roots never float.
        let ground = sampler.height(trunk.x, trunk.z)
        for (let k = 0; k < 6; k += 1) {
          const angle = (k / 6) * Math.PI * 2
          ground = Math.min(
            ground,
            sampler.height(trunk.x + Math.cos(angle) * trunk.radius * 1.4, trunk.z + Math.sin(angle) * trunk.radius * 1.4)
          )
        }
        position.set(trunk.x, ground, trunk.z)
        quaternion.setFromAxisAngle(up, (trunk.seed % 360) * (Math.PI / 180))
        scale.set(trunk.radius, 1, trunk.radius)
        matrix.compose(position, quaternion, scale)
        mesh.setMatrixAt(index, matrix)
      })
      mesh.count = list.length
      mesh.instanceMatrix.needsUpdate = true
    },
    dispose() {
      scene.remove(mesh)
      geometry.dispose()
      material.dispose()
      mesh.dispose()
    },
  }
}
