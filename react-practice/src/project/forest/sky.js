import * as THREE from 'three'

/**
 * Forest sky: a dome around the camera with a vertical gradient, from the
 * deep shadow of the canopy overhead to green haze at the horizon,
 * plus a low glow where the sun breaks through behind the trees. The fog uses the
 * horizon colour, so distant ground melts into the same haze.
 *
 * Drawn first, without depth, so it sits behind everything at any scale.
 */

export const FOREST_COLORS = {
  // Deep shadow under the canopy overhead, desaturated forest green below,
  // and the green haze the fog shares; pale gold where the sun breaks through.
  canopy: '#182117',
  middle: '#20291e',
  horizon: '#394735',
  sunGlow: '#e8cf96',
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
    // Sunlight breaking through low behind the trees: the glow sits near the
    // horizon in the sun's compass direction, whatever its height, a soft
    // halo with a small brighter core that fades out overhead.
    vec3 behind = normalize(vec3(uSunDirection.x, 0.12, uSunDirection.z));
    float facing = max(dot(normalize(vDirection), behind), 0.0);
    float low = 1.0 - smoothstep(0.0, 0.55, abs(up - 0.08));
    float glow = (0.3 * pow(facing, 6.0) + 0.4 * pow(facing, 40.0)) * low;
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
