import * as THREE from 'three'
import { LOD_LEVELS, chooseLevel } from '../../utils/branching/lod'
import { sweepGeometry } from '../../utils/branching/sweep'
import { growRoots, growSurfaceRoots } from './roots'

/**
 * Draws the tree roots in two layers:
 *
 *   surface roots  the exposed roots running over the ground from each
 *                  trunk's flare, for every trunk within SURFACE_VIEW of
 *                  you, always (they're part of the normal view)
 *   underground    the deep roots and fine roots, only while the X-ray is
 *                  on (nothing is grown or drawn otherwise)
 *
 * Both stream like tiles: wanted trunks missing a system are grown nearest
 * first, one per frame per layer, and kept until you move well away. Each
 * system is one mesh at one of the Topic 6 levels of detail
 * (utils/branching/lod.js: 100 / 35 / 10 / 3% of its woody roots, 8 / 6 /
 * 4 / 3 sides, and 100 / 50 / 15 / 0% of its fine roots), picked from how
 * big it looks on screen; a level's tubes are built the first time it's
 * needed. Woody roots are smooth swept tubes (utils/branching/sweep.js)
 * with a faint warm rim in X-ray; fine roots are lines.
 *
 * Colours:
 *   natural    weathered grey-brown wood, paler where thin; pale fine roots
 *   reference  woody roots brown to warm orange; fine roots glow orange
 *              near the wood and run to deep red or cool blue at the tips
 *   section    the cross-section: softly glowing ivory, dark umber in the
 *              thick wood to pale cream in the thin, fine roots cream to
 *              honey or a cool sage at the tips
 */

// Extra distance (m) beyond the root reach within which a trunk is wanted,
// and beyond which a built one is freed.
const WANT_MARGIN = 1
const KEEP_MARGIN = 2.5
// Surface roots are drawn for trunks this close (m), freed beyond the next.
const SURFACE_VIEW = 8
const SURFACE_KEEP = 10
const FINE_RADIUS = 0.0006
const FINE_SHARE = [1, 0.5, 0.15, 0]
const PALETTES = {
  reference: {
    thick: '#5b3a25',
    thin: '#c8743e',
    rim: '#ffb070',
    fine: [
      ['#e08048', '#b8341f'],
      ['#d0703c', '#4a8ee8'],
    ],
  },
  section: {
    thick: '#5c4632',
    thin: '#c9b48e',
    rim: '#f4e2bc',
    fine: [
      ['#e6d2a6', '#a8844e'],
      ['#dccaa0', '#7f9a8a'],
    ],
  },
  natural: {
    thick: '#5e4c3d',
    thin: '#b8a184',
    rim: '#ffd2a0',
    fine: [
      ['#a08668', '#d8c6a8'],
      ['#8f7a62', '#c9b79b'],
    ],
  },
}
const colorsOf = (name) => {
  const palette = PALETTES[name] ?? PALETTES.reference
  return {
    thick: new THREE.Color(palette.thick),
    thin: new THREE.Color(palette.thin),
    rim: new THREE.Color(palette.rim),
    fine: palette.fine.map((pair) => pair.map((color) => new THREE.Color(color))),
  }
}

