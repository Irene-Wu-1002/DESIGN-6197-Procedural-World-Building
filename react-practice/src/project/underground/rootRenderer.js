import * as THREE from 'three'
import { LOD_LEVELS, chooseLevel } from '../../utils/branching/lod'
import { sweepGeometry } from '../../utils/branching/sweep'
import { growRoots } from './roots'

/**
 * Draws the root systems under the trunks near you, only while the
 * underground X-ray is on (nothing is grown or drawn otherwise).
 *
 * Root systems stream like tiles: the trunks whose roots can reach the area
 * you see are wanted; missing ones are grown nearest first, one per frame,
 * and kept until you move well away. Each system is one mesh at one of the
 * Topic 6 levels of detail (utils/branching/lod.js: 100 / 35 / 10 / 3% of
 * its woody roots, 8 / 6 / 4 / 3 sides, and 100 / 50 / 15 / 0% of its fine
 * roots), picked from how big it looks on screen; a level's tubes are built
 * the first time it's needed. Woody roots are smooth swept tubes
 * (utils/branching/sweep.js) with a faint warm rim; fine roots are lines.
 *
 * Colours:
 *   reference  woody roots brown to warm orange; fine roots glow orange
 *              near the wood and run to deep red or cool blue at the tips
 *   natural    bark-brown woody roots, pale tan fine roots
 */

// Extra distance (m) beyond the root reach within which a trunk is wanted,
// and beyond which a built one is freed.
const WANT_MARGIN = 1
const KEEP_MARGIN = 2.5
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
  natural: {
    thick: '#6e4c33',
    thin: '#dcc6a2',
    rim: '#ffc58a',
    fine: [
      ['#b89b7a', '#e6d6b8'],
      ['#b89b7a', '#e6d6b8'],
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
`
const RIM_FRAGMENT = /* glsl */ `
{
  float facing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
  totalEmissiveRadiance += uRimColor * pow(1.0 - facing, 3.0) * uRim;
}
#include <emissivemap_fragment>
`

const keyOf = (trunk) => `${trunk.x.toFixed(4)},${trunk.z.toFixed(4)}`

export function createRootRenderer(scene) {
  const group = new THREE.Group()
  group.visible = false
  scene.add(group)

  const rimUniforms = {
    uRim: { value: 0 },
    uRimColor: { value: new THREE.Color() },
  }
  const fineMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, rimUniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${RIM_DECLARATIONS}`)
      .replace('#include <emissivemap_fragment>', RIM_FRAGMENT)
  }
  material.customProgramCacheKey = () => 'underground-roots'

  // key → { trunk, roots, levels: [{ geometry, segments, triangles } | null],
  //         mesh, lines, level }
  const systems = new Map()
  let settingsKey = null
  let palette = colorsOf('reference')
  let pending = 0

  const free = (key) => {
    const system = systems.get(key)
    group.remove(system.mesh, system.lines)
    system.levels.forEach((level) => level?.geometry.dispose())
    system.lines.geometry.dispose()
    systems.delete(key)
  }
  const clear = () => [...systems.keys()].forEach(free)

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
     * DEFAULT_ROOTS; version: changes whenever the ground does.
     */
    update({ active, rim, trunks, height, anchor, camera, viewportHeight, settings, version }) {
      group.visible = active && settings.roots
      rimUniforms.uRim.value = rim
      fineMaterial.opacity = Math.min(rim, 1) * 0.85
      const key = [version, ...Object.values(settings)].join('|')
      if (key !== settingsKey) {
        clear()
        settingsKey = key
        palette = colorsOf(settings.colors)
        rimUniforms.uRimColor.value.copy(palette.rim)
      }
      if (!group.visible || !trunks) {
        pending = 0
        return
      }

      // Free systems you've left behind; grow the nearest missing one.
      for (const [systemKey, system] of systems) {
        if (Math.hypot(system.trunk.x - anchor.x, system.trunk.z - anchor.z) > settings.reach + KEEP_MARGIN) {
          free(systemKey)
        }
      }
      const missing = trunks
        .trunksNear(anchor.x, anchor.z, settings.reach + WANT_MARGIN)
        .filter((trunk) => !systems.has(keyOf(trunk)))
        .sort((a, b) => Math.hypot(a.x - anchor.x, a.z - anchor.z) - Math.hypot(b.x - anchor.x, b.z - anchor.z))
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
      for (const system of systems.values()) {
        const distance = Math.max(camera.position.distanceTo(system.roots.center), 0.05)
        const pixels = ((settings.reach * 2) / distance) * pixelsPerUnit
        const level = chooseLevel(pixels, Math.max(system.level, 0), 1)
        if (level !== system.level) {
          system.level = level
          system.mesh.geometry = levelOf(system, level).geometry
          const { strandEnds } = system.roots.fine
          const strands = Math.round(strandEnds.length * FINE_SHARE[level])
          system.lines.geometry.setDrawRange(0, strands ? strandEnds[strands - 1] : 0)
        }
      }
    },

    /** { trees, pending, segments, triangles, fine, perLevel } for the panel. */
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
      return { trees: systems.size, pending, segments, triangles, fine, perLevel }
    },

    dispose() {
      clear()
      scene.remove(group)
      material.dispose()
      fineMaterial.dispose()
    },
  }
}
