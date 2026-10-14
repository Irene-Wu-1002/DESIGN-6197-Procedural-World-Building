import * as THREE from 'three'

/**
 * The air above the forest floor: spores drifting in a slow breeze (a
 * thicker plume rising from the fly agaric's cap), and air currents. The
 * same spores are there for every body; the butterfly sees them larger and
 * brighter (uSpores) and is the only one that sees the currents (uAir).
 *
 * Both live in world space inside a box that wraps around the viewer
 * (in the vertex shader), so they cost one draw call each and never pop
 * when you move. Nothing here touches the generated world.
 */

const WIND = new THREE.Vector3(0.05, 0.004, 0.02)
const SPORES = { count: 900, plumeShare: 0.3, box: [2.4, 1.6, 2.4], size: 0.0011 }
const CURRENTS = { count: 22, segments: 48, box: [3.2, 1.8, 3.2], width: 0.024 }

const WRAP = /* glsl */ `
// Wrap a world position into a box of size uBox centred on uCenter.
vec3 wrapBox(vec3 p, vec3 center, vec3 box) {
  vec3 low = center - box * 0.5;
  return low + mod(p - low, box);
}
`

const SPORE_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uTime;
uniform float uSpores;
uniform float uPixels;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uWind;
uniform vec4 uAgaric;
attribute vec3 aSeed;
attribute float aPlume;
varying float vAlpha;
${WRAP}
void main() {
  vec3 world;
  if (aPlume > 0.5) {
    // Rising from the cap (uAgaric.xyz = cap top, w = 1 when it stands).
    float rise = fract(aSeed.y + uTime * 0.03);
    float spread = 0.02 + rise * 0.25;
    float angle = aSeed.x * 6.2831 + uTime * 0.1;
    world = uAgaric.xyz + vec3(cos(angle) * spread * aSeed.z, rise * 0.45, sin(angle) * spread * aSeed.z)
      + uWind * rise * 6.0;
    vAlpha = uAgaric.w * (1.0 - rise) * smoothstep(0.0, 0.08, rise);
  } else {
    vec3 drift = uWind * uTime + 0.01 * vec3(sin(uTime * 0.4 + aSeed.x * 40.0), sin(uTime * 0.3 + aSeed.y * 30.0), cos(uTime * 0.35 + aSeed.z * 50.0));
    // Thicker near the ground.
    vec3 local = vec3(aSeed.x, aSeed.y * aSeed.y, aSeed.z) * uBox;
    world = wrapBox(local + drift, uCenter + vec3(0.0, uBox.y * 0.5 - 0.05, 0.0), uBox);
    vAlpha = 1.0;
  }
  vec4 view = viewMatrix * vec4(world, 1.0);
  float depth = max(-view.z, 1e-4);
  // Fade with distance and when almost touching the eye.
  vAlpha *= (1.0 - smoothstep(0.6, 1.2, depth)) * smoothstep(0.002, 0.01, depth);
  gl_Position = projectionMatrix * view;
  // Motes smaller than a pixel fade out rather than sparkle as 1-px dots.
  float size = ${SPORES.size.toFixed(4)} * uSpores * uPixels / depth;
  vAlpha *= smoothstep(0.6, 2.0, size);
  gl_PointSize = clamp(size, 1.0, 22.0);
  #include <logdepthbuf_vertex>
}
`

const SPORE_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uSpores;
uniform float uUV;
varying float vAlpha;
void main() {
  #include <logdepthbuf_fragment>
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float soft = 1.0 - smoothstep(0.3, 1.0, d);
  // Pale motes; under ultraviolet they shine violet-white.
  vec3 color = mix(vec3(0.85, 0.82, 0.68), vec3(0.85, 0.8, 1.0), uUV);
  float alpha = soft * vAlpha * (0.25 + 0.2 * uSpores);
  gl_FragColor = vec4(color * alpha, alpha);
}
`

const CURRENT_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uWind;
attribute vec3 aSeed;
attribute vec2 aRibbon;
varying vec2 vRibbon;
varying float vFade;
${WRAP}
void main() {
  vRibbon = aRibbon;
  float u = aRibbon.x;
  float span = 0.5 + 0.7 * aSeed.x;
  vec3 dir = normalize(vec3(uWind.x, 0.0, uWind.z) + vec3(0.0, 0.0, (aSeed.y - 0.5) * 0.06));
  vec3 side = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
  vec3 origin = wrapBox(aSeed * uBox + uWind * uTime * 4.0, uCenter + vec3(0.0, uBox.y * 0.5 + 0.12, 0.0), uBox);
  float wave = u * 6.2831 * 1.3 + uTime * 0.7 + aSeed.z * 20.0;
  vec3 p = origin + dir * (u - 0.5) * span
    + vec3(0.0, sin(wave) * 0.04, 0.0) + side * cos(wave * 0.7) * 0.05;
  // The ribbon twists along its length so it is never seen edge-on.
  float twist = u * 3.1416 + aSeed.y * 6.2831;
  p += (cos(twist) * vec3(0.0, 1.0, 0.0) + sin(twist) * side) * aRibbon.y * ${(CURRENTS.width / 2).toFixed(4)};
  vec4 view = viewMatrix * vec4(p, 1.0);
  // Fade far away and right in front of the eye.
  vFade = (1.0 - smoothstep(1.0, 1.6, -view.z)) * smoothstep(0.08, 0.3, -view.z);
  gl_Position = projectionMatrix * view;
  #include <logdepthbuf_vertex>
}
`

const CURRENT_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uAir;
uniform float uTime;
varying vec2 vRibbon;
varying float vFade;
void main() {
  #include <logdepthbuf_fragment>
  float across = 1.0 - vRibbon.y * vRibbon.y;
  float ends = sin(3.1416 * vRibbon.x);
  // Streaks travelling downwind.
  float streak = 0.35 + 0.65 * smoothstep(0.2, 1.0, sin((vRibbon.x * 5.0 - uTime * 0.5) * 6.2831) * 0.5 + 0.5);
  float alpha = uAir * 0.3 * across * ends * streak * vFade;
  vec3 color = vec3(0.72, 0.9, 1.0);
  gl_FragColor = vec4(color * alpha, alpha);
}
`

