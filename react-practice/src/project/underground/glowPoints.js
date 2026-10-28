import * as THREE from 'three'

/**
 * Soft glowing dots drawn straight from a particle pool's arrays
 * (utils/particles.js), for the water and the sap: added onto what's
 * behind them, so dense clusters glow, sized in metres (smaller with
 * distance, up to MAX_POINT_PIXELS), with the scene's log depth and the
 * cross-section's clipping.
 *
 * options: { depthTest } (false draws them over everything, e.g. sap
 * inside the wood). setView(camera, viewportHeight) each frame; glow
 * scales their brightness.
 */

const MAX_POINT_PIXELS = 28

const POINTS_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
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
  gl_PointSize = min(aSize * uScale / -mvPosition.z, ${MAX_POINT_PIXELS.toFixed(1)});
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>
}
`
const POINTS_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
uniform float uGlow;
varying vec3 vColor;
varying float vAlpha;
void main() {
  #include <clipping_planes_fragment>
  float d = length(gl_PointCoord - 0.5);
  // A bright core with a soft edge.
  float alpha = smoothstep(0.5, 0.2, d) * vAlpha * uGlow;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(vColor * alpha, alpha);
  #include <logdepthbuf_fragment>
  #include <colorspace_fragment>
}
`

export function createGlowPoints(pool, { depthTest = true } = {}) {
  const geometry = new THREE.BufferGeometry()
  const attribute = (array, size) => new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', attribute(pool.position, 3))
  geometry.setAttribute('aColor', attribute(pool.color, 3))
  geometry.setAttribute('aSize', attribute(pool.size, 1))
  geometry.setAttribute('aAlpha', attribute(pool.alpha, 1))
  const material = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 }, uGlow: { value: 1 } },
    vertexShader: POINTS_VERTEX,
    fragmentShader: POINTS_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest,
    blending: THREE.AdditiveBlending,
    clipping: true,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false

  return {
    object: points,
    material,
    /** After the pool has moved: upload it, and size the dots for this view. */
    update(camera, viewportHeight, glow = 1) {
      for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) geometry.attributes[name].needsUpdate = true
      material.uniforms.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
      material.uniforms.uGlow.value = glow
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
