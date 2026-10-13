import * as THREE from 'three'
import { ANT_HILL, hash } from '../terrain/heightField'

/**
 * The fly agaric: the world's landmark, a ~12 cm mushroom (a 40 m tower to
 * an ant) beside the ant hill. Stem, ring, and cap are lathe shapes from
 * profile curves (metres); the white spots on the red cap come from 3D
 * cellular noise in the cap's shader. Growth stages come later.
 */

// Distance from the ant hill's centre; the direction comes from the seed.
const DISTANCE = 0.24
// The stem reaches below ground, so it never floats where the ground
// smooths out with distance.
const BURY = 0.02

const lathe = (points, segments = 40) =>
  new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments)

const SPOTS_DECLARATIONS = /* glsl */ `
varying vec3 vCapPosition;
`
// 3D cellular noise: distance to the nearest random feature point.
const SPOTS_FRAGMENT_DECLARATIONS = /* glsl */ `
varying vec3 vCapPosition;
vec3 spotHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float spotCells(vec3 p) {
  vec3 cell = floor(p);
  float nearest = 1.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 offset = vec3(float(x), float(y), float(z));
    vec3 point = cell + offset + spotHash(cell + offset) * 0.8;
    nearest = min(nearest, length(point - p));
  }
  return nearest;
}
`
const SPOTS_COLOR = /* glsl */ `
#include <color_fragment>
{
  // Spots only on the top of the cap, not the rim's underside.
  float top = smoothstep(0.094, 0.1, vCapPosition.y);
  float d = spotCells(normalize(vCapPosition - vec3(0.0, 0.06, 0.0)) * 7.5);
  float spot = (1.0 - smoothstep(0.2, 0.27, d)) * top;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.9, 0.82), spot);
}
`

function capMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: '#c2261b', roughness: 0.45 })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SPOTS_DECLARATIONS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCapPosition = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SPOTS_FRAGMENT_DECLARATIONS}`)
      .replace('#include <color_fragment>', SPOTS_COLOR)
  }
  material.customProgramCacheKey = () => 'fly-agaric-cap'
  return material
}

export function createFlyAgaric(scene) {
  const stem = lathe([
    [0, -BURY],
    [0.016, -BURY],
    [0.017, 0],
    [0.0155, 0.012],
    [0.011, 0.03],
    [0.0095, 0.07],
    [0.009, 0.092],
    [0, 0.092],
  ])
  const ring = lathe([
    [0.0092, 0.079],
    [0.015, 0.073],
    [0.0175, 0.068],
    [0.0165, 0.067],
    [0.0095, 0.074],
  ])
  // Profiles run bottom → top so the lathe faces outward.
  const cap = lathe([
    [0.034, 0.0895],
    [0.0375, 0.0895],
    [0.039, 0.093],
    [0.037, 0.1],
    [0.03, 0.111],
    [0.018, 0.119],
    [0, 0.122],
  ])
  // Underside with the gills: a cream cone from the rim in to the stem.
  const gills = lathe([
    [0.034, 0.0895],
    [0.02, 0.0915],
    [0.009, 0.093],
  ])
  const cream = new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.8, side: THREE.DoubleSide })
  const red = capMaterial()
  const group = new THREE.Group()
  for (const [geometry, material] of [
    [stem, cream],
    [ring, cream],
    [cap, red],
    [gills, cream],
  ]) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  scene.add(group)

  return {
    group,
    /** Place it by the ant hill for this seed; hidden when off. */
    place(sampler, seed, visible) {
      group.visible = Boolean(visible && sampler)
      if (!group.visible) return
      const angle = hash(seed, 17, 9001) * Math.PI * 2
      const x = ANT_HILL.x + Math.cos(angle) * DISTANCE
      const z = ANT_HILL.z + Math.sin(angle) * DISTANCE
      group.position.set(x, sampler.height(x, z) - 0.002, z)
      group.rotation.set(0, angle, (hash(seed, 18, 9001) - 0.5) * 0.12)
    },
    /** Where it stands (for keeping other cover away), or null. */
    spot(seed) {
      const angle = hash(seed, 17, 9001) * Math.PI * 2
      return { x: ANT_HILL.x + Math.cos(angle) * DISTANCE, z: ANT_HILL.z + Math.sin(angle) * DISTANCE }
    },
    dispose() {
      scene.remove(group)
      for (const geometry of [stem, ring, cap, gills]) geometry.dispose()
      cream.dispose()
      red.dispose()
    },
  }
}
