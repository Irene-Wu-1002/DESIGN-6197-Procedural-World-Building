import * as THREE from 'three'
import { createWaterField } from './water'

/**
 * Draws the water in the ground (water.js) while X-ray or the
 * cross-section is on:
 *
 *   pockets  the saturated lenses around you, one InstancedMesh of
 *            squashed spheres: clear water, dark through the middle with
 *            a bright rim where you look across the surface (fresnel)
 *   table    in X-ray, the water table as a sheet under the point you
 *            look at, fading out toward its edge, with slow caustic ripples
 *            running over it (the cross-section draws it in the cut
 *            instead: behind the cut it would fill the whole window)
 *
 * Both draw before the see-through ground (negative renderOrder), which
 * writes depth and would otherwise hide them.
 *
 * Both follow you: the sheet is rebuilt on a world-aligned grid when you
 * move a cell, the pockets when you move POCKET_MOVE. The field itself is
 * rebuilt when the ground or the settings change (field, key: for the
 * cross-section, which tints the cut with it).
 *
 * Colours follow the roots': natural (a faint grey-blue), glow (vivid
 * blue), section (teal, glowing in the dark of the cross-section).
 */

const POCKET_VIEW = 7
const POCKET_MOVE = 0.3
const POCKET_CAPACITY = 512
const SHEET_RADIUS = 5
// The table is smooth (the ripples are in the shader), so a coarse grid is
// enough: about 1,700 ground samples whenever you cross a cell.
const SHEET_CELL = 0.25
const PALETTES = {
  natural: { body: '#4d6f80', rim: '#a9cfe0', sheet: '#7fa8bc', opacity: 0.22, glow: 0.6 },
  reference: { body: '#1f5fae', rim: '#7cc8ff', sheet: '#3f98ff', opacity: 0.3, glow: 1.1 },
  section: { body: '#1e6a78', rim: '#8ae6f0', sheet: '#4cc4d6', opacity: 0.3, glow: 1.2 },
}

const POCKET_DECLARATIONS = /* glsl */ `
uniform vec3 uRimColor;
uniform float uGlow;
`
const POCKET_FRAGMENT = /* glsl */ `
{
  float facing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
  float rim = pow(1.0 - facing, 2.5);
  totalEmissiveRadiance += uRimColor * (0.15 + rim) * uGlow;
  diffuseColor.a = clamp(diffuseColor.a + rim * 0.6, 0.0, 1.0);
}
#include <emissivemap_fragment>
`

const SHEET_VERTEX = /* glsl */ `
#include <common>
varying vec3 vWorld;
`
const SHEET_FRAGMENT = /* glsl */ `
#include <common>
uniform float uTime;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uGlow;
varying vec3 vWorld;
`
// Caustics: three slow crossing wave trains, sharpened where they meet.
const SHEET_COLOR = /* glsl */ `
#include <color_fragment>
{
  vec2 p = vWorld.xz * 9.0;
  float t = uTime * 0.6;
  float waves = sin(p.x + t) + sin(p.y * 1.3 - t * 0.8) + sin((p.x + p.y) * 0.7 + t * 1.3);
  float caustic = pow(1.0 - abs(waves) / 3.0, 6.0);
  float edge = 1.0 - smoothstep(uRadius * 0.45, uRadius, distance(vWorld.xz, uCenter));
  diffuseColor.rgb *= 1.0 + 0.7 * caustic * uGlow;
  diffuseColor.a *= edge * (0.35 + 0.8 * caustic);
}
`

