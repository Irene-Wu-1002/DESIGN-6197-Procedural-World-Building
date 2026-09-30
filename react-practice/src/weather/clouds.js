import * as THREE from 'three'
import { createRandom } from '../utils/noise3d'

// Clouds: clusters of soft, camera-facing puffs. Each cluster has a random
// "cover threshold", so raising cloud cover fades more clusters in. Wind
// drifts the field (wrapping at its edges), and the cloud base drops as
// cover rises, so in rain the canopy reaches up into the clouds.

const CLUSTERS = 56
const PUFFS_PER_CLUSTER = 7
const COUNT = CLUSTERS * PUFFS_PER_CLUSTER
const WIND_SPEED = 16 // metres per second at wind = 1

// Cloud base: well above the canopy in fair weather, dropping to just over
// the tallest crowns when overcast, so only the treetops reach into cloud.
export function cloudBaseHeight(treeHeight, cover) {
  return treeHeight * (1.4 - 0.28 * cover)
}

const vertexShader = `
  attribute vec3 aCenter;
  attribute float aScale;
  attribute float aOpacity;
  attribute float aSeed;
  varying vec2 vUv;
  varying float vOpacity;
  varying float vSeed;
  varying float vDepth;

  void main() {
    // Billboard: offset the quad corners in view space so it faces the camera.
    vec4 center = viewMatrix * vec4(aCenter, 1.0);
    center.xy += position.xy * aScale;
    vUv = position.xy;
    vOpacity = aOpacity;
    vSeed = aSeed;
    vDepth = -center.z;
    gl_Position = projectionMatrix * center;
  }
`

const fragmentShader = `
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec2 vUv;
  varying float vOpacity;
  varying float vSeed;
  varying float vDepth;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  void main() {
    vec2 p = vUv * 2.6 + vSeed * 17.0;
    float n = noise(p) * 0.6 + noise(p * 2.1) * 0.4;
    float radius = length(vUv) + (n - 0.5) * 0.45;
    float alpha = smoothstep(1.0, 0.3, radius) * vOpacity;
    if (alpha < 0.01) discard;

    // Lit from above, shaded underneath.
    float light = clamp(vUv.y * 0.55 + 0.55 + (n - 0.5) * 0.3, 0.0, 1.0);
    vec3 color = mix(uShade, uLit, light);
    color = mix(color, uFogColor, smoothstep(uFogNear, uFogFar, vDepth));

    gl_FragColor = vec4(color, alpha * 0.92);
    #include <colorspace_fragment>
  }
`

