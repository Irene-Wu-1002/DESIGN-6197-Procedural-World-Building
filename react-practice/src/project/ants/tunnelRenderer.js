import * as THREE from 'three'
import { CHAMBER_POWER } from './tunnels'

/**
 * Draws the colony's tunnels (tunnels.js) two ways:
 *
 *   inside   for the ant underground: tubes and chambers of packed soil,
 *            lit by the daylight that reaches down from the nearest
 *            entrance (fading with the distance along the tunnels) and by
 *            a faint glow around the ant itself, so the way on is always
 *            readable. Tubes and chambers are joined by cutting each away
 *            where it lies inside the other (in the shader), so the mouths
 *            of the tunnels open into the chamber walls. The shafts are open
 *            at the top: looking up one, you see the sky.
 *   x-ray    for the X-ray view: the same shapes as a faint amber glow, so
 *            the whole network shows under the see-through ground.
 *
 * Only one of the two is shown at a time, and neither on the surface.
 *
 * Underground, a faint warm light also travels with the viewer, so the
 * colony's ants in the tunnels (antColony.js) are lit the way the walls
 * around the ant are. It stays in the scene at zero on the surface (adding
 * and removing a light would recompile every material).
 */

// Ring segments around a tube, and the walls' unevenness (share of radius).
const SEGMENTS = 18
const ROUGH = 0.1
// Distance from a chamber's wall (m) over which the roughness comes back.
const CALM = [0.016, 0.026]
// Mouths a chamber can open (shader array size), and the centreline
// points (samples apart) that trace each mouth through the wall.
const MAX_MOUTHS = 10
const MOUTH_POINTS = 8
const MOUTH_STRIDE = 2
const MAX_CHAMBERS = 4
// The viewer's light underground: intensity (cd) and reach (m).
const LAMP = { intensity: 0.00035, distance: 0.08 }

const LOG_DEPTH_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
`

const VERTEX = /* glsl */ `
${LOG_DEPTH_VERTEX}
attribute float aLight;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vLight;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLight = aLight;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`

const SOIL = /* glsl */ `
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z
  );
}
// Packed soil: clods (~3 mm), grains (~0.7 mm), and the odd pale crumb.
vec3 soil(vec3 p, float floorShare) {
  float clod = noise3(p * 330.0);
  float grain = noise3(p * 1400.0);
  float crumb = smoothstep(0.82, 0.9, noise3(p * 3800.0 + 7.0));
  vec3 dark = vec3(0.075, 0.045, 0.025);
  vec3 light = vec3(0.26, 0.16, 0.085);
  vec3 color = mix(dark, light, clod * 0.65 + grain * 0.35);
  color = mix(color, vec3(0.36, 0.28, 0.2), crumb * 0.22);
  // The floor is worn smoother and paler by the traffic.
  return mix(color, color * 1.25 + 0.02, floorShare);
}
`

const INSIDE_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uViewer;
uniform vec4 uChambers[${MAX_CHAMBERS}];
uniform float uChamberRy;
uniform int uChamberCount;
uniform vec3 uMouthPath[${MAX_MOUTHS * MOUTH_POINTS}];
uniform float uMouthRadius[${MAX_MOUTHS}];
uniform int uMouthCount;
uniform float uIsChamber;
uniform float uDaylight;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vLight;
${SOIL}
void main() {
  #include <logdepthbuf_fragment>
  if (uIsChamber < 0.5) {
    // A tube: cut away inside any chamber.
    for (int i = 0; i < ${MAX_CHAMBERS}; i++) {
      if (i >= uChamberCount) break;
      vec4 c = uChambers[i];
      vec3 d = (vWorld - c.xyz) / vec3(c.w, uChamberRy, c.w);
      float across = dot(d.xz, d.xz);
      if (across * across + pow(abs(d.y), ${CHAMBER_POWER.toFixed(1)}) < 0.985) discard;
    }
  } else {
    // A chamber: open a mouth where each tunnel comes in, along the
    // tunnel's own centreline (capsules between its points).
    for (int i = 0; i < ${MAX_MOUTHS}; i++) {
      if (i >= uMouthCount) break;
      float r = uMouthRadius[i] * 0.985;
      for (int k = 0; k < ${MOUTH_POINTS - 1}; k++) {
        vec3 a = uMouthPath[i * ${MOUTH_POINTS} + k];
        vec3 b = uMouthPath[i * ${MOUTH_POINTS} + k + 1];
        vec3 ab = b - a;
        float h = clamp(dot(vWorld - a, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
        if (length(vWorld - a - ab * h) < r) discard;
      }
    }
  }
  vec3 n = -normalize(vNormal);
  float floorShare = smoothstep(0.35, 0.8, n.y);
  vec3 albedo = soil(vWorld, floorShare);
  vec3 toViewer = uViewer - vWorld;
  float dist = length(toViewer);
  // Daylight from the nearest entrance, along the tunnels (m).
  float day = exp(-vLight / 0.025) * 1.6 + exp(-vLight / 0.1) * 0.2;
  day *= 0.6 + 0.4 * max(n.y, 0.0) + 0.3 * max(-n.y, 0.0);
  // What the ant makes out right around itself.
  float near = 0.9 * exp(-dist / 0.014) * (0.35 + 0.65 * max(dot(n, toViewer / max(dist, 1e-5)), 0.0));
  float ambient = 0.045;
  vec3 color = albedo * (vec3(ambient) + vec3(1.0, 0.93, 0.82) * day * uDaylight + vec3(0.9, 0.8, 0.7) * near);
  // Further down the tunnel, the dark.
  color *= mix(0.12, 1.0, exp(-dist / 0.06));
  gl_FragColor = vec4(color, 1.0);
}
`