export function createWaterRenderer(scene) {
  const group = new THREE.Group()
  group.visible = false
  scene.add(group)

  // Pockets.
  const pocketUniforms = { uRimColor: { value: new THREE.Color() }, uGlow: { value: 1 } }
  const pocketMaterial = new THREE.MeshStandardMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.15,
    metalness: 0,
  })
  pocketMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, pocketUniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${POCKET_DECLARATIONS}`)
      .replace('#include <emissivemap_fragment>', POCKET_FRAGMENT)
  }
  pocketMaterial.customProgramCacheKey = () => 'water-pockets'
  const pockets = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 24, 16), pocketMaterial, POCKET_CAPACITY)
  pockets.count = 0
  pockets.frustumCulled = false
  pockets.renderOrder = -0.1
  group.add(pockets)

  // The water table.
  const side = Math.round((SHEET_RADIUS * 2) / SHEET_CELL)
  const sheetGeometry = new THREE.PlaneGeometry(1, 1, side, side)
  sheetGeometry.rotateX(-Math.PI / 2)
  const sheetUniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector2() },
    uRadius: { value: SHEET_RADIUS },
    uGlow: { value: 1 },
  }
  const sheetMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  sheetMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sheetUniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', SHEET_VERTEX)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorld = transformed;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', SHEET_FRAGMENT)
      .replace('#include <color_fragment>', SHEET_COLOR)
  }
  sheetMaterial.customProgramCacheKey = () => 'water-table'
  const sheet = new THREE.Mesh(sheetGeometry, sheetMaterial)
  sheet.frustumCulled = false
  sheet.renderOrder = -0.2
  group.add(sheet)

  let field = null
  let fieldKey = null
  let paletteName = null
  const pocketsAt = new THREE.Vector3(Infinity, 0, 0)
  const sheetAt = new THREE.Vector2(Infinity, 0)
  const matrix = new THREE.Matrix4()
  const rotation = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const scale = new THREE.Vector3()
  const place = new THREE.Vector3()
  let nearby = 0
  let tableBelow = null

  const buildPockets = (anchor) => {
    const list = field.pocketsNear(anchor.x, anchor.z, POCKET_VIEW).slice(0, POCKET_CAPACITY)
    list.forEach((pocket, index) => {
      // Local x along (cos yaw, sin yaw), as in water.js.
      rotation.setFromAxisAngle(up, -pocket.yaw)
      matrix.compose(place.set(pocket.x, pocket.y, pocket.z), rotation, scale.set(pocket.rx, pocket.ry, pocket.rz))
      pockets.setMatrixAt(index, matrix)
    })
    pockets.count = list.length
    pockets.instanceMatrix.needsUpdate = true
    nearby = list.length
    pocketsAt.copy(anchor)
  }

  // The sheet's vertices on the world grid around the anchor.
  const buildSheet = (cx, cz) => {
    const positions = sheetGeometry.attributes.position
    const originX = (cx - side / 2) * SHEET_CELL
    const originZ = (cz - side / 2) * SHEET_CELL
    for (let row = 0; row <= side; row += 1) {
      for (let column = 0; column <= side; column += 1) {
        const x = originX + column * SHEET_CELL
        const z = originZ + row * SHEET_CELL
        positions.setXYZ(row * (side + 1) + column, x, field.tableAt(x, z), z)
      }
    }
    positions.needsUpdate = true
    sheetAt.set(cx, cz)
  }

  return {
    /** The current water field (water.js) and a key that changes with it. */
    get field() {
      return field
    },
    get key() {
      return fieldKey
    },
    /** The materials the cross-section clips. */
    materials: [pocketMaterial, sheetMaterial],

    /**
     * Once per frame. active: X-ray or the cross-section is on; sheet:
     * show the table's sheet (X-ray); sampler:
     * the ground; settings: DEFAULT_WATER's keys plus wetness (Habitat %);
     * colors: the roots' palette name; version: changes with the ground.
     */
    update({ active, sheet: showSheet, sampler, settings, anchor, colors, time, version }) {
      const on = Boolean(sampler) && settings.water
      const key = on ? [version, settings.tableDepth, settings.pockets, settings.wetness].join('|') : null
      if (key !== fieldKey) {
        fieldKey = key
        field = on ? createWaterField(sampler, settings, settings.wetness / 100) : null
        pocketsAt.set(Infinity, 0, 0)
        sheetAt.set(Infinity, 0)
      }
      group.visible = active && Boolean(field)
      sheet.visible = showSheet
      if (!field) {
        nearby = 0
        tableBelow = null
        return
      }
      tableBelow = sampler.height(anchor.x, anchor.z) - field.tableAt(anchor.x, anchor.z)
      if (!group.visible) return

      if (colors !== paletteName) {
        paletteName = colors
        const palette = PALETTES[colors] ?? PALETTES.natural
        pocketMaterial.color.set(palette.body)
        pocketMaterial.opacity = palette.opacity
        pocketUniforms.uRimColor.value.set(palette.rim)
        pocketUniforms.uGlow.value = palette.glow
        sheetMaterial.color.set(palette.sheet)
        sheetMaterial.opacity = palette.opacity
        sheetUniforms.uGlow.value = palette.glow
      }
      sheetUniforms.uTime.value = time

      if (Math.hypot(anchor.x - pocketsAt.x, anchor.z - pocketsAt.z) > POCKET_MOVE) buildPockets(anchor)
      const cx = Math.round(anchor.x / SHEET_CELL)
      const cz = Math.round(anchor.z / SHEET_CELL)
      if (cx !== sheetAt.x || cz !== sheetAt.y) buildSheet(cx, cz)
      sheetUniforms.uCenter.value.set(anchor.x, anchor.z)
    },

    /** { pockets nearby, tableBelow: m from the ground to the table where you look, or null }. */
    stats() {
      return { pockets: nearby, tableBelow }
    },

    dispose() {
      scene.remove(group)
      pockets.geometry.dispose()
      pockets.dispose()
      pocketMaterial.dispose()
      sheetGeometry.dispose()
      sheetMaterial.dispose()
    },
  }
}
