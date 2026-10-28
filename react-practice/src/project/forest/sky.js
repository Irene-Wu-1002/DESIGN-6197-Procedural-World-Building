import * as THREE from 'three'

/**
 * Forest sky: a dome around the camera with a vertical gradient, from the
 * dark underside of the canopy overhead to warm golden haze at the
 * horizon, plus a glow where the sun breaks through. The fog uses the
 * horizon colour, so distant ground melts into the same haze.
 *
 * Drawn first, without depth, so it sits behind everything at any scale.
 */

export const FOREST_COLORS = {
  // Dark warm brown-green overhead, olive, then golden haze at the horizon.
  canopy: '#2b2a1e',
  middle: '#454f2d',
  horizon: '#9a8a4f',
  sunGlow: '#f2c46e',
}

const VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  uniform vec3 uCanopy;
  uniform vec3 uMiddle;
  uniform vec3 uHorizon;
  uniform vec3 uSunGlow;
  uniform vec3 uSunDirection;
  varying vec3 vDirection;
  void main() {
    float up = clamp(vDirection.y, -1.0, 1.0);
    // Below the horizon stays at the horizon colour (hidden by ground/fog).
    vec3 color = mix(uHorizon, uMiddle, smoothstep(0.0, 0.25, up));
    color = mix(color, uCanopy, smoothstep(0.25, 0.85, up));
    // A wide soft halo plus a brighter core where the sun breaks through.
    float facing = max(dot(normalize(vDirection), uSunDirection), 0.0);
    float glow = 0.45 * pow(facing, 3.0) + 0.35 * pow(facing, 16.0);
    color = mix(color, uSunGlow, glow);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`

export function createForestSky(sunDirection) {
  const geometry = new THREE.SphereGeometry(1, 32, 16)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uCanopy: { value: new THREE.Color(FOREST_COLORS.canopy) },
      uMiddle: { value: new THREE.Color(FOREST_COLORS.middle) },
      uHorizon: { value: new THREE.Color(FOREST_COLORS.horizon) },
      uSunGlow: { value: new THREE.Color(FOREST_COLORS.sunGlow) },
      uSunDirection: { value: sunDirection.clone().normalize() },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = -1
  mesh.frustumCulled = false
  // Any size works since depth is off; keep it inside the far plane.
  mesh.scale.setScalar(10)

  return {
    mesh,
    /** Sky colours { canopy, middle, horizon, sunGlow } (THREE.Color each). */
    setColors(colors) {
      material.uniforms.uCanopy.value.copy(colors.canopy)
      material.uniforms.uMiddle.value.copy(colors.middle)
      material.uniforms.uHorizon.value.copy(colors.horizon)
      material.uniforms.uSunGlow.value.copy(colors.sunGlow)
    },
    /** Point the sun glow toward this direction (a THREE.Vector3). */
    setSunDirection(direction) {
      material.uniforms.uSunDirection.value.copy(direction).normalize()
    },
    /** Keep the dome centred on the camera. */
    follow(camera) {
      mesh.position.copy(camera.position)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
