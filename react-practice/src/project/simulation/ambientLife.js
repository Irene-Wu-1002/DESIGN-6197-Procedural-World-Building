import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createAnt } from '../viewpoints/bodies'

/**
 * Ambient life for the simulation: ants that walk the scent trails from the
 * ant hill. How many are out follows the ants' activity level (0–1) from the
 * simulation; each fades in or out by scale, never popping. They're only
 * seen, never touched (the viewer's own body doesn't collide with them).
 * (The butterflies are autonomous agents now: ecology/.)
 */

const ANTS = 30
const ANT_SPEED = [0.02, 0.035]
const FADE_SECONDS = 1.2

// A stable 0–1 number per creature and purpose (k).
const rand = (i, k) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453
  return x - Math.floor(x)
}

// The ant body as one geometry (for one instanced draw of every ant).
export function antGeometry() {
  const material = new THREE.MeshStandardMaterial()
  const ant = createAnt(material)
  ant.group.updateMatrixWorld(true)
  const parts = []
  ant.group.traverse((object) => {
    if (!object.isMesh) return
    const geometry = object.geometry.clone()
    geometry.applyMatrix4(object.matrixWorld)
    parts.push(geometry)
  })
  const merged = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  for (const geometry of ant.geometries) geometry.dispose()
  material.dispose()
  return merged
}

export function createAmbientLife(scene) {
  // Ants: one instanced mesh.
  const ants = new THREE.InstancedMesh(antGeometry(), new THREE.MeshStandardMaterial({ color: '#1c120c', roughness: 0.5 }), ANTS)
  ants.castShadow = true
  ants.frustumCulled = false
  ants.count = 0
  scene.add(ants)
  const antState = Array.from({ length: ANTS }, (_, i) => ({
    seen: 0,
    s: rand(i, 2),
    direction: rand(i, 3) < 0.5 ? 1 : -1,
    speed: ANT_SPEED[0] + rand(i, 4) * (ANT_SPEED[1] - ANT_SPEED[0]),
  }))
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const position = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const point = {}

  return {
    meshes: [ants],

    /**
     * dt (s); activity { ants } (0–1); sampler: the ground; trails: the
     * ants' scent trails.
     */
    update({ dt, activity, sampler, trails }) {
      const fade = dt / FADE_SECONDS
      // Ants walk back and forth along the trails.
      let count = 0
      if (sampler && trails?.length) {
        antState.forEach((ant, i) => {
          const wanted = i < Math.round(activity.ants * ANTS) ? 1 : 0
          ant.seen = Math.min(Math.max(ant.seen + (wanted ? fade : -fade), 0), 1)
          if (ant.seen <= 0.001) return
          const trail = trails[i % trails.length]
          ant.s += ant.direction * ant.speed * (0.4 + 0.6 * activity.ants) * dt / Math.max(trail.length, 0.01)
          if (ant.s > 1 || ant.s < 0) {
            ant.direction *= -1
            ant.s = Math.min(Math.max(ant.s, 0), 1)
          }
          trail.pointAt(ant.s * trail.length, point)
          position.set(point.x, sampler.height(point.x, point.z), point.z)
          quaternion.setFromAxisAngle(up, Math.atan2(-point.tx * ant.direction, -point.tz * ant.direction))
          scale.setScalar(ant.seen)
          matrix.compose(position, quaternion, scale)
          ants.setMatrixAt(count, matrix)
          count += 1
        })
      }
      ants.count = count
      ants.instanceMatrix.needsUpdate = true
    },

    dispose() {
      scene.remove(ants)
      ants.geometry.dispose()
      ants.material.dispose()
      ants.dispose()
    },
  }
}
