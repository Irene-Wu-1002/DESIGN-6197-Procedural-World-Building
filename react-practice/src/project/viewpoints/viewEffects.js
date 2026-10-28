import * as THREE from 'three'

/**
 * Per-species vision as one light full-screen pass. The scene renders into
 * a multisampled target, then a single shader applies, in order:
 *   compound eye  hexagonal facets toward the edges, clear in the centre
 *   forest grade  cooler, darker shade and warm sunlit highlights, browns
 *                 toward forest green, a little less saturation and more
 *                 contrast (the World's own look, under every preset)
 *   colour        saturation, contrast, tint
 *   ultraviolet   pale, bright surfaces (petals, spores) glow violet
 *   vignette
 *   crossfade     from a captured frame (reduced-motion switching)
 *   dark          fade to black (ant tunnels)
 *
 * Presets are plain numbers, so blending between viewpoints only changes
 * uniforms: the shader is compiled once, at start-up. When nothing is
 * active (no grade, Free, no fade) the pass is skipped and the scene
 * renders straight to the screen.
 */

export const EFFECT_PRESETS = {
  natural: { saturation: 1, contrast: 1, tint: [1, 1, 1], uv: 0, compound: 0, vignette: 0 },
  ultraviolet: { saturation: 1.22, contrast: 1.05, tint: [0.98, 1, 1.06], uv: 1, compound: 0, vignette: 0.18 },
  compound: { saturation: 0.85, contrast: 1.08, tint: [1.04, 1.01, 0.92], uv: 0, compound: 1, vignette: 0.4 },
}

// The forest grade at full strength.
const GRADE = {
  shadowTint: [0.86, 0.97, 0.95],
  highlightTint: [1.07, 1.02, 0.86],
  // How far dull browns move toward olive green (0–1).
  green: 0.3,
  saturation: 0.9,
  contrast: 1.12,
}

// Facet size in CSS pixels, and the clear centre's radius (share of the
// half-height of the screen).
const FACET_PX = 8
const CLEAR_RADIUS = 0.62

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAGMENT = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tPrev;
uniform vec2 uResolution;
uniform float uFacet;
uniform float uClear;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uTint;
uniform float uUV;
uniform float uCompound;
uniform float uVignette;
uniform float uPrevMix;
uniform float uDark;
uniform float uGrade;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uGreen;
uniform float uGradeSaturation;
uniform float uGradeContrast;
varying vec2 vUv;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// The forest grade, on linear colour.
vec3 forestGrade(vec3 c) {
  float l = dot(c, LUMA);
  float shade = 1.0 - smoothstep(0.0, 0.18, l);
  float lit = smoothstep(0.2, 0.7, l);
  // Dull browns (red ahead of green, but not by as much as a red cap or an
  // orange wing) lean toward olive, except where the sun lights them.
  float lead = (c.r - c.g) / max(c.r, 1e-4);
  float brown = smoothstep(0.08, 0.3, lead) * (1.0 - smoothstep(0.45, 0.65, lead));
  float shift = uGreen * brown * (1.0 - lit) * (c.r - c.g);
  c.r -= shift;
  c.g += 0.35 * shift;
  c *= mix(vec3(1.0), uShadowTint, shade);
  c *= mix(vec3(1.0), uHighlightTint, lit);
  c = mix(vec3(dot(c, LUMA)), c, uGradeSaturation);
  // Contrast around the mid-tones in a perceptual (square-root) space,
  // eased in from black so the deepest shade keeps its detail.
  vec3 p = sqrt(max(c, 0.0));
  vec3 pivot = vec3(0.42);
  p = mix(p, (p - pivot) * uGradeContrast + pivot, smoothstep(0.0, 0.3, p));
  return p * p;
}

// Nearest hexagon centre for a point measured in facet units.
vec2 hexOffset(vec2 p) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  return dot(a, a) < dot(b, b) ? a : b;
}

