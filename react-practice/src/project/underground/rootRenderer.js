import * as THREE from 'three'
import { LOD_LEVELS, buildLevelGeometry, chooseLevel } from '../../utils/branching/lod'
import { growRoots } from './roots'

/**
 * Draws the root systems under the trunks near you, only while the
 * underground X-ray is on (nothing is grown or drawn otherwise).
 *
 * Root systems stream like tiles: the trunks whose roots can reach the area
 * you see are wanted; missing ones are grown nearest first, one per frame,
 * and kept until you move well away. Each system is one mesh at one of the
 * Topic 6 levels of detail (utils/branching/lod.js: 100 / 35 / 10 / 3% of
 * its roots, 8 / 6 / 4 / 3 sides), picked from how big it looks on screen;
 * a level's tubes are built the first time it's needed.
 *
 * The roots are natural bark-brown, darker and thicker near the trunk, with
 * a faint warm rim so they still read against the dark soil.
 */

// Extra distance (m) beyond the root reach within which a trunk is wanted,
// and beyond which a built one is freed.
const WANT_MARGIN = 1
const KEEP_MARGIN = 2.5
const THICK = new THREE.Color('#6e4c33')
const FINE = new THREE.Color('#dcc6a2')
const FINE_RADIUS = 0.0006

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
    uRimColor: { value: new THREE.Color('#ffc58a') },
  }
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, rimUniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${RIM_DECLARATIONS}`)
      .replace('#include <emissivemap_fragment>', RIM_FRAGMENT)
  }
  material.customProgramCacheKey = () => 'underground-roots'

  // key → { trunk, roots, levels: [{ geometry, segments, triangles } | null], mesh, level }
  const systems = new Map()
  let settingsKey = null
  let pending = 0

  const free = (key) => {
    const system = systems.get(key)
    group.remove(system.mesh)
    system.levels.forEach((level) => level?.geometry.dispose())
    systems.delete(key)
  }
  const clear = () => [...systems.keys()].forEach(free)

  const levelOf = (system, index) => {
    if (!system.levels[index]) {
      const { roots } = system
      const thickest = roots.radii.reduce((max, radius) => Math.max(max, radius), FINE_RADIUS)
      const span = Math.log(thickest / FINE_RADIUS) || 1
      system.levels[index] = buildLevelGeometry(roots, roots.hierarchy, 0, LOD_LEVELS[index], {
        radiusOf: (segment) => roots.radii[segment],
        colorOf: (segment, color) =>
          color.copy(THICK).lerp(FINE, 1 - Math.log(roots.radii[segment] / FINE_RADIUS) / span),
      })
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
      const key = `${version}|${settings.reach}|${settings.structural}|${settings.branching}|${settings.depthBias}|${settings.sinkers}`
      if (key !== settingsKey) {
        clear()
        settingsKey = key
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
        const mesh = new THREE.Mesh(undefined, material)
        group.add(mesh)
        systems.set(keyOf(trunk), { trunk, roots: growRoots(trunk, height, settings), levels: [], mesh, level: -1 })
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
        }
      }
    },

    /** { trees, pending, segments, triangles, perLevel } for the panel. */
    stats() {
      const perLevel = [0, 0, 0, 0]
      let segments = 0
      let triangles = 0
      for (const system of systems.values()) {
        if (system.level < 0) continue
        perLevel[system.level] += 1
        segments += system.levels[system.level].segments
        triangles += system.levels[system.level].triangles
      }
      return { trees: systems.size, pending, segments, triangles, perLevel }
    },

    dispose() {
      clear()
      scene.remove(group)
      material.dispose()
    },
  }
}
