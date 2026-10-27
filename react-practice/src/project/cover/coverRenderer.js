import * as THREE from 'three'
import { TILE_SIZE } from '../terrain/heightField'
import {
  FLOWER_COLORS,
  FLOWER_STEM_COLOR,
  LEAF_COLORS,
  MOSS_COLORS,
  MUSHROOM_COLORS,
  SEASON_HEADROOM,
  TWIG_COLORS,
} from './coverRules'
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
attribute float aPresence;
uniform float uPresenceLevel;
uniform vec2 uMorphCenter;
uniform vec2 uCoverFade;
uniform float uHide;
uniform float uWind;
uniform float uTime;
`

// Flowers sway in the wind (uWind 0–1), more toward the top.
const SWAY_VERTEX = /* glsl */ `
#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 swayBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float swayPhase = swayBase.x * 41.0 + swayBase.z * 37.0;
  float gust = sin(uTime * 2.3 + swayPhase) + 0.5 * sin(uTime * 5.1 + swayPhase * 1.7);
  transformed.x += gust * uWind * 0.12 * position.y * position.y;
}
#endif
`

// Wet cover is a little darker and glossier (rain).
const WET_COLOR = /* glsl */ `
#include <color_fragment>
diffuseColor.rgb *= 1.0 - 0.22 * uWet;
`
const WET_ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor *= 1.0 - 0.45 * uWet;
`
// Each item also shows only once its kind's season level reaches its
// presence (aPresence), growing in over a short band, so a season fades
// things in and out where they stand.
const FADE_VERTEX = /* glsl */ `
#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 coverBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  transformed *= 1.0 - smoothstep(uCoverFade.x, uCoverFade.y, distance(coverBase.xz, uMorphCenter));
  transformed *= smoothstep(aPresence - 0.04, aPresence, uPresenceLevel);
  // Underground X-ray: everything shrinks away together.
  transformed *= 1.0 - uHide;
#endif
`

// Leaves: green (instance colour) or autumn (aAutumnColor), turned once the
// autumn share (uAutumn) passes the leaf's rank, so they turn gradually.
const LEAF_VERTEX_DECLARATIONS = /* glsl */ `
attribute vec3 aAutumnColor;
attribute float aAutumnRank;
uniform float uAutumn;
varying vec3 vAutumnColor;
varying float vAutumnMix;
`
const LEAF_VERTEX = /* glsl */ `
#include <begin_vertex>
vAutumnColor = aAutumnColor;
vAutumnMix = smoothstep(aAutumnRank - 0.03, aAutumnRank + 0.03, uAutumn);
`
const LEAF_COLOR = /* glsl */ `
#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, vAutumnColor * (1.0 - 0.22 * uWet), vAutumnMix);
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
// Petals fold up into a bud as the light fades (uOpen 1 open – 0 closed):
// each petal is pulled in and its tip lifted, more toward the tip.
const FLOWER_VERTEX = /* glsl */ `
#include <begin_vertex>
vPetal = aPetal;
if (aPetal >= 0.0) {
  float closed = 1.0 - uOpen;
  float reach = max(length(transformed.xz) - 0.012, 0.0);
  transformed.xz *= mix(1.0, 0.3, closed * smoothstep(0.0, 0.2, reach));
  transformed.y += reach * closed * 0.9;
}
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

/**
 * level: this kind's season level ({ value }); leaf: two-colour leaves.
 */
function applyFade(material, uniforms, key, { moss = false, flower = false, sway = false, level, leaf = false } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uPresenceLevel: level })
    let vertex = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FADE_DECLARATIONS}`)
      .replace('#include <begin_vertex>', FADE_VERTEX)
    if (sway) vertex = vertex.replace('#include <begin_vertex>', SWAY_VERTEX)
    if (leaf) {
      vertex = vertex
        .replace('#include <common>', `#include <common>\n${LEAF_VERTEX_DECLARATIONS}`)
        .replace('#include <begin_vertex>', LEAF_VERTEX)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vAutumnColor;\nvarying float vAutumnMix;')
        .replace('#include <color_fragment>', LEAF_COLOR)
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;')
      .replace('#include <color_fragment>', WET_COLOR)
      .replace('#include <roughnessmap_fragment>', WET_ROUGHNESS)
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
        .replace('#include <common>', '#include <common>\nattribute float aPetal;\nvarying float vPetal;\nuniform float uOpen;')
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
 * Returns { setTile, removeTile, sync, setHidden, setClipping, setFadeRange,
 * setUV, dispose }.
 */