const additive = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
}

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createAirLayer(scene) {
  const random = seededRandom(9157)
  const uniforms = {
    uTime: { value: 0 },
    uSpores: { value: 1 },
    uAir: { value: 0 },
    uUV: { value: 0 },
    uPixels: { value: 800 },
    uCenter: { value: new THREE.Vector3() },
    uWind: { value: WIND.clone() },
    uAgaric: { value: new THREE.Vector4(0, 0, 0, 0) },
  }

  const sporeGeometry = new THREE.BufferGeometry()
  const seeds = new Float32Array(SPORES.count * 3)
  const plume = new Float32Array(SPORES.count)
  for (let i = 0; i < SPORES.count; i += 1) {
    seeds[i * 3] = random()
    seeds[i * 3 + 1] = random()
    seeds[i * 3 + 2] = random()
    plume[i] = i < SPORES.count * SPORES.plumeShare ? 1 : 0
  }
  // Positions are computed in the shader; this attribute only sets the count.
  sporeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPORES.count * 3), 3))
  sporeGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3))
  sporeGeometry.setAttribute('aPlume', new THREE.BufferAttribute(plume, 1))
  const spores = new THREE.Points(
    sporeGeometry,
    new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uBox: { value: new THREE.Vector3(...SPORES.box) } },
      vertexShader: SPORE_VERTEX,
      fragmentShader: SPORE_FRAGMENT,
      ...additive,
    })
  )

  const { count, segments } = CURRENTS
  const ribbon = new Float32Array(count * (segments + 1) * 2 * 2)
  const ribbonSeeds = new Float32Array(count * (segments + 1) * 2 * 3)
  const indices = []
  for (let r = 0; r < count; r += 1) {
    const seed = [random(), random(), random()]
    for (let i = 0; i <= segments; i += 1) {
      for (let s = 0; s < 2; s += 1) {
        const v = (r * (segments + 1) + i) * 2 + s
        ribbon[v * 2] = i / segments
        ribbon[v * 2 + 1] = s * 2 - 1
        ribbonSeeds.set(seed, v * 3)
      }
      if (i > 0) {
        const v = (r * (segments + 1) + i) * 2
        indices.push(v - 2, v - 1, v, v - 1, v + 1, v)
      }
    }
  }
  const currentGeometry = new THREE.BufferGeometry()
  currentGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ribbon.length / 2 * 3), 3))
  currentGeometry.setAttribute('aRibbon', new THREE.BufferAttribute(ribbon, 2))
  currentGeometry.setAttribute('aSeed', new THREE.BufferAttribute(ribbonSeeds, 3))
  currentGeometry.setIndex(indices)
  const currents = new THREE.Mesh(
    currentGeometry,
    new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uBox: { value: new THREE.Vector3(...CURRENTS.box) } },
      vertexShader: CURRENT_VERTEX,
      fragmentShader: CURRENT_FRAGMENT,
      side: THREE.DoubleSide,
      ...additive,
    })
  )

  for (const object of [spores, currents]) {
    object.frustumCulled = false
    object.renderOrder = 2
    scene.add(object)
  }

  return {
    meshes: [spores, currents],
    /**
     * center: ground point to wrap around; agaric: cap top (Vector3) or null;
     * perception: { spores, air, uv }; pixels: viewport height in pixels
     * divided by tan(fov / 2) (for point sizes).
     */
    update({ time, center, agaric, perception, pixels }) {
      uniforms.uTime.value = time
      uniforms.uCenter.value.copy(center)
      uniforms.uSpores.value = perception.spores
      uniforms.uAir.value = perception.air
      uniforms.uUV.value = perception.uv
      uniforms.uPixels.value = pixels
      if (agaric) uniforms.uAgaric.value.set(agaric.x, agaric.y, agaric.z, 1)
      else uniforms.uAgaric.value.w = 0
      currents.visible = perception.air > 0.002
    },
    dispose() {
      scene.remove(spores, currents)
      sporeGeometry.dispose()
      currentGeometry.dispose()
      spores.material.dispose()
      currents.material.dispose()
    },
  }
}
