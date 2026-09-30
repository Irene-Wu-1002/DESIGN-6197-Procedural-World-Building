import * as THREE from 'three'

// Sky dome: a large inside-out sphere that follows the camera. It blends
// from the horizon colour to the zenith colour and draws a sun disc with a
// soft glow that fades as cloud cover grows.

const vertexShader = `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = clip.xyww; // always at the far plane
  }
`

const fragmentShader = `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uSunVisibility;
  varying vec3 vDirection;

  void main() {
    vec3 direction = normalize(vDirection);
    float up = max(direction.y, 0.0);
    vec3 color = mix(uHorizon, uTop, pow(up, 0.55));

    float facing = max(dot(direction, uSunDirection), 0.0);
    float disc = smoothstep(0.9993, 0.9997, facing);
    float glow = pow(facing, 14.0) * 0.35 + pow(facing, 220.0) * 0.6;
    color += uSunColor * (disc * 1.5 + glow) * uSunVisibility;

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`

export function createSky() {
  const uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSunVisibility: { value: 1 },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), material)
  mesh.frustumCulled = false
  mesh.renderOrder = -1

  return {
    object: mesh,
    update(atmosphere, camera) {
      mesh.position.copy(camera.position)
      uniforms.uTop.value.copy(atmosphere.skyTop)
      uniforms.uHorizon.value.copy(atmosphere.skyHorizon)
      uniforms.uSunDirection.value.copy(atmosphere.sunDirection)
      uniforms.uSunColor.value.copy(atmosphere.sunColor)
      uniforms.uSunVisibility.value = atmosphere.sunVisibility
    },
    dispose() {
      mesh.geometry.dispose()
      material.dispose()
    },
  }
}
