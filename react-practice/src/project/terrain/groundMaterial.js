import * as THREE from 'three'

/**
 * Ground material: vertex colours from the tile data, plus a ~2 mm soil
 * grain added in the fragment shader. The grain bends the surface normal
 * (and nudges the colour) with procedural noise, so it costs no geometry
 * and stays sharp up close. It fades out where a pixel covers several
 * grains, so it never shimmers in the distance.
 *
 * It also paints still, dappled sunlight from the canopy (uDapple, 0–1),
 * and wet soil (uWet, 0–1: darker and glossier, from rain or season).
 */

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vGrainPosition;
`

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform float uGrain;
uniform float uDapple;
uniform float uWet;
uniform vec3 uSunDirection;
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

// Sun patches through the canopy: noise projected along the sun direction
// (so bumps catch it like real light), ~20 cm and ~7 cm blobs, soft edges.
float dappleField(vec3 world) {
  vec2 p = world.xz - uSunDirection.xz / max(uSunDirection.y, 0.2) * world.y;
  float n = grainNoise(p * 5.0 + 17.0) * 0.6 + grainNoise(p * 14.0 - 31.0) * 0.4;
  return smoothstep(0.48, 0.66, n);
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
  // Dappled light: shaded under leaves, brighter in the sun patches.
  float sunPatch = dappleField(vGrainPosition);
  diffuseColor.rgb *= mix(1.0 - 0.45 * uDapple, 1.0 + 0.55 * uDapple, sunPatch);
  // Wet soil is darker.
  diffuseColor.rgb *= 1.0 - 0.38 * uWet;
}
`

// Wet soil is glossier.
const WET_ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor *= 1.0 - 0.55 * uWet;
`

// Far ground only: skip pixels inside the hole (where detailed tiles are).
const HOLE = /* glsl */ `
#include <clipping_planes_fragment>
if (distance(vGrainPosition.xz, uHoleCenter) < uHoleRadius) discard;
`

// Tiles only: morph from full detail to the smooth surface with distance
// from the viewer (uMorphCenter), between uMorphRange.x and .y metres.
const MORPH_DECLARATIONS = /* glsl */ `
attribute float aSmoothY;
attribute vec3 aSmoothNormal;
uniform vec2 uMorphCenter;
uniform vec2 uMorphRange;
`
const MORPH_NORMAL = /* glsl */ `
#include <beginnormal_vertex>
float groundMorph = smoothstep(
  uMorphRange.x,
  uMorphRange.y,
  distance((modelMatrix * vec4(position, 1.0)).xz, uMorphCenter)
);
objectNormal = normalize(mix(objectNormal, aSmoothNormal, groundMorph));
`
const MORPH_POSITION = /* glsl */ `
transformed.y = mix(transformed.y, aSmoothY, groundMorph);
`

function patchGround(material, uniforms, { hole = false, morph = false }) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    let vertex = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${morph ? MORPH_POSITION : ''}` +
          'vGrainPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      )
    if (morph) {
      vertex = vertex
        .replace('#include <common>', `#include <common>\n${MORPH_DECLARATIONS}`)
        .replace('#include <beginnormal_vertex>', MORPH_NORMAL)
    }
    shader.vertexShader = vertex
    let fragment = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace('#include <normal_fragment_maps>', GRAIN_NORMAL)
      .replace('#include <color_fragment>', GRAIN_COLOR)
      .replace('#include <roughnessmap_fragment>', WET_ROUGHNESS)
    if (hole) {
      fragment = fragment
        .replace('#include <common>', '#include <common>\nuniform vec2 uHoleCenter;\nuniform float uHoleRadius;')
        .replace('#include <clipping_planes_fragment>', HOLE)
    }
    shader.fragmentShader = fragment
  }
  material.customProgramCacheKey = () => (hole ? 'micro-ground-far' : 'micro-ground-tiles')
}

const newMaterial = () =>
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 })

// Shadow pass for the tiles: morph the same way, or shadows would come from
// the detailed shape while the ground you see is smoothed (thin dark lines).
function createMorphDepthMaterial(morphUniforms) {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, morphUniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${MORPH_DECLARATIONS}`)
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
float groundMorph = smoothstep(
  uMorphRange.x,
  uMorphRange.y,
  distance((modelMatrix * vec4(position, 1.0)).xz, uMorphCenter)
);
${MORPH_POSITION}`
      )
  }
  material.customProgramCacheKey = () => 'micro-ground-depth'
  return material
}

/**
 * The ground material for the detailed tiles (which morph to the smooth
 * surface with distance: uMorphCenter, uMorphRange), and a twin for the far
 * ground that shares the look but leaves a round hole (uHoleCenter,
 * uHoleRadius) where the tiles are, so the coarse far ground can never poke
 * through the detailed ground.
 */
export function createGroundMaterial(sunDirection) {
  const uniforms = {
    uGrain: { value: 1 },
    uDapple: { value: 0.6 },
    uWet: { value: 0 },
    uSunDirection: { value: sunDirection.clone().normalize() },
  }
  const morphUniforms = {
    ...uniforms,
    uMorphCenter: { value: new THREE.Vector2() },
    uMorphRange: { value: new THREE.Vector2(1, 2) },
  }
  const holeUniforms = {
    ...uniforms,
    uHoleCenter: { value: new THREE.Vector2() },
    uHoleRadius: { value: 0 },
  }
  const material = newMaterial()
  patchGround(material, morphUniforms, { morph: true })
  const depthMaterial = createMorphDepthMaterial(morphUniforms)
  const farMaterial = newMaterial()
  patchGround(farMaterial, holeUniforms, { hole: true })
  return { material, depthMaterial, farMaterial, uniforms, morphUniforms, holeUniforms }
}
