import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createAnt, createButterfly } from '../viewpoints/bodies'

/**
 * Ambient life for the simulation: butterflies that flit between nearby
 * flowers and settle on them, and ants that walk the scent trails from the
 * ant hill. How many are out follows the activity levels (0–1) from the
 * simulation; each fades in or out by scale, never popping. They're only
 * seen, never touched (the viewer's own body doesn't collide with them).
 */

const BUTTERFLIES = 8
const ANTS = 30
const FLIGHT = { speed: 0.35, cruise: [0.1, 0.35], perch: [2, 6], wander: 1.2, flowerTop: 0.09 }
const ANT_SPEED = [0.02, 0.035]
const FADE_SECONDS = 1.2

// A stable 0–1 number per creature and purpose (k).
const rand = (i, k) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453
  return x - Math.floor(x)
}

// The ant body as one geometry (for one instanced draw of every ant).
function antGeometry() {
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
  // Butterflies: separate bodies, so their wings can beat.
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#2b2118', roughness: 0.6 })
  const butterflies = Array.from({ length: BUTTERFLIES }, (_, i) => {
    const body = createButterfly(bodyMaterial)
    body.group.visible = false
    scene.add(body.group)
    return {
      body,
      seen: 0,
      position: new THREE.Vector3(),
      target: null,
      perch: 0,
      picks: 0,
      placed: false,
      phase: rand(i, 1) * 10,
    }
  })

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

  // The next place for butterfly i (its k-th pick): mostly a flower.
  const pickTarget = (i, k, anchor, flowers) => {
    const near = flowers?.(anchor.x, anchor.z) ?? []
    if (near.length && rand(i, k * 3 + 10) < 0.8) {
      const flower = near[Math.floor(rand(i, k * 3 + 11) * near.length)]
      return { x: flower.x, z: flower.z, flower: true }
    }
    const angle = rand(i, k * 3 + 12) * Math.PI * 2
    const distance = 0.2 + rand(i, k * 3 + 13) * FLIGHT.wander
    return { x: anchor.x + Math.cos(angle) * distance, z: anchor.z + Math.sin(angle) * distance, flower: false }
  }

  return {
    meshes: [ants, ...butterflies.map((b) => b.body.group)],

    /**
     * dt, time (s); activity { butterflies, ants } (0–1); anchor: the
     * ground point the viewer looks at; sampler: the ground; trails: the
     * ants' scent trails; flowers(x, z): flower spots near (x, z).
     */
    update({ dt, time, activity, anchor, sampler, trails, flowers }) {
      const fade = dt / FADE_SECONDS
      butterflies.forEach((b, i) => {
        const wanted = i < Math.round(activity.butterflies * BUTTERFLIES) ? 1 : 0
        b.seen = Math.min(Math.max(b.seen + (wanted ? fade : -fade), 0), 1)
        b.body.group.visible = b.seen > 0.001 && Boolean(sampler)
        if (!b.body.group.visible) {
          b.placed = false
          return
        }
        if (!b.placed) {
          const angle = rand(i, 5) * Math.PI * 2
          b.position.set(anchor.x + Math.cos(angle) * 0.6, 0, anchor.z + Math.sin(angle) * 0.6)
          b.position.y = sampler.height(b.position.x, b.position.z) + FLIGHT.cruise[1]
          b.target = null
          b.placed = true
        }
        if (!b.target) {
          b.picks += 1
          b.target = pickTarget(i, b.picks, anchor, flowers)
        }
        const ground = sampler.height(b.position.x, b.position.z)
        const dx = b.target.x - b.position.x
        const dz = b.target.z - b.position.z
        const distance = Math.hypot(dx, dz)
        let beat = 1
        if (b.perch > 0) {
          // Settled on a flower: wings slow, then off again.
          b.perch -= dt
          beat = 0.25
          if (b.perch <= 0) b.target = null
        } else if (distance < 0.02) {
          b.perch = b.target.flower ? FLIGHT.perch[0] + rand(i, b.picks * 3 + 14) * (FLIGHT.perch[1] - FLIGHT.perch[0]) : 0
          if (!b.target.flower) b.target = null
        } else {
          const speed = FLIGHT.speed * (0.5 + 0.5 * activity.butterflies)
          const step = Math.min(speed * dt, distance)
          // A fluttering, wandering line toward the target.
          const wobble = Math.sin(time * 3.1 + b.phase) * 0.6
          const ux = dx / distance
          const uz = dz / distance
          b.position.x += (ux - uz * wobble) * step
          b.position.z += (uz + ux * wobble) * step
          const cruise = FLIGHT.cruise[0] + (FLIGHT.cruise[1] - FLIGHT.cruise[0]) * (0.5 + 0.5 * Math.sin(time * 0.7 + b.phase))
          const height = b.target.flower ? Math.min(cruise, FLIGHT.flowerTop + distance * 1.5) : cruise
          b.position.y += (ground + height + Math.sin(time * 6 + b.phase) * 0.01 - b.position.y) * Math.min(dt * 3, 1)
          b.body.group.rotation.set(0, Math.atan2(-ux, -uz), 0)
        }
        if (b.perch > 0) b.position.y += (ground + FLIGHT.flowerTop - b.position.y) * Math.min(dt * 4, 1)
        b.body.group.position.copy(b.position)
        b.body.group.scale.setScalar(b.seen)
        b.body.animate(time, dt, beat)
      })

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
      for (const b of butterflies) {
        scene.remove(b.body.group)
        for (const geometry of b.body.geometries) geometry.dispose()
        for (const item of b.body.extra) item.dispose()
      }
      bodyMaterial.dispose()
      scene.remove(ants)
      ants.geometry.dispose()
      ants.material.dispose()
      ants.dispose()
    },
  }
}