export function createCoverRenderer(scene, morphUniforms) {
  const uniforms = {
    uMorphCenter: morphUniforms.uMorphCenter,
    uCoverFade: { value: new THREE.Vector2(1, 2) },
    // 0 shown – 1 gone (the underground X-ray view).
    uHide: { value: 0 },
    uUV: { value: 0 },
    // Flowers: 1 open – 0 closed (the day cycle closes them at night).
    uOpen: { value: 1 },
    // Weather: wind (sway) and wetness, and the clock for the sway.
    uWind: { value: 0 },
    uWet: { value: 0 },
    uTime: { value: 0 },
    // Leaves: share in autumn colours (the Scatter setting, or the season).
    uAutumn: { value: 0.5 },
  }
  // Season levels per kind (see SEASON_HEADROOM): items show when their
  // presence ≤ the level; 1 / headroom is the Scatter amounts as set.
  const base = 1 / SEASON_HEADROOM
  const levels = {
    always: { value: 1 },
    leaves: { value: base },
    flowers: { value: base },
    mushrooms: { value: base },
    moss: { value: base },
  }
  const leafGeometries = createLeafGeometries()
  const mushroom = createMushroomGeometries()
  const flower = createFlowerGeometries()
  // Shadows follow the same fades, so one depth material per kind.
  const depthMaterials = Object.fromEntries(
    Object.entries(levels).map(([kind, level]) => [
      kind,
      applyFade(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), uniforms, `cover-depth-${kind}`, {
        level,
      }),
    ])
  )
  const standard = (options, key, kind, extra = {}) =>
    applyFade(new THREE.MeshStandardMaterial({ color: '#ffffff', ...options }), uniforms, `${key}-${kind}`, {
      ...extra,
      level: levels[kind],
    })

  // Each part: geometry, material, capacity, and how to pick its items and colour.
  const parts = [
    ...leafGeometries.map((geometry, variant) => ({
      id: `leaf${variant}`,
      geometry,
      kind: 'leaves',
      material: standard({ roughness: 0.85, side: THREE.DoubleSide }, 'cover-leaf', 'leaves', { leaf: true }),
      capacity: 6000,
      castShadow: false,
      items: (tile) => tile.leaves[variant],
      // Green as the instance colour, autumn as the second colour.
      color: (item, out) => {
        out.copy(palettes.green[item.greenPalette])
        out.multiplyScalar((0.85 + 0.3 * item.shade) * (1 - DAMP_DARKEN * smoothstep(0.55, 0.85, item.damp)))
      },
      autumnColor: (item, out) => {
        out.copy(palettes.autumn[item.autumnPalette])
        out.multiplyScalar((0.85 + 0.3 * item.shade) * (1 - DAMP_DARKEN * smoothstep(0.55, 0.85, item.damp)))
      },
      autumnRank: (item) => item.autumnRank,
    })),
    {
      id: 'twig',
      geometry: createTwigGeometry(),
      kind: 'always',
      material: standard({ roughness: 0.95, flatShading: true }, 'cover-wood', 'always'),
      capacity: 2000,
      castShadow: true,
      items: (tile) => tile.twigs,
      color: (item, out) => out.copy(palettes.twig[item.palette]).multiplyScalar(0.8 + 0.4 * item.shade),
    },
    {
      id: 'branch',
      geometry: createBranchGeometry(),
      kind: 'always',
      material: standard({ roughness: 0.95, flatShading: true }, 'cover-wood', 'always'),
      capacity: 800,
      castShadow: true,
      items: (tile) => tile.branches,
      color: (item, out) => out.copy(palettes.twig[item.palette]).multiplyScalar(0.8 + 0.4 * item.shade),
    },
    {
      id: 'moss',
      geometry: createMossGeometry(),
      kind: 'moss',
      material: standard({ roughness: 1 }, 'cover-moss', 'moss', { moss: true }),
      capacity: 12000,
      castShadow: true,
      items: (tile) => tile.moss,
      color: (item, out) => out.copy(palettes.moss[item.palette]).multiplyScalar(0.8 + 0.4 * item.shade),
    },
    {
      id: 'mushroomStem',
      geometry: mushroom.stem,
      kind: 'mushrooms',
      material: standard({ roughness: 0.8 }, 'cover-mushroom', 'mushrooms'),
      capacity: 1500,
      castShadow: true,
      items: (tile) => tile.mushrooms,
      color: (item, out) => out.copy(palettes.stem).multiplyScalar(0.9 + 0.15 * item.shade),
    },
    {
      id: 'mushroomCap',
      geometry: mushroom.cap,
      kind: 'mushrooms',
      material: standard({ roughness: 0.6 }, 'cover-mushroom', 'mushrooms'),
      capacity: 1500,
      castShadow: true,
      items: (tile) => tile.mushrooms,
      color: (item, out) => out.copy(palettes.mushroom[item.palette]).multiplyScalar(0.85 + 0.3 * item.shade),
    },
    {
      id: 'flowerStem',
      geometry: flower.stem,
      kind: 'flowers',
      material: standard({ roughness: 0.8, side: THREE.DoubleSide }, 'cover-flower-stem', 'flowers', { sway: true }),
      capacity: 3000,
      castShadow: true,
      items: (tile) => tile.flowers ?? [],
      color: (item, out) => out.copy(palettes.flowerStem).multiplyScalar(0.85 + 0.3 * item.shade),
    },
    {
      id: 'flowerHead',
      geometry: flower.head,
      kind: 'flowers',
      material: standard({ roughness: 0.55, side: THREE.DoubleSide }, 'cover-flower-head', 'flowers', {
        flower: true,
        sway: true,
      }),
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
    mesh.customDepthMaterial = depthMaterials[part.kind]
    mesh.setColorAt(0, new THREE.Color())
    // Per instance: presence, and for leaves the autumn colour and rank.
    part.geometry.setAttribute('aPresence', new THREE.InstancedBufferAttribute(new Float32Array(part.capacity), 1))
    if (part.autumnColor) {
      part.geometry.setAttribute('aAutumnColor', new THREE.InstancedBufferAttribute(new Float32Array(part.capacity * 3), 3))
      part.geometry.setAttribute('aAutumnRank', new THREE.InstancedBufferAttribute(new Float32Array(part.capacity), 1))
    }
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
      const presence = new Float32Array(list.length)
      const autumnColors = part.autumnColor ? new Float32Array(list.length * 3) : null
      const autumnRanks = part.autumnColor ? new Float32Array(list.length) : null
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
        presence[index] = item.presence ?? 0
        if (autumnColors) {
          part.autumnColor(item, color)
          color.toArray(autumnColors, index * 3)
          autumnRanks[index] = part.autumnRank(item)
        }
      })
      baked[part.id] = { matrices, colors, presence, autumnColors, autumnRanks, count: list.length }
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
    /**
     * Seasons: levels { leaves, flowers, mushrooms, moss } (items with
     * presence ≤ level show; 1 / SEASON_HEADROOM is the Scatter amounts),
     * and autumn: the share of leaves in autumn colours (0–1).
     */
    setSeason({ leaves, flowers, mushrooms, moss, autumn }) {
      levels.leaves.value = leaves
      levels.flowers.value = flowers
      levels.mushrooms.value = mushrooms
      levels.moss.value = moss
      uniforms.uAutumn.value = autumn
    },
    /** Weather on the cover: wind 0–1 (flowers sway), wet 0–1, time (s). */
    setWeather({ wind, wet, time }) {
      uniforms.uWind.value = wind
      uniforms.uWet.value = wet
      uniforms.uTime.value = time
    },
    /** How open the flowers are (0 closed – 1 open). */
    setFlowerOpen(value) {
      uniforms.uOpen.value = value
    },
    /** Shrink all cover away (0 shown – 1 gone), for the underground X-ray. */
    setHidden(value) {
      uniforms.uHide.value = value
    },
    /** Clipping planes for all cover (the underground cross-section), or []. */
    setClipping(planes) {
      for (const part of parts) part.material.clippingPlanes = planes
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
        const presence = part.geometry.attributes.aPresence
        const autumnColor = part.geometry.attributes.aAutumnColor
        const autumnRank = part.geometry.attributes.aAutumnRank
        let count = 0
        for (const baked of tiles.values()) {
          const block = baked[part.id]
          const take = Math.min(block.count, capacity - count)
          if (take <= 0) continue
          mesh.instanceMatrix.array.set(block.matrices.subarray(0, take * 16), count * 16)
          mesh.instanceColor.array.set(block.colors.subarray(0, take * 3), count * 3)
          presence.array.set(block.presence.subarray(0, take), count)
          if (autumnColor) {
            autumnColor.array.set(block.autumnColors.subarray(0, take * 3), count * 3)
            autumnRank.array.set(block.autumnRanks.subarray(0, take), count)
          }
          count += take
        }
        mesh.count = count
        mesh.instanceMatrix.needsUpdate = true
        mesh.instanceColor.needsUpdate = true
        presence.needsUpdate = true
        if (autumnColor) {
          autumnColor.needsUpdate = true
          autumnRank.needsUpdate = true
        }
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
      for (const material of Object.values(depthMaterials)) material.dispose()
    },
  }
}