void main() {
  vec2 centered = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float radius = length(centered) * 2.0;
  vec3 color = texture2D(tScene, vUv).rgb;
  color = mix(color, forestGrade(color), uGrade);

  float facets = uCompound * 0.85 * smoothstep(uClear, uClear + 0.7, radius);
  if (facets > 0.001) {
    vec2 p = vUv * uResolution / uFacet;
    vec2 offset = hexOffset(p);
    vec3 facet = texture2D(tScene, (p - offset) * uFacet / uResolution).rgb;
    // Each facet is a tiny lens: bright middle, dark rim.
    vec2 g = abs(offset);
    float edge = max(dot(g, vec2(0.5, 0.8660254)), g.x) * 2.0;
    facet *= mix(1.08, 0.82, edge);
    facet *= 1.0 - 0.75 * smoothstep(0.78, 1.0, edge);
    color = mix(color, facet, facets);
  }

  float luma = dot(color, LUMA);
  color = mix(vec3(luma), color, uSaturation);
  color = (color - 0.18) * uContrast + 0.18;
  color *= uTint;

  float chroma = max(max(color.r, color.g), color.b) - min(min(color.r, color.g), color.b);
  float pale = smoothstep(0.3, 0.85, luma) * (1.0 - smoothstep(0.05, 0.35, chroma));
  color += uUV * pale * vec3(0.2, 0.1, 0.42);

  color *= 1.0 - uVignette * smoothstep(0.6, 1.5, radius);
  color = max(color, 0.0);
  color = mix(color, texture2D(tPrev, vUv).rgb, uPrevMix);
  color *= 1.0 - uDark;
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`

/** A blendable copy of a preset. */
export function presetValues(name) {
  const preset = EFFECT_PRESETS[name] ?? EFFECT_PRESETS.natural
  return { ...preset, tint: [...preset.tint] }
}

export function lerpPreset(a, b, t, out) {
  for (const key of ['saturation', 'contrast', 'uv', 'compound', 'vignette']) out[key] = a[key] + (b[key] - a[key]) * t
  for (let k = 0; k < 3; k += 1) out.tint[k] = a.tint[k] + (b.tint[k] - a.tint[k]) * t
  return out
}

const isNatural = (v) =>
  Math.abs(v.saturation - 1) < 0.002 &&
  Math.abs(v.contrast - 1) < 0.002 &&
  v.uv < 0.002 &&
  v.compound < 0.002 &&
  v.vignette < 0.002 &&
  Math.abs(v.tint[0] - 1) + Math.abs(v.tint[1] - 1) + Math.abs(v.tint[2] - 1) < 0.006

export function createViewEffects(renderer) {
  const size = new THREE.Vector2()
  const targetOptions = { type: THREE.HalfFloatType, depthBuffer: true }
  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, { ...targetOptions, samples: 4 })
  const prevTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: sceneTarget.texture },
      tPrev: { value: prevTarget.texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFacet: { value: FACET_PX },
      uClear: { value: CLEAR_RADIUS },
      uSaturation: { value: 1 },
      uContrast: { value: 1 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uUV: { value: 0 },
      uCompound: { value: 0 },
      uVignette: { value: 0 },
      uPrevMix: { value: 0 },
      uDark: { value: 0 },
      uGrade: { value: 1 },
      uShadowTint: { value: new THREE.Vector3().fromArray(GRADE.shadowTint) },
      uHighlightTint: { value: new THREE.Vector3().fromArray(GRADE.highlightTint) },
      uGreen: { value: GRADE.green },
      uGradeSaturation: { value: GRADE.saturation },
      uGradeContrast: { value: GRADE.contrast },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
  })
  const quadScene = new THREE.Scene()
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  quad.frustumCulled = false
  quadScene.add(quad)
  const u = material.uniforms

  const setValues = (values, { prevMix = 0, dark = 0, grade = 1 } = {}) => {
    u.uGrade.value = grade
    u.uSaturation.value = values.saturation
    u.uContrast.value = values.contrast
    u.uTint.value.fromArray(values.tint)
    u.uUV.value = values.uv
    u.uCompound.value = values.compound
    u.uVignette.value = values.vignette
    u.uPrevMix.value = prevMix
    u.uDark.value = dark
  }

  const renderPass = (scene, camera, output) => {
    renderer.setRenderTarget(sceneTarget)
    renderer.render(scene, camera)
    renderer.setRenderTarget(output)
    renderer.render(quadScene, quadCamera)
    renderer.setRenderTarget(null)
  }

  return {
    setSize(width, height, pixelRatio) {
      size.set(Math.max(1, Math.floor(width * pixelRatio)), Math.max(1, Math.floor(height * pixelRatio)))
      sceneTarget.setSize(size.x, size.y)
      prevTarget.setSize(size.x, size.y)
      u.uResolution.value.copy(size)
      u.uFacet.value = FACET_PX * pixelRatio
    },

    /**
     * Compile every scene material for both outputs (screen and the
     * target), plus the pass itself, so switching never stalls.
     */
    warmUp(scene, camera) {
      renderer.compile(scene, camera)
      renderer.setRenderTarget(sceneTarget)
      renderer.compile(scene, camera)
      renderer.setRenderTarget(prevTarget)
      renderer.compile(quadScene, quadCamera)
      renderer.setRenderTarget(null)
      renderer.compile(quadScene, quadCamera)
    },

    /** Copy what the given view looks like now (for a crossfade). */
    capture(scene, camera, values, { dark = 0, grade = 1 } = {}) {
      setValues(values, { dark, grade })
      renderPass(scene, camera, prevTarget)
    },

    /**
     * values: blended preset; prevMix: 0–1 of the captured frame; dark: 0–1;
     * grade: 0–1 of the forest grade.
     */
    render(scene, camera, values, { prevMix = 0, dark = 0, grade = 1 } = {}) {
      if (prevMix < 0.001 && dark < 0.001 && grade < 0.001 && isNatural(values)) {
        renderer.render(scene, camera)
        return false
      }
      setValues(values, { prevMix, dark, grade })
      renderPass(scene, camera, null)
      return true
    },

    dispose() {
      sceneTarget.dispose()
      prevTarget.dispose()
      material.dispose()
      quad.geometry.dispose()
    },
  }
}