/** The fine roots as one line mesh, coloured along each strand. */
function fineGeometry({ positions, tints, kinds }, palette) {
  const colors = new Float32Array(positions.length)
  const color = new THREE.Color()
  for (let vertex = 0; vertex < tints.length; vertex += 1) {
    const [from, to] = palette.fine[kinds[vertex]]
    color.copy(from).lerp(to, tints[vertex]).toArray(colors, vertex * 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeBoundingSphere()
  return geometry
}

const RIM_DECLARATIONS = /* glsl */ `
uniform float uRim;
uniform vec3 uRimColor;
uniform float uSoilFade;
uniform vec3 uSoilColor;
uniform float uGlow;
`
// The cross-section: roots stay crisp close by and fade into the dark soil
// further off.
const SOIL_FRAGMENT = /* glsl */ `
#include <fog_fragment>
gl_FragColor.rgb = mix(gl_FragColor.rgb, uSoilColor, uSoilFade * 0.9 * smoothstep(1.5, 7.0, length(vViewPosition)));
`
const RIM_FRAGMENT = /* glsl */ `
{
  float facing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
  totalEmissiveRadiance += uRimColor * pow(1.0 - facing, 3.0) * uRim;
  // The cross-section: roots glow in their own colours.
  totalEmissiveRadiance += diffuseColor.rgb * uGlow;
}
#include <emissivemap_fragment>
`

const keyOf = (trunk) => `${trunk.x.toFixed(4)},${trunk.z.toFixed(4)}`

export function createRootRenderer(scene) {
  const group = new THREE.Group()
  group.visible = false
  const surfaceGroup = new THREE.Group()
  scene.add(group, surfaceGroup)

  const rimUniforms = {
    uRim: { value: 0 },
    uRimColor: { value: new THREE.Color() },
    uSoilColor: { value: new THREE.Color('#050404') },
  }
  const fineMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })
  // Two copies: the underground one fades into the soil and glows in the
  // cross-section; the surface one keeps the forest haze, since its roots
  // lie on the ground in plain view.
  const makeMaterial = (name, own) => {
    const made = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
    made.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, rimUniforms, own)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${RIM_DECLARATIONS}`)
        .replace('#include <emissivemap_fragment>', RIM_FRAGMENT)
        .replace('#include <fog_fragment>', SOIL_FRAGMENT)
    }
    made.customProgramCacheKey = () => name
    return made
  }
  const underUniforms = { uSoilFade: { value: 0 }, uGlow: { value: 0 } }
  const material = makeMaterial('underground-roots', underUniforms)
  const surfaceUniforms = { uSoilFade: { value: 0 }, uGlow: { value: 0 } }
  const surfaceMaterial = makeMaterial('surface-roots', surfaceUniforms)

  // Per layer, key → { trunk, roots, levels: [{ geometry, segments,
  // triangles } | null], mesh, lines (underground only), level }
  const systems = new Map()
  const surfaces = new Map()
  let settingsKey = null
  let palette = colorsOf('natural')
  let pending = 0

  const freeFrom = (layer, layerGroup, key) => {
    const system = layer.get(key)
    layerGroup.remove(system.mesh)
    system.levels.forEach((level) => level?.geometry.dispose())
    if (system.lines) {
      layerGroup.remove(system.lines)
      system.lines.geometry.dispose()
    }
    layer.delete(key)
  }
  const clear = () => {
    ;[...systems.keys()].forEach((key) => freeFrom(systems, group, key))
    ;[...surfaces.keys()].forEach((key) => freeFrom(surfaces, surfaceGroup, key))
  }
  // Free systems beyond `keep` of the anchor; return the wanted trunks
  // (within `want`) still missing one, nearest first.
  const stream = (layer, layerGroup, trunks, anchor, want, keep) => {
    for (const [key, system] of layer) {
      if (Math.hypot(system.trunk.x - anchor.x, system.trunk.z - anchor.z) > keep) freeFrom(layer, layerGroup, key)
    }
    return trunks
      .trunksNear(anchor.x, anchor.z, want)
      .filter((trunk) => !layer.has(keyOf(trunk)))
      .sort((a, b) => Math.hypot(a.x - anchor.x, a.z - anchor.z) - Math.hypot(b.x - anchor.x, b.z - anchor.z))
  }

  const levelOf = (system, index) => {
    if (!system.levels[index]) {
      const { roots } = system
      const { fraction, sides } = LOD_LEVELS[index]
      const thickest = roots.radii.reduce((max, radius) => Math.max(max, radius), FINE_RADIUS)
      const span = Math.log(thickest / FINE_RADIUS) || 1
      const count = Math.max(1, Math.ceil(roots.segments.length * fraction))
      const keep = new Set(roots.hierarchy.importance.slice(0, count))
      const { geometry, triangles } = sweepGeometry(roots.segments, roots.hierarchy, {
        keep,
        sides,
        weights: roots.radii,
        radiusOf: (segment) => roots.radii[segment],
        colorOf: (segment, color) =>
          color.copy(palette.thick).lerp(palette.thin, 1 - Math.log(roots.radii[segment] / FINE_RADIUS) / span),
      })
      system.levels[index] = { geometry, segments: count, triangles }
    }
    return system.levels[index]
  }

  return {
    /**
     * Once per frame.
     * active: X-ray on; rim: 0–1 glow; trunks, height(x, z): the ground's
     * trunk field and height; anchor: where you look; settings:
     * DEFAULT_ROOTS; version: changes whenever the ground does; soil: 0 –
     * 1, how much the roots fade into dark soil with distance (the
     * cross-section).
     */
    update({ active, rim, soil = 0, trunks, height, anchor, camera, viewportHeight, settings, version }) {
      underUniforms.uSoilFade.value = soil
      underUniforms.uGlow.value = 1.4 * soil
      // The surface roots carry on underground, so they glow too.
      surfaceUniforms.uGlow.value = 1.4 * soil
      // Underground in the cross-section: no forest haze on the roots (the
      // soil fade replaces it). Switching recompiles the material once.
      const hazed = soil < 0.5
      if (material.fog !== hazed) {
        material.fog = hazed
        material.needsUpdate = true
      }
      group.visible = active && settings.roots
      surfaceGroup.visible = settings.roots && Boolean(trunks)
      rimUniforms.uRim.value = rim
      // In the cross-section the fine roots glow (added onto the dark soil).
      fineMaterial.opacity = Math.max(Math.min(rim, 1) * 0.85, soil * 0.4)
      fineMaterial.blending = soil > 0.5 ? THREE.AdditiveBlending : THREE.NormalBlending
      const key = [version, ...Object.values(settings)].join('|')
      if (key !== settingsKey) {
        clear()
        settingsKey = key
        palette = colorsOf(settings.colors)
        rimUniforms.uRimColor.value.copy(palette.rim)
      }
      pending = 0
      if (!surfaceGroup.visible) return

      // Surface roots: always, for the trunks around you.
      const missingSurface = stream(surfaces, surfaceGroup, trunks, anchor, SURFACE_VIEW, SURFACE_KEEP)
      if (missingSurface.length) {
        const trunk = missingSurface[0]
        const mesh = new THREE.Mesh(undefined, surfaceMaterial)
        mesh.castShadow = true
        mesh.receiveShadow = true
        surfaceGroup.add(mesh)
        surfaces.set(keyOf(trunk), { trunk, roots: growSurfaceRoots(trunk, height, settings), levels: [], mesh, level: -1 })
      }

      // Underground: only in X-ray.
      const missing = group.visible
        ? stream(systems, group, trunks, anchor, settings.reach + WANT_MARGIN, settings.reach + KEEP_MARGIN)
        : []
      pending = missing.length
      if (missing.length) {
        const trunk = missing[0]
        const roots = growRoots(trunk, height, settings)
        const mesh = new THREE.Mesh(undefined, material)
        const lines = new THREE.LineSegments(fineGeometry(roots.fine, palette), fineMaterial)
        group.add(mesh, lines)
        systems.set(keyOf(trunk), { trunk, roots, levels: [], mesh, lines, level: -1 })
        pending -= 1
      }

      // Each system's level from how big it looks: its reach seen from here.
      const pixelsPerUnit = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360))
      for (const system of [...surfaces.values(), ...(group.visible ? systems.values() : [])]) {
        const distance = Math.max(camera.position.distanceTo(system.roots.center), 0.05)
        const pixels = ((settings.reach * 2) / distance) * pixelsPerUnit
        const level = chooseLevel(pixels, Math.max(system.level, 0), 1)
        if (level !== system.level) {
          system.level = level
          system.mesh.geometry = levelOf(system, level).geometry
          if (!system.lines) continue
          const { strandEnds } = system.roots.fine
          const strands = Math.round(strandEnds.length * FINE_SHARE[level])
          system.lines.geometry.setDrawRange(0, strands ? strandEnds[strands - 1] : 0)
        }
      }
    },

    /**
     * The underground layer's { trees, pending, segments, triangles, fine,
     * perLevel }, plus surfaceTrees, for the panel.
     */
    stats() {
      const perLevel = [0, 0, 0, 0]
      let segments = 0
      let triangles = 0
      let fine = 0
      for (const system of systems.values()) {
        if (system.level < 0) continue
        perLevel[system.level] += 1
        segments += system.levels[system.level].segments
        triangles += system.levels[system.level].triangles
        fine += Math.round(system.roots.fine.strandEnds.length * FINE_SHARE[system.level])
      }
      return { trees: systems.size, surfaceTrees: surfaces.size, pending, segments, triangles, fine, perLevel }
    },

    dispose() {
      clear()
      scene.remove(group, surfaceGroup)
      material.dispose()
      surfaceMaterial.dispose()
      fineMaterial.dispose()
    },
  }
}
