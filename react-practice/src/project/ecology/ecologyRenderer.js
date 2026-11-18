import * as THREE from 'three'
import { createButterflyBody } from './butterflyBody'
import { LOD, SCENT, SCENT_DISPLAY, SCENT_TYPES } from './ecologyConfig'

/**
 * Draws the ecology: the butterflies (one body each, at most a dozen), the
 * flower scent as soft points, and the development overlay (senses,
 * targets). Reads the ecology's state and never writes it, so what is
 * shown (scent on or off, how many of its particles, the overlay) cannot
 * change what the butterflies sense or do.
 *
 * The scent is drawn as a translation for people: a butterfly does not see
 * scent, and air has no visible lines. Each scent type has a faint tint;
 * a particle fades in after it leaves the flower and out as it weakens.
 */

const MAX_POINT_PIXELS = 10
// Debug overlay vertices per butterfly (line pairs).
const RING = 32
const DEBUG_VERTICES = (RING * 2 + 4 + 16 * 2 * 2 + 2) * 2

const SCENT_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aAlpha;
attribute float aType;
uniform float uScale;
uniform float uSize;
uniform vec3 uColors[${SCENT_TYPES.length}];
varying vec3 vColor;
varying float vAlpha;
void main() {
  int t = int(aType + 0.5);
  vColor = uColors[0];
  ${SCENT_TYPES.map((_, k) => (k ? `if (t == ${k}) vColor = uColors[${k}];` : '')).join('\n  ')}
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float size = uSize * uScale / -mvPosition.z;
  // Never smaller than ~1.5 px; tiny ones fade instead of vanishing.
  vAlpha = aAlpha * min(size / 1.5, 1.0);
  gl_PointSize = clamp(size, 1.5, ${MAX_POINT_PIXELS.toFixed(1)});
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`
const SCENT_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float alpha = smoothstep(0.5, 0.05, d) * vAlpha * uOpacity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(vColor, alpha);
  #include <logdepthbuf_fragment>
  #include <colorspace_fragment>
}
`

// A stable 0–1 number per particle serial (which ones are drawn).
const serialShare = (serial) => (Math.imul(serial, 2654435761) >>> 0) / 4294967296

export function createEcologyRenderer(scene) {
  // --- Scent.
  const capacity = SCENT.capacity
  const positions = new Float32Array(capacity * 3)
  const alphas = new Float32Array(capacity)
  const types = new Float32Array(capacity)
  const geometry = new THREE.BufferGeometry()
  const dynamic = (array, size) => new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', dynamic(positions, 3))
  geometry.setAttribute('aAlpha', dynamic(alphas, 1))
  geometry.setAttribute('aType', dynamic(types, 1))
  geometry.setDrawRange(0, 0)
  const scentMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: 600 },
      uSize: { value: SCENT_DISPLAY.size },
      uOpacity: { value: SCENT_DISPLAY.opacity },
      uColors: { value: SCENT_TYPES.map((type) => new THREE.Color(type.color)) },
    },
    vertexShader: SCENT_VERTEX,
    fragmentShader: SCENT_FRAGMENT,
    transparent: true,
    depthWrite: false,
  })
  const scentPoints = new THREE.Points(geometry, scentMaterial)
  scentPoints.frustumCulled = false
  scentPoints.renderOrder = 2
  scene.add(scentPoints)

  // --- Butterflies (bodies made as agents appear).
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#2b2118', roughness: 0.6 })
  const bodies = new Map()

  // --- Development overlay.
  const debugPositions = new Float32Array(12 * DEBUG_VERTICES * 3)
  const debugColors = new Float32Array(12 * DEBUG_VERTICES * 3)
  const debugGeometry = new THREE.BufferGeometry()
  debugGeometry.setAttribute('position', dynamic(debugPositions, 3))
  debugGeometry.setAttribute('color', dynamic(debugColors, 3))
  const debugMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthTest: false })
  const debugLines = new THREE.LineSegments(debugGeometry, debugMaterial)
  debugLines.frustumCulled = false
  debugLines.renderOrder = 3
  debugLines.visible = false
  scene.add(debugLines)
  const colors = {
    vision: new THREE.Color('#9fd3ff'),
    smell: new THREE.Color('#ffc6e0'),
    smelt: new THREE.Color('#ff6fae'),
    target: new THREE.Color('#ffe066'),
    heading: new THREE.Color('#ffffff'),
  }

  const bodyFor = (agent) => {
    let body = bodies.get(agent)
    if (!body) {
      body = createButterflyBody(bodyMaterial, { proboscis: agent.traits.proboscis, scale: agent.traits.scale, morph: agent.morph })
      scene.add(body.group)
      bodies.set(agent, body)
      body.morphVersion = agent.morphVersion
    }
    // Its body was changed (the follow panel's sliders): reshape in place.
    if (body.morphVersion !== agent.morphVersion) {
      body.applyMorph(agent.morph)
      body.morphVersion = agent.morphVersion
    }
    return body
  }

  return {
    /** Everything this draws (for compiling shaders up front). */
    get meshes() {
      return [scentPoints, ...[...bodies.values()].map((body) => body.group)]
    },

    /**
     * frame: { ecology, dt, camera, pixels (viewport px per unit at 1 m),
     * showScent, share (0–1 drawn), debug, follow, hidden (0–1: X-ray) }.
     */
    update({ ecology, dt, camera, pixels, showScent, share, debug, follow, hidden = 0 }) {
      // Scent: copy the drawn subset (by serial, so it never flickers).
      const scent = ecology.scent
      let drawn = 0
      if (showScent && hidden < 0.5) {
        for (let i = 0; i < scent.count; i += 1) {
          if (serialShare(scent.serial[i]) >= share) continue
          positions[drawn * 3] = scent.px[i]
          positions[drawn * 3 + 1] = scent.py[i]
          positions[drawn * 3 + 2] = scent.pz[i]
          const age = scent.age[i]
          const fadeIn = Math.min(age / 0.6, 1)
          const fadeOut = 1 - Math.max((age - scent.life[i] * 0.75) / (scent.life[i] * 0.25), 0)
          alphas[drawn] = fadeIn * fadeOut * Math.min(scent.strength[i] * scent.emitScale, 1)
          types[drawn] = scent.type[i]
          drawn += 1
        }
      }
      geometry.setDrawRange(0, drawn)
      if (drawn > 0) {
        geometry.attributes.position.addUpdateRange(0, drawn * 3)
        geometry.attributes.aAlpha.addUpdateRange(0, drawn)
        geometry.attributes.aType.addUpdateRange(0, drawn)
        geometry.attributes.position.needsUpdate = true
        geometry.attributes.aAlpha.needsUpdate = true
        geometry.attributes.aType.needsUpdate = true
      }
      scentPoints.visible = drawn > 0
      scentMaterial.uniforms.uScale.value = pixels

      // Butterflies.
      const alive = new Set()
      for (const agent of ecology.agents) {
        alive.add(agent)
        const body = bodyFor(agent)
        body.group.visible = agent.seen > 0.001 && hidden < 0.5
        if (!body.group.visible) continue
        const distance = Math.hypot(agent.position.x - camera.position.x, agent.position.y - camera.position.y, agent.position.z - camera.position.z)
        body.update(agent, dt, agent.index === follow || distance < LOD.near)
      }
      for (const [agent, body] of bodies) {
        if (alive.has(agent)) continue
        scene.remove(body.group)
        body.dispose()
        bodies.delete(agent)
      }

      // Overlay: visual range ring and field of view, antenna sampling
      // spheres (pink when it smells something), heading, line to target.
      debugLines.visible = Boolean(debug)
      if (!debug) return
      let v = 0
      const line = (ax, ay, az, bx, by, bz, color) => {
        if (v + 2 > debugPositions.length / 3) return
        debugPositions.set([ax, ay, az, bx, by, bz], v * 3)
        debugColors.set([color.r, color.g, color.b, color.r, color.g, color.b], v * 3)
        v += 2
      }
      const ring = (cx, cy, cz, radius, color, from = 0, to = Math.PI * 2, segments = RING) => {
        for (let k = 0; k < segments; k += 1) {
          const a = from + ((to - from) * k) / segments
          const b = from + ((to - from) * (k + 1)) / segments
          line(cx + Math.cos(a) * radius, cy, cz + Math.sin(a) * radius, cx + Math.cos(b) * radius, cy, cz + Math.sin(b) * radius, color)
        }
      }
      for (const agent of ecology.agents) {
        if (agent.seen <= 0.001) continue
        const p = agent.position
        const range = agent.traits.visualRange
        // Field of view as an arc, centred on the heading (yaw: forward = (−sin, −cos)).
        const heading = Math.atan2(-Math.cos(agent.yaw), -Math.sin(agent.yaw))
        ring(p.x, p.y, p.z, range, colors.vision, heading - agent.traits.fov, heading + agent.traits.fov)
        for (const side of [-1, 1]) {
          const edge = heading + side * agent.traits.fov
          line(p.x, p.y, p.z, p.x + Math.cos(edge) * range, p.y, p.z + Math.sin(edge) * range, colors.vision)
        }
        const fx = -Math.sin(agent.yaw)
        const fz = -Math.cos(agent.yaw)
        line(p.x, p.y, p.z, p.x + fx * 0.06, p.y, p.z + fz * 0.06, colors.heading)
        const spread = SCENT.sniffRadius * 0.5
        const head = 0.02 * agent.traits.scale
        for (const side of [-1, 1]) {
          const cx = p.x + fx * head - fz * side * spread
          const cz = p.z + fz * head + fx * side * spread
          ring(cx, p.y, cz, SCENT.sniffRadius, agent.percept.smelt ? colors.smelt : colors.smell, 0, Math.PI * 2, 16)
        }
        if (agent.target) line(p.x, p.y, p.z, agent.target.x, agent.target.y, agent.target.z, colors.target)
      }
      debugGeometry.setDrawRange(0, v)
      debugGeometry.attributes.position.needsUpdate = true
      debugGeometry.attributes.color.needsUpdate = true
    },

    dispose() {
      scene.remove(scentPoints, debugLines)
      geometry.dispose()
      scentMaterial.dispose()
      debugGeometry.dispose()
      debugMaterial.dispose()
      for (const body of bodies.values()) {
        scene.remove(body.group)
        body.dispose()
      }
      bodies.clear()
      bodyMaterial.dispose()
    },
  }
}
