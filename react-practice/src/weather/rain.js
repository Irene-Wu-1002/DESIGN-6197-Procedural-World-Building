import * as THREE from 'three'
import { createRandom } from '../utils/noise3d'
import { cloudBaseHeight } from './clouds'

// Rain: short streaks animated entirely on the GPU. Each drop has a random
// start position inside a box that follows the camera; the vertex shader
// moves it down (and sideways with the wind) and wraps it back to the top,
// so JavaScript only updates a few uniforms per frame. Rain intensity picks
// how many of the drops are drawn.

export const MAX_DROPS = 40000
const BOX_WIDTH = 240
const FALL_SPEED = 38 // metres per second
const WIND_SPEED = 14 // sideways metres per second at wind = 1
const STREAK_LENGTH = 1.6

const vertexShader = `
  attribute vec3 aStart;
  attribute float aEnd; // 0 = top of the streak, 1 = bottom
  uniform float uTime;
  uniform vec3 uCenter;
  uniform vec2 uWind;
  uniform float uHeight;
  uniform float uWidth;
  varying float vFade;
  varying float vEnd;

  void main() {
    vec3 velocity = vec3(uWind.x, -${FALL_SPEED.toFixed(1)}, uWind.y);
    // Fall, drift, and wrap inside a box centred on the camera.
    vec3 p = aStart + velocity * uTime;
    p.y = mod(p.y, uHeight);
    p.xz = mod(p.xz - uCenter.xz + uWidth * 0.5, uWidth) - uWidth * 0.5 + uCenter.xz;
    p += normalize(velocity) * ${STREAK_LENGTH.toFixed(1)} * aEnd;

    vec4 view = viewMatrix * vec4(p, 1.0);
    // Drops far from the camera fade out instead of cluttering the view.
    vFade = 1.0 - smoothstep(45.0, 115.0, -view.z);
    vEnd = aEnd;
    gl_Position = projectionMatrix * view;
  }
`

const fragmentShader = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;
  varying float vEnd;

  void main() {
    // Brighter head, fading tail.
    float alpha = uOpacity * vFade * mix(1.0, 0.25, vEnd);
    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }
`

export function createRain() {
  const random = createRandom(9001)
  const starts = new Float32Array(MAX_DROPS * 2 * 3)
  const ends = new Float32Array(MAX_DROPS * 2)
  for (let d = 0; d < MAX_DROPS; d += 1) {
    const x = (random() - 0.5) * BOX_WIDTH
    const y = random() * 1000
    const z = (random() - 0.5) * BOX_WIDTH
    for (let v = 0; v < 2; v += 1) {
      const i = d * 2 + v
      starts[i * 3] = x
      starts[i * 3 + 1] = y
      starts[i * 3 + 2] = z
      ends[i] = v
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('aStart', new THREE.BufferAttribute(starts, 3))
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1))
  // three.js needs a position attribute to size the draw call.
  geometry.setAttribute('position', new THREE.BufferAttribute(starts, 3))

  const uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uWind: { value: new THREE.Vector2() },
    uHeight: { value: 90 },
    uWidth: { value: BOX_WIDTH },
    uColor: { value: new THREE.Color('#c7d4de') },
    uOpacity: { value: 0.38 },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  })
  const lines = new THREE.LineSegments(geometry, material)
  lines.frustumCulled = false
  lines.renderOrder = 3

  let time = 0
  const layout = { treeHeight: 64 }

  return {
    object: lines,
    setLayout(treeHeight) {
      layout.treeHeight = treeHeight
    },
    drawnDrops: 0,
    update(live, atmosphere, camera, dt) {
      time += dt
      uniforms.uTime.value = time
      uniforms.uCenter.value.copy(camera.position)
      const heading = THREE.MathUtils.degToRad(live.windDirection)
      uniforms.uWind.value.set(
        Math.cos(heading) * live.wind * WIND_SPEED,
        Math.sin(heading) * live.wind * WIND_SPEED
      )
      // Rain falls from just under the cloud base.
      uniforms.uHeight.value = cloudBaseHeight(layout.treeHeight, live.cloudCover)
      // Drops pick up a little of the sky colour.
      uniforms.uColor.value.set('#c7d4de').lerp(atmosphere.skyHorizon, 0.35)

      const drops = Math.round(MAX_DROPS * Math.min(1, live.rain))
      this.drawnDrops = drops
      geometry.setDrawRange(0, drops * 2)
      lines.visible = drops > 50
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
