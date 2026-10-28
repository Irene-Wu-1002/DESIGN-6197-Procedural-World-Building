import * as THREE from 'three'
import { createWaterField } from './water'
import { createWaterParticles } from './waterParticles'
import { createGlowPoints } from './glowPoints'

/**
 * Draws the water in the ground while X-ray or the cross-section is on:
 *
 *   particles  the water particle system (waterParticles.js): soft round
 *              dots added onto the dark soil, so dense clusters glow, pale
 *              cyan when born to deep blue as they age
 *   field      with Show field, the vector field pushing them: short lines
 *              on a world-aligned lattice between the table and the
 *              ground, dark blue at the tail to pale cyan at the head,
 *              longer where the water moves faster (redrawn a few times a
 *              second, since the swirl drifts)
 *
 * Both draw before the see-through ground (negative renderOrder), which
 * writes depth and would otherwise hide them. The water field (water.js)
 * is rebuilt when the ground or the settings change (field, key: the
 * cross-section draws the table's line in its cut from it).
 */

// Brightness by root palette: the natural look is a little quieter.
const GLOW = { natural: 0.75, reference: 1, section: 1 }
const ARROW = { spacing: 0.5, radius: 2.5, levels: 5, length: 0.2, fullSpeed: 0.35, every: 0.2 }
const ARROW_TAIL = new THREE.Color('#1c2a8c')
const ARROW_HEAD = new THREE.Color('#bdefff')

export function createWaterRenderer(scene) {
  const group = new THREE.Group()
  group.visible = false
  scene.add(group)

  // Particles, drawn straight from the pool's arrays.
  const system = createWaterParticles()
  const { pool } = system
  const points = createGlowPoints(pool)
  points.object.renderOrder = -0.1
  group.add(points.object)

  // Field arrows.
  const across = Math.round((ARROW.radius * 2) / ARROW.spacing) + 1
  const arrowCount = across * across * ARROW.levels
  const arrowPositions = new Float32Array(arrowCount * 6)
  const arrowColors = new Float32Array(arrowCount * 6)
  const arrowGeometry = new THREE.BufferGeometry()
  arrowGeometry.setAttribute('position', new THREE.BufferAttribute(arrowPositions, 3).setUsage(THREE.DynamicDrawUsage))
  arrowGeometry.setAttribute('color', new THREE.BufferAttribute(arrowColors, 3).setUsage(THREE.DynamicDrawUsage))
  const arrowMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const arrows = new THREE.LineSegments(arrowGeometry, arrowMaterial)
  arrows.frustumCulled = false
  arrows.renderOrder = -0.1
  arrows.visible = false
  group.add(arrows)

  let field = null
  let fieldKey = null
  let tableBelow = null
  let arrowTimer = 0
  const flow = [0, 0, 0]
  const head = new THREE.Color()

  const buildArrows = (anchor) => {
    const cx = Math.round(anchor.x / ARROW.spacing)
    const cz = Math.round(anchor.z / ARROW.spacing)
    let n = 0
    for (let row = 0; row < across; row += 1) {
      for (let column = 0; column < across; column += 1) {
        const x = (cx + column - (across - 1) / 2) * ARROW.spacing
        const z = (cz + row - (across - 1) / 2) * ARROW.spacing
        const ground = system.groundAt(x, z) - 0.05
        const table = system.tableAt(x, z) + 0.05
        for (let level = 0; level < ARROW.levels; level += 1) {
          const y = table + ((ground - table) * level) / (ARROW.levels - 1)
          system.fieldAt(x, y, z, flow)
          const speed = Math.hypot(flow[0], flow[1], flow[2]) || 1
          const length = ARROW.length * Math.min(speed / ARROW.fullSpeed, 1)
          const p = n * 6
          arrowPositions[p] = x
          arrowPositions[p + 1] = y
          arrowPositions[p + 2] = z
          arrowPositions[p + 3] = x + (flow[0] / speed) * length
          arrowPositions[p + 4] = y + (flow[1] / speed) * length
          arrowPositions[p + 5] = z + (flow[2] / speed) * length
          // Fade the far lattice, so it has no hard edge.
          const fade = 1 - Math.min(Math.hypot(x - anchor.x, z - anchor.z) / (ARROW.radius + 0.25), 1)
          ARROW_TAIL.toArray(arrowColors, p)
          head.copy(ARROW_HEAD).multiplyScalar(fade).toArray(arrowColors, p + 3)
          for (let c = 0; c < 3; c += 1) arrowColors[p + c] *= fade
          n += 1
        }
      }
    }
    arrowGeometry.attributes.position.needsUpdate = true
    arrowGeometry.attributes.color.needsUpdate = true
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
    materials: [points.material, arrowMaterial],

    /**
     * Once per frame. active: X-ray or the cross-section is on; sampler:
     * the ground; trunks: the trunk field; trees: the tree water states
     * (treeWater.js; thirsty trees pull harder); roots: { reach, rootDepth, colors };
     * settings: DEFAULT_WATER's keys plus wetness (Habitat %); version:
     * changes with the ground; camera, viewportHeight: for point sizes.
     */
    update({ active, dt, sampler, trunks, trees, roots, settings, anchor, camera, viewportHeight, version }) {
      const on = Boolean(sampler) && settings.water
      const key = on ? [version, settings.tableDepth, settings.pockets, settings.wetness].join('|') : null
      if (key !== fieldKey) {
        fieldKey = key
        field = on ? createWaterField(sampler, settings, settings.wetness / 100) : null
      }
      group.visible = active && Boolean(field)
      tableBelow = field ? sampler.height(anchor.x, anchor.z) - field.tableAt(anchor.x, anchor.z) : null
      // Off or out of sight: let the particles go (they restart fresh).
      if (!group.visible) {
        system.update({ field: null })
        return
      }

      // More water in wetter soil.
      const rate = settings.particles * (0.5 + settings.wetness / 100)
      system.update({ dt, field, sampler, trunks, roots, anchor, rate, demandOf: (trunk) => trees?.demandOf(trunk) ?? 1 })
      points.update(camera, viewportHeight, GLOW[roots.colors] ?? 1)

      arrows.visible = settings.showField && system.ready
      arrowTimer -= dt
      if (arrows.visible && arrowTimer <= 0) {
        arrowTimer = ARROW.every
        buildArrows(anchor)
      }
    },

    /** { particles alive, pockets nearby, tableBelow: m from the ground to the table where you look, or null }. */
    stats() {
      return {
        particles: pool.alive,
        pockets: group.visible ? system.pocketCount : 0,
        tableBelow,
      }
    },

    dispose() {
      scene.remove(group)
      points.dispose()
      arrowGeometry.dispose()
      arrowMaterial.dispose()
    },
  }
}