export function createClouds(seed = 2026) {
  const random = createRandom(seed * 131 + 7)

  // Static layout, in field units (x, z in -1..1) and metres (puff offsets).
  const clusters = []
  for (let c = 0; c < CLUSTERS; c += 1) {
    clusters.push({
      x: random() * 2 - 1,
      z: random() * 2 - 1,
      lift: random(), // position inside the cloud layer's thickness
      size: 0.7 + random() * 0.6,
      threshold: random() * 0.95,
    })
  }
  const puffs = []
  clusters.forEach((cluster, index) => {
    for (let p = 0; p < PUFFS_PER_CLUSTER; p += 1) {
      puffs.push({
        cluster: index,
        dx: (random() * 2 - 1) * 30,
        dy: (random() * 2 - 1) * 5,
        dz: (random() * 2 - 1) * 30,
        scale: 13 + random() * 13,
        seed: random(),
      })
    }
  })

  const base = new THREE.PlaneGeometry(2, 2)
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.index = base.index
  geometry.setAttribute('position', base.attributes.position)
  geometry.instanceCount = COUNT
  const centers = new Float32Array(COUNT * 3)
  const scales = new Float32Array(COUNT)
  const opacities = new Float32Array(COUNT)
  const seeds = new Float32Array(COUNT)
  const attributes = {
    aCenter: new THREE.InstancedBufferAttribute(centers, 3),
    aScale: new THREE.InstancedBufferAttribute(scales, 1),
    aOpacity: new THREE.InstancedBufferAttribute(opacities, 1),
    aSeed: new THREE.InstancedBufferAttribute(seeds, 1),
  }
  Object.entries(attributes).forEach(([name, attribute]) => {
    attribute.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute(name, attribute)
  })

  const uniforms = {
    uLit: { value: new THREE.Color() },
    uShade: { value: new THREE.Color() },
    uFogColor: { value: new THREE.Color() },
    uFogNear: { value: 300 },
    uFogFar: { value: 900 },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 2

  const drift = new THREE.Vector2()
  const world = new Float32Array(COUNT * 3)
  const visible = new Float32Array(COUNT)
  const order = Array.from({ length: COUNT }, (_, i) => i)
  const depth = new Float32Array(COUNT)
  const view = new THREE.Vector3()

  // Layout of the current forest, set when trees are regenerated.
  const layout = { fieldRadius: 320, treeHeight: 64 }

  return {
    object: mesh,
    setLayout(fieldRadius, treeHeight) {
      layout.fieldRadius = fieldRadius
      layout.treeHeight = treeHeight
    },
    update(live, atmosphere, camera, dt) {
      const R = layout.fieldRadius
      const heading = THREE.MathUtils.degToRad(live.windDirection)
      drift.x += Math.cos(heading) * live.wind * WIND_SPEED * dt
      drift.y += Math.sin(heading) * live.wind * WIND_SPEED * dt

      // Lower, thicker cloud layer as cover grows.
      const cover = live.cloudCover
      const baseHeight = cloudBaseHeight(layout.treeHeight, cover)
      const thickness = layout.treeHeight * (0.12 + 0.16 * cover)

      const clusterX = []
      const clusterZ = []
      const clusterAlpha = []
      clusters.forEach((cluster) => {
        const wrap = (value) => ((((value + R) % (2 * R)) + 2 * R) % (2 * R)) - R
        const x = wrap(cluster.x * R + drift.x)
        const z = wrap(cluster.z * R + drift.y)
        // Fade in with cover, and fade near the field edge so wrapping never pops.
        const coverFade = THREE.MathUtils.smoothstep(cover * 1.05, cluster.threshold, cluster.threshold + 0.12)
        const edge = Math.max(Math.abs(x), Math.abs(z)) / R
        const edgeFade = 1 - THREE.MathUtils.smoothstep(edge, 0.78, 1)
        clusterX.push(x)
        clusterZ.push(z)
        clusterAlpha.push(coverFade * edgeFade * (0.55 + 0.45 * cover))
      })

      puffs.forEach((puff, i) => {
        const cluster = clusters[puff.cluster]
        const size = cluster.size * (0.85 + 0.35 * cover)
        world[i * 3] = clusterX[puff.cluster] + puff.dx * size
        world[i * 3 + 1] = baseHeight + cluster.lift * thickness + puff.dy * size
        world[i * 3 + 2] = clusterZ[puff.cluster] + puff.dz * size
        visible[i] = clusterAlpha[puff.cluster]
        view.set(world[i * 3], world[i * 3 + 1], world[i * 3 + 2]).applyMatrix4(camera.matrixWorldInverse)
        depth[i] = view.z // more negative = farther
      })

      // Draw far puffs first so transparency layers correctly.
      order.sort((a, b) => depth[a] - depth[b])
      order.forEach((source, slot) => {
        const puff = puffs[source]
        centers[slot * 3] = world[source * 3]
        centers[slot * 3 + 1] = world[source * 3 + 1]
        centers[slot * 3 + 2] = world[source * 3 + 2]
        scales[slot] = puff.scale * clusters[puff.cluster].size * (0.85 + 0.35 * cover)
        opacities[slot] = visible[source]
        seeds[slot] = puff.seed
      })
      Object.values(attributes).forEach((attribute) => {
        attribute.needsUpdate = true
      })

      uniforms.uLit.value.copy(atmosphere.cloudLit)
      uniforms.uShade.value.copy(atmosphere.cloudShade)
      uniforms.uFogColor.value.copy(atmosphere.fogColor)
      uniforms.uFogNear.value = R * 0.9
      uniforms.uFogFar.value = R * 2.6
      mesh.visible = cover > 0.01
    },
    dispose() {
      base.dispose()
      geometry.dispose()
      material.dispose()
    },
  }
}
