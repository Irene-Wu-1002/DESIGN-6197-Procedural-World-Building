import * as THREE from 'three'

/**
 * Ground material: vertex colours from the tile data, plus a ~2 mm soil
 * grain added in the fragment shader. The grain bends the surface normal
 * (and nudges the colour) with procedural noise, so it costs no geometry
 * and stays sharp up close. It fades out where a pixel covers several
 * grains, so it never shimmers in the distance.
 */

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vGrainPosition;
`

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform float uGrain;
varying vec3 vGrainPosition;

float grainHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Smooth value noise.
float grainNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = grainHash(i);
  float b = grainHash(i + vec2(1.0, 0.0));
  float c = grainHash(i + vec2(0.0, 1.0));
  float d = grainHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Two scales of grain: ~2 mm and ~0.7 mm (frequencies per metre).
float grainField(vec2 p) {
  return grainNoise(p * 500.0) * 0.65 + grainNoise(p * 1400.0) * 0.35;
}
`

// Bend the (view-space) normal by the grain's slope.
const GRAIN_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
  vec2 p = vGrainPosition.xz;
  // Fade out when one pixel spans more than ~a grain.
  float footprint = length(fwidth(p)) * 500.0;
  float strength = uGrain * (1.0 - smoothstep(0.5, 1.5, footprint));
  if (strength > 0.001) {
    float e = 0.00025;
    float center = grainField(p);
    float gx = (grainField(p + vec2(e, 0.0)) - center) / e;
    float gz = (grainField(p + vec2(0.0, e)) - center) / e;
    vec3 bend = vec3(-gx, 0.0, -gz) * 0.0006 * strength;
    normal = normalize(normal + mat3(viewMatrix) * bend);
  }
}
`

// Speckle the colour a little at the same scale.
const GRAIN_COLOR = /* glsl */ `
#include <color_fragment>
{
  vec2 p = vGrainPosition.xz;
  float footprint = length(fwidth(p)) * 500.0;
  float strength = uGrain * (1.0 - smoothstep(0.5, 1.5, footprint));
  diffuseColor.rgb *= 1.0 + (grainField(p) - 0.5) * 0.35 * strength;
}
`

export function createGroundMaterial() {
  const uniforms = { uGrain: { value: 1 } }
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.97,
    metalness: 0,
  })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGrainPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace('#include <normal_fragment_maps>', GRAIN_NORMAL)
      .replace('#include <color_fragment>', GRAIN_COLOR)
  }
  material.customProgramCacheKey = () => 'micro-ground'
  return { material, uniforms }
}
