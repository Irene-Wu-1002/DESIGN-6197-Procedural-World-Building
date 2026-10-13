import * as THREE from 'three'
import { DEAD } from './particles'

/**
 * Drawing for particle pools:
 *   createPointsRenderer  soft round dots (seeds, dust), one draw call
 *   createLeafRenderer    small flat leaves as an InstancedMesh
 *   createWindStreaks     short moving lines that trace the wind near the ground
 */

const POINTS_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const POINTS_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.15, d) * vAlpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor, alpha);
  }
`

/**
 * Soft dots that read straight from the pool's arrays (no copying).
 * Call setViewport(heightPx, fovDegrees) on resize so sizes are in metres.
 */
export function createPointsRenderer(pool) {
  const geometry = new THREE.BufferGeometry()
  const attribute = (array, size) =>
    new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', attribute(pool.position, 3))
  geometry.setAttribute('aColor', attribute(pool.color, 3))
  geometry.setAttribute('aSize', attribute(pool.size, 1))
  geometry.setAttribute('aAlpha', attribute(pool.alpha, 1))
  const material = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 } },
    vertexShader: POINTS_VERTEX,
    fragmentShader: POINTS_FRAGMENT,
    transparent: true,
    depthWrite: false,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false

  return {
    object: points,
    update() {
      for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) {
        geometry.attributes[name].needsUpdate = true
      }
    },
    setViewport(heightPx, fovDegrees) {
      material.uniforms.uScale.value =
        heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2))
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

// A small diamond lying flat in the x/z plane. Larger than life (≈22 cm)
// so single leaves stay readable from the default camera distance.
function leafGeometry() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.11, 0, 0, 0, 0, 0.07, 0.11, 0, 0, 0, 0, -0.07], 3)
  )
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  return geometry
}

/** Leaves as one InstancedMesh; alive leaves are packed to the front each frame. */
export function createLeafRenderer(pool) {
  const geometry = leafGeometry()
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.8,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.InstancedMesh(geometry, material, pool.capacity)
  mesh.count = 0
  mesh.frustumCulled = false
  mesh.setColorAt(0, new THREE.Color('#ffffff'))

  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Euler()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const color = new THREE.Color()

  return {
    object: mesh,
    update() {
      let count = 0
      for (let index = 0; index < pool.capacity; index += 1) {
        if (pool.state[index] === DEAD || pool.size[index] <= 0) continue
        const p = index * 3
        position.set(pool.position[p], pool.position[p + 1], pool.position[p + 2])
        rotation.set(pool.spin[p], pool.spin[p + 1], pool.spin[p + 2])
        quaternion.setFromEuler(rotation)
        scale.setScalar(pool.size[index])
        matrix.compose(position, quaternion, scale)
        mesh.setMatrixAt(count, matrix)
        color.setRGB(pool.color[p], pool.color[p + 1], pool.color[p + 2])
        mesh.setColorAt(count, color)
        count += 1
      }
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      mesh.dispose()
    },
  }
}

const STREAK = {
  count: 500,
  life: [1.5, 3],
  height: 0.15,
  // Tail length in seconds of travel.
  trail: 0.3,
}

/**
 * Wind-field overlay: short streaks that ride the wind just above the ground,
 * brighter where the wind is stronger. Uses its own simple random generator.
 */
export function createWindStreaks() {
  const { count } = STREAK
  const heads = new Float32Array(count * 2)
  const age = new Float32Array(count)
  const life = new Float32Array(count)
  const positions = new Float32Array(count * 6)
  const colors = new Float32Array(count * 8)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
  )
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage))
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  })
  const lines = new THREE.LineSegments(geometry, material)
  lines.frustumCulled = false
  const air = { x: 0, y: 0, z: 0, gust: 1, speed: 0 }
  let state = 0x9e3779b9
  const random = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }

  const respawn = (index, size) => {
    heads[index * 2] = (random() - 0.5) * size
    heads[index * 2 + 1] = (random() - 0.5) * size
    life[index] = STREAK.life[0] + random() * (STREAK.life[1] - STREAK.life[0])
    age[index] = random() * life[index]
  }

  let seeded = false
  return {
    object: lines,
    /** wind: wind field; ground: createGround(). */
    update(dt, wind, ground) {
      const size = wind.size
      if (!seeded) {
        for (let index = 0; index < count; index += 1) respawn(index, size)
        seeded = true
      }
      const reference = Math.max(wind.base, 0.5) * 1.3
      for (let index = 0; index < count; index += 1) {
        age[index] += dt
        let x = heads[index * 2]
        let z = heads[index * 2 + 1]
        if (age[index] >= life[index] || !ground.inside(x, z)) {
          respawn(index, size)
          age[index] = 0
          x = heads[index * 2]
          z = heads[index * 2 + 1]
        }
        const floor = ground.height(x, z)
        wind.sample(x, floor + 0.5, z, air)
        x += air.x * dt
        z += air.z * dt
        heads[index * 2] = x
        heads[index * 2 + 1] = z
        const tailX = x - air.x * STREAK.trail
        const tailZ = z - air.z * STREAK.trail
        const p = index * 6
        positions[p] = x
        positions[p + 1] = ground.height(x, z) + STREAK.height
        positions[p + 2] = z
        positions[p + 3] = tailX
        positions[p + 4] = ground.height(tailX, tailZ) + STREAK.height
        positions[p + 5] = tailZ
        const fade = Math.min(1, age[index] / 0.4, (life[index] - age[index]) / 0.4)
        const strength = Math.min(Math.hypot(air.x, air.z) / reference, 1)
        const c = index * 8
        // Head bright, tail transparent; colour from calm blue to strong white.
        colors[c] = 0.55 + 0.45 * strength
        colors[c + 1] = 0.75 + 0.25 * strength
        colors[c + 2] = 1
        colors[c + 3] = fade * (0.35 + 0.65 * strength)
        colors[c + 4] = colors[c]
        colors[c + 5] = colors[c + 1]
        colors[c + 6] = 1
        colors[c + 7] = 0
      }
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.needsUpdate = true
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