const XRAY_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uAmount;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vLight;
void main() {
  #include <logdepthbuf_fragment>
  vec3 view = normalize(cameraPosition - vWorld);
  float rim = 1.0 - abs(dot(normalize(vNormal), view));
  float glow = (0.2 + 1.1 * rim * rim) * uAmount;
  vec3 color = mix(vec3(1.0, 0.62, 0.28), vec3(1.0, 0.9, 0.65), exp(-vLight / 0.05));
  gl_FragColor = vec4(color * glow, glow);
}
`

// Inside a chamber's superellipsoid: (horizontal / rx)^p + (|dy| / ry)^p < 1.
const insideChamber = (chamber, x, y, z) => {
  const flat = ((x - chamber.x) ** 2 + (z - chamber.z) ** 2) / chamber.rx ** 2
  return flat ** (CHAMBER_POWER / 2) + Math.abs((y - chamber.cy) / chamber.ry) ** CHAMBER_POWER < 1
}

/** Is the whole ring of `edge` around sample i inside the chamber? */
const ringInside = (chamber, edge, i) => {
  const x = edge.points[i * 3]
  const y = edge.points[i * 3 + 1]
  const z = edge.points[i * 3 + 2]
  const r = edge.radius
  // Sideways (level, across the tunnel).
  const j = Math.min(i + 1, edge.count - 1)
  const k = Math.max(i - 1, 0)
  let tx = edge.points[j * 3] - edge.points[k * 3]
  let tz = edge.points[j * 3 + 2] - edge.points[k * 3 + 2]
  const flat = Math.hypot(tx, tz) || 1
  tx /= flat
  tz /= flat
  return [
    [0, r, 0],
    [0, -r, 0],
    [-tz * r, 0, tx * r],
    [tz * r, 0, -tx * r],
  ].every(([dx, dy, dz]) => insideChamber(chamber, x + dx, y + dy, z + dz))
}

/** A chamber's mesh: a unit sphere pushed out to the superellipsoid. */
function chamberGeometry(chamber) {
  const sphere = new THREE.SphereGeometry(1, 48, 32)
  const position = sphere.attributes.position
  const e = 2 / CHAMBER_POWER
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const flat = Math.hypot(x, z)
    const reach = flat > 1e-6 ? flat ** e / flat : 0
    position.setXYZ(
      i,
      chamber.x + x * reach * chamber.rx,
      chamber.cy + Math.sign(y) * Math.abs(y) ** e * chamber.ry,
      chamber.z + z * reach * chamber.rx
    )
  }
  sphere.computeVertexNormals()
  return sphere
}

/** A tube's ring positions along an edge's centreline, trimmed at chambers. */
function tubeGeometry(network) {
  const positions = []
  const normals = []
  const light = []
  const indices = []
  const mouths = network.chambers.map(() => [])
  const T = new THREE.Vector3()
  const N = new THREE.Vector3()
  const B = new THREE.Vector3()
  const prevT = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const P = new THREE.Vector3()
  const out = new THREE.Vector3()
  const at = (edge, i, v) => v.set(edge.points[i * 3], edge.points[i * 3 + 1], edge.points[i * 3 + 2])
  const tangentAt = (edge, i, v) => {
    const a = Math.max(i - 1, 0)
    const b = Math.min(i + 1, edge.count - 1)
    v.set(
      edge.points[b * 3] - edge.points[a * 3],
      edge.points[b * 3 + 1] - edge.points[a * 3 + 1],
      edge.points[b * 3 + 2] - edge.points[a * 3 + 2]
    )
    return v.normalize()
  }

  for (const edge of network.edges) {
    // Trim the ends inside a chamber (keeping a sample inside, for overlap).
    const ends = [network.nodes[edge.a], network.nodes[edge.b]]
    let first = 0
    let last = edge.count - 1
    const chamberOf = (node) => (node.kind === 'chamber' ? network.chambers.findIndex((c) => c.id === node.id) : -1)
    const ca = chamberOf(ends[0])
    const cb = chamberOf(ends[1])
    // Keep the tube on into the chamber until its whole ring is inside (the
    // shader hides what's inside), so there's no gap where the chamber's
    // floor curves up into its wall.
    if (ca >= 0) {
      const c = network.chambers[ca]
      while (first < last - 1 && !ringInside(c, edge, first)) first += 1
      mouths[ca].push(edge, first, 1)
    }
    if (cb >= 0) {
      const c = network.chambers[cb]
      while (last > first + 1 && !ringInside(c, edge, last)) last -= 1
      mouths[cb].push(edge, last, -1)
    }

    const base = positions.length / 3
    const rings = last - first + 1
    tangentAt(edge, first, T)
    // Start the frame with a sideways normal (tubes are never vertical at
    // both ends at once, and the frame is carried along from here).
    N.set(0, 1, 0)
    if (Math.abs(T.dot(N)) > 0.9) N.set(1, 0, 0)
    N.sub(out.copy(T).multiplyScalar(T.dot(N))).normalize()
    for (let r = 0; r < rings; r += 1) {
      const i = first + r
      prevT.copy(T)
      tangentAt(edge, i, T)
      if (r > 0) {
        q.setFromUnitVectors(prevT, T)
        N.applyQuaternion(q)
        N.sub(out.copy(T).multiplyScalar(T.dot(N))).normalize()
      }
      B.crossVectors(T, N)
      at(edge, i, P)
      const s = edge.lengths[i]
      const day = network.daylight(edge, s)
      const fromMouth = Math.min(ca >= 0 ? s - edge.lengths[first] : Infinity, cb >= 0 ? edge.lengths[last] - s : Infinity)
      const calm = Math.min(Math.max((fromMouth - CALM[0]) / (CALM[1] - CALM[0]), 0), 1)
      for (let k = 0; k <= SEGMENTS; k += 1) {
        const angle = (k / SEGMENTS) * Math.PI * 2
        const c = Math.cos(angle)
        const sn = Math.sin(angle)
        // Rough walls, but exactly round where a tunnel meets a chamber, so
        // the mouth cut in the chamber's wall fits it.
        const rough =
          1 +
          ROUGH *
            calm *
            (0.6 * Math.sin(s * 700 + angle * 3 + edge.id) + 0.4 * Math.sin(s * 2100 - angle * 5 + edge.id * 3))
        out.copy(N).multiplyScalar(c).addScaledVector(B, sn)
        positions.push(P.x + out.x * edge.radius * rough, P.y + out.y * edge.radius * rough, P.z + out.z * edge.radius * rough)
        normals.push(out.x, out.y, out.z)
        light.push(day)
      }
      if (r > 0) {
        for (let k = 0; k < SEGMENTS; k += 1) {
          const a = base + (r - 1) * (SEGMENTS + 1) + k
          const b = a + SEGMENTS + 1
          indices.push(a, a + 1, b, a + 1, b + 1, b)
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('aLight', new THREE.Float32BufferAttribute(light, 1))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()

  // Each chamber's mouths: the tunnel's centreline from where its ring is
  // wholly inside the chamber, outward through the wall.
  const mouthData = mouths.map((list) => {
    const result = []
    for (let k = 0; k < list.length; k += 3) {
      const edge = list[k]
      const start = list[k + 1]
      const sign = list[k + 2]
      const path = []
      for (let m = 0; m < MOUTH_POINTS; m += 1) {
        const i = Math.min(Math.max(start + sign * m * MOUTH_STRIDE, 0), edge.count - 1)
        path.push(at(edge, i, new THREE.Vector3()))
      }
      result.push({ path, radius: edge.radius })
    }
    return result
  })
  return { geometry, mouths: mouthData }
}

export function createTunnelRenderer(scene) {
  const group = new THREE.Group()
  group.visible = false
  const xrayGroup = new THREE.Group()
  xrayGroup.visible = false
  scene.add(group, xrayGroup)
  const lamp = new THREE.PointLight('#ffd9b0', 0, LAMP.distance, 2)
  lamp.castShadow = false
  scene.add(lamp)

  const shared = {
    uViewer: { value: new THREE.Vector3() },
    uChambers: { value: Array.from({ length: MAX_CHAMBERS }, () => new THREE.Vector4()) },
    uChamberRy: { value: 0.0065 },
    uChamberCount: { value: 0 },
    uDaylight: { value: 1 },
  }
  const xrayUniforms = { uAmount: { value: 0 } }
  const xrayMaterial = new THREE.ShaderMaterial({
    uniforms: xrayUniforms,
    vertexShader: VERTEX,
    fragmentShader: XRAY_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  })
  const insideMaterial = (isChamber) =>
    new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        uMouthPath: { value: Array.from({ length: MAX_MOUTHS * MOUTH_POINTS }, () => new THREE.Vector3()) },
        uMouthRadius: { value: new Array(MAX_MOUTHS).fill(0) },
        uMouthCount: { value: 0 },
        uIsChamber: { value: isChamber ? 1 : 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: INSIDE_FRAGMENT,
      side: THREE.DoubleSide,
    })

  let meshes = []
  const clear = () => {
    for (const mesh of meshes) {
      mesh.parent?.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    meshes = []
  }
  const add = (parent, geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = false
    parent.add(mesh)
    meshes.push(mesh)
    return mesh
  }

  return {
    /** Build the meshes for a network (tunnels.js), or none for null. */
    setNetwork(network) {
      clear()
      if (!network) return
      const { geometry, mouths } = tubeGeometry(network)
      add(group, geometry, insideMaterial(false))
      add(xrayGroup, geometry.clone(), xrayMaterial.clone())
      const chambers = network.chambers.slice(0, MAX_CHAMBERS)
      shared.uChamberCount.value = chambers.length
      chambers.forEach((chamber, index) => {
        shared.uChambers.value[index].set(chamber.x, chamber.cy, chamber.z, chamber.rx)
        shared.uChamberRy.value = chamber.ry
        const sphere = chamberGeometry(chamber)
        const count = sphere.attributes.position.count
        sphere.setAttribute('aLight', new THREE.Float32BufferAttribute(new Float32Array(count).fill(chamber.daylight), 1))
        const material = insideMaterial(true)
        const list = mouths[index].slice(0, MAX_MOUTHS)
        list.forEach((mouth, k) => {
          mouth.path.forEach((point, m) => material.uniforms.uMouthPath.value[k * MOUTH_POINTS + m].copy(point))
          material.uniforms.uMouthRadius.value[k] = mouth.radius
        })
        material.uniforms.uMouthCount.value = list.length
        add(group, sphere, material)
        add(xrayGroup, sphere.clone(), xrayMaterial.clone())
      })
      for (const mesh of meshes) if (mesh.parent === xrayGroup) mesh.material.uniforms = xrayUniforms
    },

    /**
     * underground: the viewer is in a tunnel (draw the inside); xray: the
     * X-ray view's amount (0–1); viewer: the eye (Vector3); daylight: how
     * bright it is above (0–1).
     */
    update({ underground, xray, viewer, daylight = 1 }) {
      group.visible = Boolean(underground) && meshes.length > 0
      xrayUniforms.uAmount.value = underground ? 0 : xray
      xrayGroup.visible = !underground && xray > 0.001 && meshes.length > 0
      shared.uViewer.value.copy(viewer)
      shared.uDaylight.value = daylight
      lamp.position.copy(viewer)
      lamp.intensity = group.visible ? LAMP.intensity : 0
    },

    dispose() {
      clear()
      scene.remove(group, xrayGroup, lamp)
      lamp.dispose()
      xrayMaterial.dispose()
    },
  }
}
