import * as THREE from 'three'

/**
 * Sunlight through the canopy, for every lit material at once: the sun
 * (any directional light) is passed through a soft, irregular pattern of
 * gaps in a virtual leaf layer `height` m up. Each surface looks up the
 * pattern where its ray toward the sun crosses that layer, so the same
 * patches fall on the floor, trunks, moss and leaves, slide as the sun
 * moves, and stretch on slopes like real light. Under the leaves the sun
 * keeps `shade` of its strength; the sky (hemisphere) light is untouched,
 * so shade is dark but never black.
 *
 * installCanopyLight() patches three's lighting chunks and adds one shared
 * uniform to the built-in lit materials (a plain object, so material
 * clones keep pointing at it). Materials without it (custom shaders) see
 * strength 0: the sun as before.
 */

// x: strength (0–1), y: leaf layer height (m), z: pattern frequency (per m),
// w: the sun's share under the leaves.
const uniform = { value: { x: 0, y: 5.5, z: 0.55, w: 0.12 } }

const PARS = /* glsl */ `
uniform vec4 canopyLight;

float canopyHash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float canopyNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(canopyHash(i), canopyHash(i + vec2(1.0, 0.0)), u.x),
    mix(canopyHash(i + vec2(0.0, 1.0)), canopyHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// The sun's share at a world point, toward a world sun direction.
float canopySun(vec3 world, vec3 sun) {
  float rise = max(canopyLight.y - world.y, 0.0);
  vec2 p = (world.xz + sun.xz / max(sun.y, 0.15) * rise) * canopyLight.z;
  // Large gaps (~2 m), broken up at their edges, with small sun flecks
  // (~20 cm) scattered through them.
  float n = canopyNoise(p) * 0.45 + canopyNoise(p * 2.4 + 17.3) * 0.25 + canopyNoise(p * 8.0 - 41.7) * 0.3;
  float open = smoothstep(0.5, 0.64, n);
  return mix(1.0, mix(canopyLight.w, 1.0, open), canopyLight.x);
}
`

const DIRECT = /* glsl */ `
		getDirectionalLightInfo( directionalLight, directLight );
		if ( canopyLight.x > 0.0 ) {
			mat3 canopyToWorld = transpose( mat3( viewMatrix ) );
			directLight.color *= canopySun( cameraPosition + canopyToWorld * geometryPosition, canopyToWorld * directionalLight.direction );
		}
`

const LIT = ['standard', 'physical', 'lambert', 'phong', 'toon']
let installed = false

export function installCanopyLight() {
  if (installed) return
  installed = true
  THREE.ShaderChunk.lights_pars_begin += PARS
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
    /\s*getDirectionalLightInfo\( directionalLight, directLight \);\n/,
    DIRECT
  )
  for (const name of LIT) THREE.ShaderLib[name].uniforms.canopyLight = uniform
}

/** strength: 0–1 (0 = plain sun); height: the leaf layer (m, world y). */
export function setCanopyLight(strength, height) {
  uniform.value.x = strength
  uniform.value.y = height
}
