import * as THREE from 'three'
import { TILE_SIZE } from './heightField'
import { colorTile } from './tileData'

/**
 * Mesh for one tile, in tile-local coordinates (the mesh is positioned at
 * the tile's corner, which keeps float precision high far from the origin).
 * A "skirt" hangs down from every edge so cracks between tiles of different
 * detail are never visible.
 */

const SKIRT_DEPTH = 0.006

// Border vertex indices in order around the tile.
function borderLoop(n) {
  const loop = []
  for (let column = 0; column < n - 1; column += 1) loop.push(column)
  for (let row = 0; row < n - 1; row += 1) loop.push(row * n + (n - 1))
  for (let column = n - 1; column > 0; column -= 1) loop.push((n - 1) * n + column)
  for (let row = n - 1; row > 0; row -= 1) loop.push(row * n)
  return loop
}

export function createTileMesh(data, material, mode) {
  const { n, step, height, normal } = data
  const loop = borderLoop(n)
  const gridCount = n * n
  const total = gridCount + loop.length
  const positions = new Float32Array(total * 3)
  const normals = new Float32Array(total * 3)
  const colors = new Float32Array(total * 3)

  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const index = row * n + column
      positions[index * 3] = column * step
      positions[index * 3 + 1] = height[index]
      positions[index * 3 + 2] = row * step
    }
  }
  normals.set(normal)
  // Skirt vertices: copies of the border, pushed down.
  loop.forEach((source, k) => {
    const target = gridCount + k
    positions[target * 3] = positions[source * 3]
    positions[target * 3 + 1] = positions[source * 3 + 1] - SKIRT_DEPTH
    positions[target * 3 + 2] = positions[source * 3 + 2]
    normals[target * 3] = normal[source * 3]
    normals[target * 3 + 1] = normal[source * 3 + 1]
    normals[target * 3 + 2] = normal[source * 3 + 2]
  })

  const indices = []
  for (let row = 0; row < n - 1; row += 1) {
    for (let column = 0; column < n - 1; column += 1) {
      const a = row * n + column
      const b = a + 1
      const c = a + n
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  // Skirt strips, both windings so they show from either side.
  loop.forEach((source, k) => {
    const next = loop[(k + 1) % loop.length]
    const low = gridCount + k
    const lowNext = gridCount + ((k + 1) % loop.length)
    indices.push(source, low, next, next, low, lowNext)
    indices.push(source, next, low, next, lowNext, low)
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()

  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(data.tileX * TILE_SIZE, 0, data.tileZ * TILE_SIZE)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData = { data, loop }
  recolorTileMesh(mesh, mode)
  return mesh
}

/** Repaint a tile for a preview mode without rebuilding its shape. */
export function recolorTileMesh(mesh, mode) {
  const { data, loop } = mesh.userData
  const colors = mesh.geometry.attributes.color.array
  colorTile(data, mode, colors)
  const gridCount = data.n * data.n
  loop.forEach((source, k) => {
    const target = gridCount + k
    colors[target * 3] = colors[source * 3]
    colors[target * 3 + 1] = colors[source * 3 + 1]
    colors[target * 3 + 2] = colors[source * 3 + 2]
  })
  mesh.geometry.attributes.color.needsUpdate = true
}
