import * as THREE from 'three'

/**
 * Tree sway: bends instanced foliage downwind in the vertex shader (GPU only).
 * The bend grows with the square of height above the instance's base, so
 * canopies move and the ground contact stays put. Gust waves roll across
 * the map along the wind; each tree flutters at its own phase.
 *
 * Per instance, the geometry needs an `aSway` attribute (0 = rigid,
 * 1 = full), e.g. lower for stiff pines or trees sheltered from the wind.
 */

export function createSwayUniforms() {
  return {
    uTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindStrength: { value: 0 },
    uGustiness: { value: 0 },
    uSway: { value: 1 },
  }
}

const DECLARATIONS = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uGustiness;
uniform float uSway;
attribute float aSway;
`

// Replaces three.js's <project_vertex>: sway is added after the instance
// transform, so it moves in world space along the wind.
const PROJECT_WITH_SWAY = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  vec3 swayBase = ( instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  float swayHeight = max( mvPosition.y - swayBase.y, 0.0 );
  float swayPhase = swayBase.x * 0.37 + swayBase.z * 0.53;
  float gustWave = 0.5 + 0.5 * sin( dot( swayBase.xz, uWindDir ) * 0.3 - uTime * 1.4 );
  float gust = max( 1.0 + uGustiness * ( gustWave * 2.0 - 0.6 ), 0.2 );
  float flutter = 0.8 + 0.2 * sin( uTime * 2.1 + swayPhase ) + 0.08 * sin( uTime * 5.3 + swayPhase * 2.0 );
  float bend = uSway * aSway * ( uWindStrength / 6.0 ) * 0.025 * swayHeight * swayHeight * gust * flutter;
  mvPosition.xz += uWindDir * bend;
  mvPosition.y -= bend * bend * 0.15;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`

/** Patch a material so instanced meshes using it sway. */
export function applySway(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DECLARATIONS}`)
      .replace('#include <project_vertex>', PROJECT_WITH_SWAY)
  }
  material.customProgramCacheKey = () => 'tree-sway'
  return material
}

/** A depth material that sways the same way, so shadows move with the trees. */
export function createSwayDepthMaterial(uniforms) {
  return applySway(
    new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    uniforms
  )
}
