import * as THREE from 'three'
import { antHillEntrances, entranceFacing } from '../paths/antTrail'
import { ANT_HILL, hash } from '../terrain/heightField'

/**
 * The ants' layer of the world: tunnel entrances on the ant hill and the
 * pheromone trails that lead from them to food (the fly agaric, the nearest
 * trunk bases, and a few seeded foraging spots). Both are decided by the
 * seed and the ground alone, like everything else, so every viewpoint shares
 * them; the trails are chemical, so only the ant perceives them (uScent),
 * unless Paths > Show pheromones draws them for every view. The trail to
 * the fly agaric follows the visible ant trail (paths/antTrail.js).
 *
 * Queries for the ant: nearestTrail, nearestEntrance, exitFrom.
 */

// Trail sampling step, ribbon half-width, and lift above the ground (m).
const STEP = 0.004
const HALF_WIDTH = 0.0018
const LIFT = 0.0007
const FORAGE = { count: 2, distance: [0.8, 1.5] }
const TRUNK_TARGETS = 2
const SALT = 4401

const LOG_DEPTH_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
`

const TRAIL_VERTEX = /* glsl */ `
${LOG_DEPTH_VERTEX}
attribute float aAlong;
attribute float aSide;
varying float vAlong;
varying float vSide;
varying vec3 vWorld;
void main() {
  vAlong = aAlong;
  vSide = aSide;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`

const TRAIL_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uScent;
uniform float uTime;
uniform float uIntensity;
uniform float uHalfWidth;
uniform vec2 uMorphCenter;
uniform vec2 uFade;
varying float vAlong;
varying float vSide;
varying vec3 vWorld;
void main() {
  #include <logdepthbuf_fragment>
  // Droplets laid every ~6 mm, over a faint continuous wash.
  vec2 cell = vec2((fract(vAlong / 0.006) - 0.5) * 0.006, vSide * uHalfWidth);
  float drop = 1.0 - smoothstep(0.0006, 0.0013, length(cell));
  float wash = 0.3 * (1.0 - vSide * vSide);
  // A slow pulse running outward from the nest.
  float pulse = 0.65 + 0.35 * sin(vAlong * 90.0 - uTime * 2.5);
  float fade = 1.0 - smoothstep(uFade.x, uFade.y, distance(vWorld.xz, uMorphCenter));
  float alpha = min((drop + wash) * pulse * fade * uScent * uIntensity, 1.0);
  vec3 color = mix(vec3(0.35, 0.95, 0.78), vec3(0.7, 0.5, 1.0), 0.5 + 0.5 * sin(vAlong * 6.0));
  gl_FragColor = vec4(color * alpha, alpha);
}
`

const ENTRANCE_VERTEX = /* glsl */ `
${LOG_DEPTH_VERTEX}
attribute float aRadial;
attribute float aIndex;
varying float vRadial;
varying float vIndex;
void main() {
  vRadial = aRadial;
  vIndex = aIndex;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`

// Dark hole fading into the soil; for the ant, a glowing scent ring that
// brightens on the entrance within reach (uNear = its index, or -1).
const ENTRANCE_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uScent;
uniform float uTime;
uniform float uNear;
varying float vRadial;
varying float vIndex;
void main() {
  #include <logdepthbuf_fragment>
  float hole = 1.0 - smoothstep(0.55, 1.0, vRadial);
  float near = 1.0 - step(0.5, abs(vIndex - uNear));
  float ring = smoothstep(0.9, 1.15, vRadial) * (1.0 - smoothstep(1.2, 1.6, vRadial));
  float glow = ring * uScent * (0.35 + 0.65 * near) * (0.75 + 0.25 * sin(uTime * 3.0));
  vec3 color = mix(vec3(0.025, 0.017, 0.012), vec3(0.45, 1.0, 0.82), glow / max(glow + hole, 0.001));
  gl_FragColor = vec4(color, max(hole * 0.96, glow * 0.8));
}
`

/** A trail as a polyline with arc length, so the ant can walk along it. */
function createTrail(points) {
  const count = points.length / 2
  const lengths = new Float32Array(count)
  for (let i = 1; i < count; i += 1) {
    lengths[i] =
      lengths[i - 1] + Math.hypot(points[i * 2] - points[i * 2 - 2], points[i * 2 + 1] - points[i * 2 - 1])
  }
  return {
    points,
    lengths,
    count,
    length: lengths[count - 1],
    /** Point and unit tangent at arc length s: out = { x, z, tx, tz }. */
    pointAt(s, out) {
      let lo = 0
      let hi = count - 1
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (lengths[mid] < s) lo = mid
        else hi = mid
      }
      const span = lengths[hi] - lengths[lo] || 1
      const t = Math.min(Math.max((s - lengths[lo]) / span, 0), 1)
      const ax = points[lo * 2]
      const az = points[lo * 2 + 1]
      const bx = points[hi * 2]
      const bz = points[hi * 2 + 1]
      const length = Math.hypot(bx - ax, bz - az) || 1
      out.x = ax + (bx - ax) * t
      out.z = az + (bz - az) * t
      out.tx = (bx - ax) / length
      out.tz = (bz - az) / length
      return out
    },
  }
}

/** A wandering path from start to end (a few metres at most). */
function wander(start, end, seed, index) {
  const length = Math.hypot(end.x - start.x, end.z - start.z)
  const steps = Math.max(Math.ceil(length / STEP), 2)
  const px = -(end.z - start.z) / length
  const pz = (end.x - start.x) / length
  const h = (k) => hash(index, k, seed + SALT)
  const amplitude = [0.05 + 0.08 * h(1), 0.015 + 0.02 * h(2)].map((a) => a * Math.min(length, 1.2))
  const frequency = [1 + Math.floor(h(3) * 2), 4 + Math.floor(h(4) * 4)]
  const phase = [h(5) * Math.PI * 2, h(6) * Math.PI * 2]
  const points = new Float32Array((steps + 1) * 2)
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const offset =
      Math.sin(Math.PI * t) *
      (amplitude[0] * Math.sin(Math.PI * 2 * frequency[0] * t + phase[0]) +
        amplitude[1] * Math.sin(Math.PI * 2 * frequency[1] * t + phase[1]))
    points[i * 2] = start.x + (end.x - start.x) * t + px * offset
    points[i * 2 + 1] = start.z + (end.z - start.z) * t + pz * offset
  }
  return points
}

export function createAntWorld(scene, morphUniforms) {
  const uniforms = {
    uScent: { value: 0 },
    uTime: { value: 0 },
    // Paths > Pheromones: strength (0–1, 0.7 is the old look) and ribbon
    // half-width (m).
    uIntensity: { value: 1 },
    uHalfWidth: { value: HALF_WIDTH },
    uNear: { value: -1 },
    uMorphCenter: morphUniforms.uMorphCenter,
    uFade: { value: new THREE.Vector2(1, 2) },
  }
  const trailMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: TRAIL_VERTEX,
    fragmentShader: TRAIL_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const entranceMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: ENTRANCE_VERTEX,
    fragmentShader: ENTRANCE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const trailMesh = new THREE.Mesh(new THREE.BufferGeometry(), trailMaterial)
  const entranceMesh = new THREE.Mesh(new THREE.BufferGeometry(), entranceMaterial)
  for (const mesh of [trailMesh, entranceMesh]) {
    mesh.frustumCulled = false
    mesh.renderOrder = 1
    scene.add(mesh)
  }

  let trails = []
  let entrances = []
  let lastSampler = null
  const pheromones = { show: false, intensity: 0.7, width: 1 }

  const buildTrailGeometry = (sampler) => {
    const positions = []
    const along = []
    const side = []
    const indices = []
    for (const trail of trails) {
      const base = positions.length / 3
      for (let i = 0; i < trail.count; i += 1) {
        const a = Math.max(i - 1, 0)
        const b = Math.min(i + 1, trail.count - 1)
        let tx = trail.points[b * 2] - trail.points[a * 2]
        let tz = trail.points[b * 2 + 1] - trail.points[a * 2 + 1]
        const length = Math.hypot(tx, tz) || 1
        tx /= length
        tz /= length
        for (const s of [-1, 1]) {
          const x = trail.points[i * 2] - tz * uniforms.uHalfWidth.value * s
          const z = trail.points[i * 2 + 1] + tx * uniforms.uHalfWidth.value * s
          positions.push(x, sampler.height(x, z) + LIFT, z)
          along.push(trail.lengths[i])
          side.push(s)
        }
        if (i > 0) {
          const k = base + i * 2
          indices.push(k - 2, k - 1, k, k - 1, k + 1, k)
        }
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1))
    geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1))
    geometry.setIndex(indices)
    return geometry
  }

  const buildEntranceGeometry = (sampler) => {
    const SEGMENTS = 20
    const RINGS = [0, 0.5, 0.8, 1, 1.15, 1.35, 1.6]
    const positions = []
    const radial = []
    const index = []
    const indices = []
    entrances.forEach((entrance, e) => {
      const base = positions.length / 3
      for (const r of RINGS) {
        for (let k = 0; k < SEGMENTS; k += 1) {
          const angle = (k / SEGMENTS) * Math.PI * 2
          const x = entrance.x + Math.cos(angle) * entrance.radius * r
          const z = entrance.z + Math.sin(angle) * entrance.radius * r
          positions.push(x, sampler.height(x, z) + LIFT * 0.6, z)
          radial.push(r)
          index.push(e)
        }
      }
      for (let ring = 0; ring < RINGS.length - 1; ring += 1) {
        for (let k = 0; k < SEGMENTS; k += 1) {
          const a = base + ring * SEGMENTS + k
          const b = base + ring * SEGMENTS + ((k + 1) % SEGMENTS)
          indices.push(a, b, a + SEGMENTS, b, b + SEGMENTS, a + SEGMENTS)
        }
      }
    })
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('aRadial', new THREE.Float32BufferAttribute(radial, 1))
    geometry.setAttribute('aIndex', new THREE.Float32BufferAttribute(index, 1))
    geometry.setIndex(indices)
    return geometry
  }

  return {
    /**
     * Rebuild for the current ground: sampler, trunks (field), seed,
     * antHill (on/off), agaric ({ x, z } or null), antTrail (the visible
     * trail, paths/antTrail.js, or null).
     */
    place({ sampler, trunks, seed, antHill, agaric, antTrail = null }) {
      trails = []
      entrances = []
      lastSampler = sampler
      if (sampler && antHill) {
        entrances.push(...antHillEntrances(seed))

        // Food: the fly agaric, the nearest trunk bases, and foraging spots.
        const targets = []
        // With a visible trail, the scent to the agaric follows it.
        if (agaric && antTrail) {
          trails.push(createTrail(Float32Array.from(antTrail.points)))
        } else if (agaric) {
          const d = Math.hypot(agaric.x - ANT_HILL.x, agaric.z - ANT_HILL.z) || 1
          const back = 0.03 / d
          targets.push({ x: agaric.x - (agaric.x - ANT_HILL.x) * back, z: agaric.z - (agaric.z - ANT_HILL.z) * back })
        }
        const nearTrunks = trunks
          ? trunks
              .trunksNear(ANT_HILL.x, ANT_HILL.z, 3)
              .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))
              .slice(0, TRUNK_TARGETS)
          : []
        for (const trunk of nearTrunks) {
          const d = Math.hypot(trunk.x - ANT_HILL.x, trunk.z - ANT_HILL.z)
          const reach = (trunk.radius + 0.04) / d
          targets.push({ x: trunk.x - (trunk.x - ANT_HILL.x) * reach, z: trunk.z - (trunk.z - ANT_HILL.z) * reach })
        }
        for (let k = 0; k < FORAGE.count; k += 1) {
          const angle = hash(seed, 30 + k, SALT) * Math.PI * 2
          const d = FORAGE.distance[0] + hash(seed, 40 + k, SALT) * (FORAGE.distance[1] - FORAGE.distance[0])
          const x = ANT_HILL.x + Math.cos(angle) * d
          const z = ANT_HILL.z + Math.sin(angle) * d
          // Skip spots inside a trunk.
          if (!trunks || trunks.distance(x, z, 1) > 0.05) targets.push({ x, z })
        }

        targets.forEach((target, index) => {
          // Leave by the entrance facing the food (the side ones first).
          const start = entranceFacing(entrances, target.x, target.z)
          // Keep each foraging trail's wander the same whether or not the
          // agaric's scent trail comes from the visible trail.
          trails.push(createTrail(wander(start, target, seed, index + (agaric && antTrail ? 1 : 0))))
        })
      }
      trailMesh.geometry.dispose()
      trailMesh.geometry = buildTrailGeometry(sampler)
      entranceMesh.geometry.dispose()
      entranceMesh.geometry = buildEntranceGeometry(sampler)
    },

    /** The scent trails ({ points, lengths, count, length, pointAt }). */
    get trails() {
      return trails
    },

    /** Nearest trail point: { trail, s, distance } or null. */
    nearestTrail(x, z) {
      let found = null
      for (const trail of trails) {
        for (let i = 0; i < trail.count; i += 1) {
          const d = Math.hypot(trail.points[i * 2] - x, trail.points[i * 2 + 1] - z)
          if (!found || d < found.distance) found = { trail, s: trail.lengths[i], distance: d }
        }
      }
      return found
    },

    /** Nearest entrance: { index, distance } or null. */
    nearestEntrance(x, z) {
      let found = null
      entrances.forEach((entrance, index) => {
        const d = Math.max(Math.hypot(entrance.x - x, entrance.z - z) - entrance.radius, 0)
        if (!found || d < found.distance) found = { index, distance: d }
      })
      return found
    },

    /** Where you come out after entering at `index`: the next entrance. */
    exitFrom(index) {
      if (entrances.length < 2) return null
      const exit = entrances[(index + 1) % entrances.length]
      let ox = exit.x - ANT_HILL.x
      let oz = exit.z - ANT_HILL.z
      const d = Math.hypot(ox, oz)
      // The main entrance has no "outward"; leave along +x.
      if (d < 1e-6) {
        ox = 1
        oz = 0
      } else {
        ox /= d
        oz /= d
      }
      const step = exit.radius + 0.006
      return { x: exit.x + ox * step, z: exit.z + oz * step, yaw: Math.atan2(-ox, -oz) }
    },

    /**
     * Paths > Pheromones: show (in every view), intensity (0–1), width
     * (ribbon width as a share of the default).
     */
    setPheromones({ show, intensity, width }) {
      Object.assign(pheromones, { show, intensity, width })
      uniforms.uIntensity.value = intensity / 0.7
      const halfWidth = HALF_WIDTH * width
      if (Math.abs(halfWidth - uniforms.uHalfWidth.value) > 1e-7 && lastSampler) {
        uniforms.uHalfWidth.value = halfWidth
        trailMesh.geometry.dispose()
        trailMesh.geometry = buildTrailGeometry(lastSampler)
      }
      uniforms.uHalfWidth.value = halfWidth
    },

    /** scent: 0–1 how much the viewer perceives; near: entrance index or -1. */
    update({ scent, time, near, fadeStart, fadeEnd }) {
      // Shown pheromones are seen by everyone; the ant smells them anyway.
      scent = pheromones.show ? Math.max(scent, 1) : scent
      uniforms.uScent.value = scent
      uniforms.uTime.value = time
      uniforms.uNear.value = near
      uniforms.uFade.value.set(fadeStart, fadeEnd)
      // Trails cost nothing for bodies that can't smell them.
      trailMesh.visible = scent > 0.002 && trails.length > 0
      entranceMesh.visible = entrances.length > 0
    },

    /** Its meshes (shown once at start-up so their shaders compile early). */
    meshes: [trailMesh, entranceMesh],

    dispose() {
      scene.remove(trailMesh, entranceMesh)
      trailMesh.geometry.dispose()
      entranceMesh.geometry.dispose()
      trailMaterial.dispose()
      entranceMaterial.dispose()
    },
  }
}