// --- Trunks: always drawn out into the haze, refreshed when you cross a tile.
const TRUNK_VIEW = 13
const TRUNK_CAPACITY = 256

/** The height a trunk stands at: the lowest ground around it, so its root
 * flare never floats. */
export function trunkGround(trunk, sampler) {
  let ground = sampler.height(trunk.x, trunk.z)
  for (let k = 0; k < 6; k += 1) {
    const angle = (k / 6) * Math.PI * 2
    ground = Math.min(
      ground,
      sampler.height(trunk.x + Math.cos(angle) * trunk.radius * 1.4, trunk.z + Math.sin(angle) * trunk.radius * 1.4)
    )
  }
  return ground
}

export function createTrunkRenderer(scene) {
  let geometry = createTrunkGeometry()
  let height = null
  const material = new THREE.MeshStandardMaterial({ color: '#3e3128', roughness: 1 })
  // The cross-section cuts the buried base away (below where the trunk
  // stands), so the roots show under it.
  const buried = { value: 0 }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCutBuried = buried
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vTrunkY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrunkY = position.y;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uCutBuried;\nvarying float vTrunkY;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (uCutBuried > 0.5 && vTrunkY < 0.0) discard;')
  }
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
    /** Hide the buried base (the cross-section). */
    setCutBuried(on) {
      buried.value = on ? 1 : 0
    },
    /** trunkHeight: the visible trunk (m), up to where the crown starts. */
    update(trunks, sampler, focusX, focusZ, version, trunkHeight) {
      if (trunkHeight !== height) {
        height = trunkHeight
        geometry.dispose()
        geometry = createTrunkGeometry(trunkHeight)
        mesh.geometry = geometry
      }
      const key = `${Math.floor(focusX / TILE_SIZE)},${Math.floor(focusZ / TILE_SIZE)},${version}`
      if (key === lastKey || !trunks || !sampler) return
      lastKey = key
      const list = trunks.trunksNear(focusX, focusZ, TRUNK_VIEW).slice(0, TRUNK_CAPACITY)
      list.forEach((trunk, index) => {
        position.set(trunk.x, trunkGround(trunk, sampler), trunk.z)
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
