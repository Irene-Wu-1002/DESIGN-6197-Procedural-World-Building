import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createTrunkField } from '../cover/trunks'
import { trunkGround } from '../cover/coverRenderer'

/**
 * Filler trees for depth: a second, sparser field of trunks with simple
 * crowns between the real trees, drawn only in the haze (DISTANCE from
 * the eye), so the forest reads as layer after layer instead of a few
 * trunks in an empty fog.
 *
 * They are scenery only: no roots, water, habitat or shadows, and they
 * never stand inside a real tree's room. Each dissolves in (a dithered
 * fade on its distance from the eye), so moving never pops one in, and
 * size, lean and brightness vary per tree. Two instanced meshes, rebuilt
 * when the eye has moved REFRESH m.
 */

// Eye distance (m): dissolved in from [0] to [1], placed out to [2].
const DISTANCE = [7, 9.5, 16]
const REFRESH = 0.75
const CAPACITY = 320
// The filler grid, as a share of the real trunk spacing.
const SPACING = 0.8
const SALT = 4243
// Room kept around a real trunk (m).
const ROOM = 1.1
const TRUNK_HEIGHT = 5.5
const SHADE = { trunk: '#5a4c3e', crown: '#3a4a2c', brightness: [0.65, 1.15] }

const FADE_VERTEX = /* glsl */ `
#include <common>
varying vec3 vFillerWorld;
`
const FADE_FRAGMENT = /* glsl */ `
#include <common>
uniform vec2 uFade;
varying vec3 vFillerWorld;
`
// Dither (interleaved gradient noise): fragments drop out where the fade
// has not reached them.
const DISSOLVE = /* glsl */ `
#include <clipping_planes_fragment>
{
  float fade = smoothstep(uFade.x, uFade.y, distance(vFillerWorld.xz, cameraPosition.xz));
  float threshold = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (fade < threshold) discard;
}
`

function fadingMaterial(color, fade, name) {
  const material = new THREE.MeshLambertMaterial({ color })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFade = fade
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', FADE_VERTEX)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFillerWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FADE_FRAGMENT)
      .replace('#include <clipping_planes_fragment>', DISSOLVE)
  }
  material.customProgramCacheKey = () => name
  return material
}

// A plain tapered trunk (unit radius), a little buried: in the haze the
// bark and root flares of the real trunks would not show.
function createTrunkGeometry(height) {
  const geometry = new THREE.CylinderGeometry(0.85, 1.1, height + 0.2, 8, 1, true)
  geometry.translate(0, height / 2 - 0.1, 0)
  return geometry
}

// A rough crown: a few squashed blobs around the top of the trunk.
function createCrownGeometry() {
  const parts = [
    [0, 0, 0, 1.25, 0.9],
    [0.7, -0.45, 0.3, 0.85, 0.65],
    [-0.6, -0.3, -0.5, 0.9, 0.7],
    [0.1, 0.55, -0.2, 0.8, 0.6],
  ].map(([x, y, z, width, height]) => {
    const blob = new THREE.IcosahedronGeometry(1, 1)
    blob.scale(width, height, width)
    blob.translate(x, y, z)
    return blob
  })
  const merged = mergeGeometries(parts)
  parts.forEach((part) => part.dispose())
  merged.computeVertexNormals()
  return merged
}

export function createDistantForest(scene) {
  const fade = { value: new THREE.Vector2(DISTANCE[0], DISTANCE[1]) }
  const trunkGeometry = createTrunkGeometry(TRUNK_HEIGHT)
  const crownGeometry = createCrownGeometry()
  const trunkMaterial = fadingMaterial(SHADE.trunk, fade, 'distant-trunks')
  const crownMaterial = fadingMaterial(SHADE.crown, fade, 'distant-crowns')
  const makeMesh = (geometry, material) => {
    const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY)
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.setColorAt(0, new THREE.Color())
    scene.add(mesh)
    return mesh
  }
  const trunks = makeMesh(trunkGeometry, trunkMaterial)
  const crowns = makeMesh(crownGeometry, crownMaterial)

  let field = null
  let lastKey = null
  const last = new THREE.Vector2(Infinity, Infinity)
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const lean = new THREE.Quaternion()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const axis = new THREE.Vector3()
  const color = new THREE.Color()
  const unit = (trunk, k) => ((trunk.seed * (k + 1) * 0.618034) % 1 + 1) % 1

  const rebuild = (realTrunks, sampler, eye) => {
    let count = 0
    for (const trunk of field.trunksNear(eye.x, eye.z, DISTANCE[2])) {
      if (count >= CAPACITY) break
      if (Math.hypot(trunk.x - eye.x, trunk.z - eye.z) < DISTANCE[0]) continue
      if (realTrunks.distance(trunk.x, trunk.z) < ROOM) continue
      const radius = trunk.radius * (0.55 + 0.6 * unit(trunk, 0))
      const height = 0.75 + 0.5 * unit(trunk, 1)
      const ground = trunkGround({ ...trunk, radius }, sampler)
      axis.set(Math.cos(trunk.seed), 0, Math.sin(trunk.seed))
      lean.setFromAxisAngle(axis, 0.05 * (unit(trunk, 2) - 0.5))
      quaternion.setFromAxisAngle(up, (trunk.seed % 360) * (Math.PI / 180)).premultiply(lean)
      position.set(trunk.x, ground, trunk.z)
      scale.set(radius, height, radius)
      trunks.setMatrixAt(count, matrix.compose(position, quaternion, scale))
      const brightness = SHADE.brightness[0] + (SHADE.brightness[1] - SHADE.brightness[0]) * unit(trunk, 3)
      trunks.setColorAt(count, color.setScalar(brightness))
      // The crown sits on top, sized with the tree.
      const crownSize = 1.6 + 1.4 * unit(trunk, 4)
      position.set(trunk.x, ground + TRUNK_HEIGHT * height, trunk.z)
      scale.setScalar(crownSize)
      crowns.setMatrixAt(count, matrix.compose(position, quaternion, scale))
      crowns.setColorAt(count, color.setScalar(brightness * (0.85 + 0.3 * unit(trunk, 5))))
      count += 1
    }
    for (const mesh of [trunks, crowns]) {
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor.needsUpdate = true
    }
  }

  return {
    /** The ground settings (seed, trunkSpacing, trunks on or off). */
    setGround({ seed, trunkSpacing, trunks: on }) {
      field = createTrunkField(seed + SALT, trunkSpacing * SPACING, on)
      lastKey = null
    },
    /**
     * Once per frame. realTrunks / sampler: the world's (tiles); version:
     * the ground's; eye: the camera position; hidden: 0–1 (underground views).
     */
    update(realTrunks, sampler, version, eye, hidden) {
      const visible = hidden < 0.5 && Boolean(field && realTrunks && sampler)
      trunks.visible = crowns.visible = visible
      if (!visible) return
      const moved = Math.hypot(eye.x - last.x, eye.z - last.y) > REFRESH
      if (!moved && version === lastKey) return
      last.set(eye.x, eye.z)
      lastKey = version
      rebuild(realTrunks, sampler, eye)
    },
    dispose() {
      for (const mesh of [trunks, crowns]) {
        scene.remove(mesh)
        mesh.dispose()
      }
      trunkGeometry.dispose()
      crownGeometry.dispose()
      trunkMaterial.dispose()
      crownMaterial.dispose()
    },
  }
}
