import * as THREE from 'three'
import { createRandom } from '../distributions'
import { buildHierarchy } from './hierarchy'
import { LOD_LEVELS, buildLevelGeometry, chooseLevel } from './lod'

/**
 * Topic 6: a forest of copies of one branching structure, drawn with levels
 * of detail.
 *
 * Every level is built once (lod.js) and drawn as one InstancedMesh holding
 * the copies currently at that level, so the whole forest costs four draw
 * calls. Each frame update() measures how tall every copy looks on screen,
 * picks its level, and only rewrites the instance lists when a copy changes
 * level. Nothing is regenerated as the camera moves.
 */

const WHITE = new THREE.Color('#ffffff')
const LEVEL_TINTS = LOD_LEVELS.map(({ color }) => new THREE.Color(color))

export function createLodForest(tree, { twigRadius, gridSize }) {
  const hierarchy = buildHierarchy(tree.segments)
  const levels = LOD_LEVELS.map((level) => buildLevelGeometry(tree, hierarchy, twigRadius, level))

  // Size of one tree, for spacing the copies and measuring them on screen.
  const bounds = new THREE.Box3().setFromBufferAttribute(levels[0].geometry.getAttribute('position'))
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const radius = Math.max(size.length() / 2, 0.1)
  const spacing = Math.max(size.x, size.z, 1) * 1.15

  // Copies on a grid, each with its own turn and a slight size difference.
  const random = createRandom(7)
  const copies = []
  for (let row = 0; row < gridSize; row += 1) {
    for (let column = 0; column < gridSize; column += 1) {
      const scale = 0.85 + random() * 0.3
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3((column - (gridSize - 1) / 2) * spacing, 0, (row - (gridSize - 1) / 2) * spacing),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2),
        new THREE.Vector3(scale, scale, scale)
      )
      copies.push({
        matrix,
        center: center.clone().applyMatrix4(matrix),
        radius: radius * scale,
        level: -1,
      })
    }
  }

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })
  const group = new THREE.Group()
  const meshes = levels.map(({ geometry }) => {
    const mesh = new THREE.InstancedMesh(geometry, material, copies.length)
    mesh.count = 0
    // The instance lists change as the camera moves; skip the bounds check.
    mesh.frustumCulled = false
    group.add(mesh)
    return mesh
  })

  const forestBounds = new THREE.Box3()
  copies.forEach((copy) => forestBounds.expandByPoint(copy.center))
  forestBounds.expandByScalar(radius)

  let lastTint = null
  const perLevel = [0, 0, 0, 0]

  return {
    group,
    bounds: forestBounds,
    // Segments and triangles of one tree at each level.
    levels: levels.map(({ segments, triangles }) => ({ segments, triangles })),
    /**
     * settings: { mode: 'auto' | 'fixed' | 'off', level, bias, colorByLevel }.
     * Returns how many copies sit at each level.
     */
    update(camera, viewportHeight, settings) {
      const pixelsPerUnit = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360))
      let changed = lastTint !== settings.colorByLevel
      for (const copy of copies) {
        let level = 0
        if (settings.mode === 'fixed') level = settings.level
        else if (settings.mode === 'auto') {
          const distance = Math.max(camera.position.distanceTo(copy.center), 0.01)
          level = chooseLevel(((copy.radius * 2) / distance) * pixelsPerUnit, copy.level, settings.bias)
        }
        if (level !== copy.level) {
          copy.level = level
          changed = true
        }
      }
      if (!changed) return perLevel

      lastTint = settings.colorByLevel
      perLevel.fill(0)
      for (const copy of copies) {
        const mesh = meshes[copy.level]
        const slot = perLevel[copy.level]
        mesh.setMatrixAt(slot, copy.matrix)
        mesh.setColorAt(slot, settings.colorByLevel ? LEVEL_TINTS[copy.level] : WHITE)
        perLevel[copy.level] += 1
      }
      meshes.forEach((mesh, level) => {
        mesh.count = perLevel[level]
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      })
      return perLevel
    },
    dispose() {
      levels.forEach(({ geometry }) => geometry.dispose())
      meshes.forEach((mesh) => mesh.dispose())
      material.dispose()
    },
  }
}
