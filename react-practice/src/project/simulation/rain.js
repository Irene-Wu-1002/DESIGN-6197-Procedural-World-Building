import * as THREE from 'three'

/**
 * Rain at real scale: falling streaks in a box around the camera, and a
 * tiny splash where each drop lands. Every drop has a fixed spot in the
 * world (wrapped into the box), and its height comes from the time, so the
 * whole shower is one draw with no per-frame work on the CPU. The share of
 * drops shown follows the rain intensity; the wind slants them.
 */

const DROPS = 6000
const SPEED = 5.5
// Box half-size: a few camera heights, within these limits (m).
const BOX = [0.25, 2.5]

const LOG_DEPTH = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
`

const STREAK_VERTEX = /* glsl */ `
${LOG_DEPTH}
attribute vec4 aSeed;
attribute float aEnd;
uniform float uTime;
uniform float uIntensity;
uniform vec3 uCenter;
uniform vec2 uBox;
uniform vec2 uWind;
uniform float uLength;
varying float vFade;

// A drop's place: world-anchored, wrapped into the box around the camera.
vec3 dropAt(vec4 seed, out float phase) {
  float span = uBox.x * 2.0;
  vec2 p = seed.xz * span;
  vec2 offset = mod(p - uCenter.xz + uBox.x, span) - uBox.x;
  phase = fract(seed.y + uTime * ${SPEED.toFixed(2)} / uBox.y);
  float fall = phase * uBox.y;
  vec3 drop = vec3(uCenter.x + offset.x, uCenter.y + uBox.y - fall, uCenter.z + offset.y);
  drop.xz += uWind * (uBox.y - fall) * 0.25;
  return drop;
}

void main() {
  float phase;
  vec3 drop = dropAt(aSeed, phase);
  // The tail trails up and upwind.
  drop += aEnd * vec3(-uWind.x * uLength * 0.25, uLength, -uWind.y * uLength * 0.25);
  vFade = (1.0 - aEnd * 0.8) * smoothstep(0.0, 0.05, phase) * (1.0 - smoothstep(0.9, 1.0, phase));
  vec4 mvPosition = viewMatrix * vec4(drop, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // Drops beyond the current intensity aren't drawn.
  if (aSeed.w > uIntensity) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  #include <logdepthbuf_vertex>
}
`

const SPLASH_VERTEX = /* glsl */ `
${LOG_DEPTH}
attribute vec4 aSeed;
uniform float uTime;
uniform float uIntensity;
uniform vec3 uCenter;
uniform vec2 uBox;
uniform float uScale;
varying float vFade;

void main() {
  float span = uBox.x * 2.0;
  vec2 p = aSeed.xz * span;
  vec2 offset = mod(p - uCenter.xz + uBox.x, span) - uBox.x;
  float phase = fract(aSeed.y + uTime * ${SPEED.toFixed(2)} / uBox.y);
  // Just after landing (the phase wraps), a brief splash at the ground.
  vFade = 1.0 - smoothstep(0.0, 0.05, phase);
  vec3 spot = vec3(uCenter.x + offset.x, uCenter.y + 0.0005, uCenter.z + offset.y);
  vec4 mvPosition = viewMatrix * vec4(spot, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = uScale * 0.003 * (1.0 + 2.0 * (1.0 - vFade)) / max(-mvPosition.z, 0.001);
  if (aSeed.w > uIntensity || vFade <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  #include <logdepthbuf_vertex>
}
`

const FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(uColor, uOpacity * vFade);
}
`

export function createRain(scene) {
  const seeds = new Float32Array(DROPS * 4)
  for (let i = 0; i < DROPS * 4; i += 1) seeds[i] = Math.random()
  const uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector2(1, 2) },
    uWind: { value: new THREE.Vector2() },
    uLength: { value: 0.06 },
    uScale: { value: 800 },
    uColor: { value: new THREE.Color('#b8c4cc') },
    uOpacity: { value: 0.35 },
  }

  // Streaks: two vertices per drop (head and tail), same seed.
  const streakSeeds = new Float32Array(DROPS * 8)
  const ends = new Float32Array(DROPS * 2)
  for (let i = 0; i < DROPS; i += 1) {
    for (let e = 0; e < 2; e += 1) {
      streakSeeds.set(seeds.subarray(i * 4, i * 4 + 4), (i * 2 + e) * 4)
      ends[i * 2 + e] = e
    }
  }
  const streakGeometry = new THREE.BufferGeometry()
  streakGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 6), 3))
  streakGeometry.setAttribute('aSeed', new THREE.BufferAttribute(streakSeeds, 4))
  streakGeometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1))
  const material = (vertexShader) =>
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
    })
  const streaks = new THREE.LineSegments(streakGeometry, material(STREAK_VERTEX))
  const splashGeometry = new THREE.BufferGeometry()
  splashGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 3), 3))
  splashGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4))
  const splashes = new THREE.Points(splashGeometry, material(SPLASH_VERTEX))
  for (const mesh of [streaks, splashes]) {
    mesh.frustumCulled = false
    mesh.visible = false
    mesh.renderOrder = 2
    scene.add(mesh)
  }

  return {
    meshes: [streaks, splashes],
    /**
     * time (s); intensity 0–1; camera; ground: height of the ground below
     * the camera; wind [x, z] (0–1 strength along the wind); light 0–1;
     * pixels: viewport height in pixels over the vertical field of view.
     */
    update({ time, intensity, camera, ground, wind, light, pixels }) {
      const visible = intensity > 0.002
      streaks.visible = visible
      splashes.visible = visible
      if (!visible) return
      const height = Math.max(camera.position.y - ground, 0.01)
      const half = Math.min(Math.max(height * 3, BOX[0]), BOX[1])
      uniforms.uTime.value = time
      uniforms.uIntensity.value = intensity
      uniforms.uCenter.value.set(camera.position.x, ground, camera.position.z)
      uniforms.uBox.value.set(half, height + half)
      uniforms.uWind.value.set(wind[0], wind[1])
      uniforms.uLength.value = Math.min(0.06, half * 0.12)
      uniforms.uScale.value = pixels
      uniforms.uOpacity.value = 0.2 + 0.35 * light
    },
    dispose() {
      for (const mesh of [streaks, splashes]) {
        scene.remove(mesh)
        mesh.geometry.dispose()
        mesh.material.dispose()
      }
    },
  }
}
