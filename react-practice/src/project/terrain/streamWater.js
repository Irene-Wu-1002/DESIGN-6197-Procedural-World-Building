import * as THREE from 'three'

/**
 * The stream's water: one ribbon along the stream (terrain/stream.js) at
 * its water surface, as wide as the channel; the banks rise through its
 * edges, so the water's outline is wherever ground and surface meet.
 *
 * The surface is a lit, see-through standard material whose normal is bent
 * in the fragment shader by ripples that flow downstream (two offset
 * phases blended, so the pattern never stretches however long it runs),
 * rougher and faster where the stream falls steeply (riffles, with a little
 * white water), plus rings where raindrops land. It reflects the sky at
 * grazing angles and is clearer at the edges, where it's shallow.
 */

// Rows along the stream: one per centre-line point (1 cm); columns across.
const COLUMNS = 7
// The ribbon reaches a little past the water's edge, into the banks.
const OVERLAP = 1.04
// Flow speed (m/s): still water, and extra per unit of fall per metre.
const SPEED = { base: 0.05, fall: 2.2, max: 0.35 }

const VERTEX_DECLARATIONS = /* glsl */ `
attribute vec4 aWater;
attribute vec2 aFlow;
varying vec4 vWater;
varying vec2 vFlow;
varying vec3 vWaterWorld;
`

const VERTEX = /* glsl */ `
#include <begin_vertex>
vWater = aWater;
vFlow = aFlow;
vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform float uTime;
uniform float uFlow;
uniform float uRain;
uniform float uOpacity;
uniform float uHalfWidth;
uniform vec3 uSky;
uniform vec3 uGlint;
uniform vec3 uSun;
varying vec4 vWater;
varying vec2 vFlow;
varying vec3 vWaterWorld;

float waterHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float waterNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), u.x),
    mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// Ripples at (along, across) metres, carried downstream at speed (m/s):
// two phases of the same pattern, each reset in turn while the other is
// at full weight.
float ripples(vec2 p, float speed, float rough) {
  float cycle = 1.2;
  float t = uTime / cycle;
  float h = 0.0;
  for (int k = 0; k < 2; k++) {
    float phase = fract(t + float(k) * 0.5);
    float weight = 1.0 - abs(phase * 2.0 - 1.0);
    vec2 q = p - vec2(speed * phase * cycle, 0.0) + float(k) * vec2(0.37, 0.11);
    // Stretched along the flow, finer where it's rough.
    float a = waterNoise(q * vec2(90.0, 160.0));
    float b = waterNoise(q * vec2(260.0, 380.0) * (1.0 + rough));
    h += weight * (a * 0.7 + b * 0.3 * (0.5 + rough));
  }
  return h;
}

// Rain: rings spreading from where drops land (2 cm cells, world space).
float rainRings(vec2 p) {
  if (uRain < 0.01) return 0.0;
  float cell = 0.02;
  // The 2 × 2 cells nearest p (a ring stays within about a cell).
  vec2 id = floor(p / cell) + step(0.5, fract(p / cell)) - 1.0;
  float h = 0.0;
  for (int dz = 0; dz <= 1; dz++) {
    for (int dx = 0; dx <= 1; dx++) {
      vec2 c = id + vec2(float(dx), float(dz));
      float r1 = waterHash(c);
      if (r1 > uRain) continue;
      vec2 centre = (c + vec2(waterHash(c + 7.1), waterHash(c + 3.3))) * cell;
      float life = fract(uTime * (0.8 + r1) + waterHash(c + 1.9));
      float radius = life * cell * 0.9;
      float d = length(p - centre);
      float ring = exp(-pow((d - radius) / 0.0012, 2.0));
      h += ring * (1.0 - life);
    }
  }
  return h;
}

float waterHeight(vec2 along, vec2 world, float speed, float rough) {
  return ripples(along, speed, rough) * (0.25 + 0.75 * rough) + rainRings(world) * 0.8;
}
`

const NORMAL = /* glsl */ `
#include <normal_fragment_maps>
float waterAlong = vWater.x;
float waterAcross = vWater.y * uHalfWidth;
float waterSpeed = vWater.z * uFlow;
float waterRough = vWater.w;
{
  vec2 a = vec2(waterAlong, waterAcross);
  vec2 w = vWaterWorld.xz;
  vec2 t = normalize(vFlow);
  vec2 n = vec2(-t.y, t.x);
  float e = 0.0006;
  float h0 = waterHeight(a, w, waterSpeed, waterRough);
  float hu = waterHeight(a + vec2(e, 0.0), w + t * e, waterSpeed, waterRough);
  float hv = waterHeight(a + vec2(0.0, e), w + n * e, waterSpeed, waterRough);
  // Slope of the ripples, as a tilt (they're a fraction of a millimetre).
  float k = 0.0035;
  vec2 grad = vec2(hu - h0, hv - h0) / e * k;
  vec3 bend = vec3(t.x * grad.x + n.x * grad.y, 0.0, t.y * grad.x + n.y * grad.y);
  normal = normalize(mat3(viewMatrix) * normalize(vec3(0.0, 1.0, 0.0) - bend));
}
`

const COLOR = /* glsl */ `
#include <color_fragment>
{
  float across = abs(vWater.y);
  // Shallow and clear at the edges, deeper and darker in the middle.
  float deep = 1.0 - across * across;
  diffuseColor.a = uOpacity * mix(0.22, 0.55, deep) * (1.0 - smoothstep(0.86, 1.0, across));
}
`

const EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  vec3 toEye = normalize(vViewPosition);
  float fresnel = 0.02 + 0.98 * pow(1.0 - clamp(dot(normal, toEye), 0.0, 1.0), 5.0);
  // The canopy and its bright gaps, mirrored: brighter where the ripples
  // tilt toward an opening (a cheap stand-in for a sky reflection).
  vec3 r = reflect(-toEye, normal);
  vec3 rWorld = normalize((vec4(r, 0.0) * viewMatrix).xyz);
  float gaps = smoothstep(0.5, 0.9, waterNoise(rWorld.xz / max(rWorld.y, 0.15) * 9.0 + 11.0));
  vec3 mirrored = uSky * 2.2 + uGlint * gaps * 1.1;
  totalEmissiveRadiance += mirrored * fresnel;
  // Sun glints on the ripples.
  float glint = pow(max(dot(rWorld, uSun), 0.0), 300.0);
  totalEmissiveRadiance += uGlint * glint * 6.0;
  diffuseColor.a = mix(diffuseColor.a, 1.0, fresnel * 0.85);
  // White water where it tumbles.
  float foam = smoothstep(0.62, 0.85, waterNoise(vec2(waterAlong - uTime * waterSpeed, waterAcross) * vec2(70.0, 120.0)));
  totalEmissiveRadiance += vec3(0.55) * foam * smoothstep(0.35, 0.9, waterRough);
  diffuseColor.a = min(diffuseColor.a + foam * waterRough * 0.4, 1.0);
}
`

export function createStreamWater(scene) {
  const uniforms = {
    uTime: { value: 0 },
    uFlow: { value: 1 },
    uRain: { value: 0 },
    uOpacity: { value: 1 },
    uHalfWidth: { value: 0.035 },
    uSky: { value: new THREE.Color('#5d6b62') },
    // Light through the canopy gaps (the sun's colour, by its strength).
    uGlint: { value: new THREE.Color('#ffffff') },
    uSun: { value: new THREE.Vector3(0, 1, 0) },
  }
  const material = new THREE.MeshStandardMaterial({
    color: '#3b4a3f',
    roughness: 0.04,
    metalness: 0,
    transparent: true,
    depthWrite: false,
  })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace('#include <begin_vertex>', VERTEX)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace('#include <normal_fragment_maps>', NORMAL)
      .replace('#include <color_fragment>', COLOR)
      .replace('#include <emissivemap_fragment>', EMISSIVE)
  }
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
  mesh.receiveShadow = true
  mesh.renderOrder = 1
  mesh.visible = false
  scene.add(mesh)

  return {
    mesh,

    /** Build the ribbon for this stream (or hide it: null). */
    setStream(stream) {
      mesh.geometry.dispose()
      mesh.geometry = new THREE.BufferGeometry()
      mesh.visible = Boolean(stream)
      if (!stream) return
      const { points, lengths, level, slope, count, halfWidth } = stream
      uniforms.uHalfWidth.value = halfWidth * OVERLAP
      const vertices = count * COLUMNS
      const position = new Float32Array(vertices * 3)
      const water = new Float32Array(vertices * 4)
      const flow = new Float32Array(vertices * 2)
      for (let i = 0; i < count; i += 1) {
        const a = Math.max(i - 1, 0)
        const b = Math.min(i + 1, count - 1)
        let tx = points[b * 2] - points[a * 2]
        let tz = points[b * 2 + 1] - points[a * 2 + 1]
        const length = Math.hypot(tx, tz) || 1
        tx /= length
        tz /= length
        const speed = Math.min(SPEED.base + SPEED.fall * Math.max(slope[i], 0), SPEED.max)
        const rough = Math.min(Math.max(slope[i], 0) / 0.12, 1)
        for (let c = 0; c < COLUMNS; c += 1) {
          const v = (c / (COLUMNS - 1)) * 2 - 1
          const k = i * COLUMNS + c
          const offset = v * halfWidth * OVERLAP
          position[k * 3] = points[i * 2] - tz * offset
          position[k * 3 + 1] = level[i]
          position[k * 3 + 2] = points[i * 2 + 1] + tx * offset
          water.set([lengths[i], v, speed, rough], k * 4)
          flow.set([tx, tz], k * 2)
        }
      }
      const index = []
      for (let i = 0; i < count - 1; i += 1) {
        for (let c = 0; c < COLUMNS - 1; c += 1) {
          const a = i * COLUMNS + c
          const b = a + COLUMNS
          index.push(a, a + 1, b, b, a + 1, b + 1)
        }
      }
      const geometry = mesh.geometry
      geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
      geometry.setAttribute('aWater', new THREE.BufferAttribute(water, 4))
      geometry.setAttribute('aFlow', new THREE.BufferAttribute(flow, 2))
      geometry.setIndex(index.length > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1))
      geometry.computeVertexNormals()
      geometry.computeBoundingSphere()
      uniforms.uFlow.value = stream.flow
    },

    /**
     * time: world seconds; rain 0–1; sky: the horizon colour; light: the
     * sun's colour and intensity; sun: toward the sun; hidden 0–1 (looking underground fades it
     * out).
     */
    update({ time, rain, sky, light, intensity = 1, sun, hidden = 0 }) {
      if (sun) uniforms.uSun.value.copy(sun).normalize()
      uniforms.uTime.value = time
      uniforms.uRain.value = rain
      uniforms.uOpacity.value = 1 - hidden
      if (sky) uniforms.uSky.value.copy(sky)
      if (light) uniforms.uGlint.value.copy(light).multiplyScalar(intensity / 3.4)
    },

    dispose() {
      scene.remove(mesh)
      mesh.geometry.dispose()
      material.dispose()
    },
  }
}
