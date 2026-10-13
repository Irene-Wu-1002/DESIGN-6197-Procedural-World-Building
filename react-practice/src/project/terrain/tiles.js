import * as THREE from 'three'
import { TILE_SIZE, createGroundSampler } from './heightField'
import { buildTileData, tileKey } from './tileData'
import { createTileMesh, recolorTileMesh } from './tileMesh'

/**
 * Streams terrain tiles around a focus point. Each frame update() decides
 * which tiles should exist (a round area `viewDistance` tiles across), frees
 * the rest, and builds missing or outdated tiles nearest-first within a
 * small time budget, so moving never stutters. Old meshes stay visible
 * until their replacement is ready.
 */

// Detail: the 3 × 3 tiles around the focus are fine, the rest coarser.
const NEAR_SEGMENTS = 128
const FAR_SEGMENTS = 64
const NEAR_RING = 1

/**
 * Whether the tile (dx, dz) tiles away from the focus tile is loaded: a
 * round area, so the detailed ground never ends in a square corner.
 */
export function inTileArea(dx, dz, viewDistance) {
  return Math.hypot(dx, dz) <= viewDistance + 0.5
}

export function createTileManager(scene, material, depthMaterial) {
  const group = new THREE.Group()
  scene.add(group)
  const tiles = new Map()
  let sampler = null
  let version = 0
  let mode = 'off'
  let pending = 0

  const removeTile = (key) => {
    const tile = tiles.get(key)
    if (!tile) return
    group.remove(tile.mesh)
    tile.mesh.geometry.dispose()
    tiles.delete(key)
  }

  return {
    /** New ground settings; anything shape-related rebuilds every tile. */
    setGround(next) {
      sampler = createGroundSampler(next)
      version += 1
    },

    /** Height of the ground at a world point (for the camera and focus). */
    heightAt(x, z) {
      return sampler ? sampler.height(x, z) : 0
    },

    /** The current ground sampler (shared with the far ground). */
    get sampler() {
      return sampler
    },

    /** Bumps whenever the ground settings change. */
    get version() {
      return version
    },

    setPreview(nextMode) {
      if (nextMode === mode) return
      mode = nextMode
      tiles.forEach((tile) => recolorTileMesh(tile.mesh, mode))
    },

    update(focusX, focusZ, viewDistance, budgetMs) {
      if (!sampler) return
      const centerX = Math.floor(focusX / TILE_SIZE)
      const centerZ = Math.floor(focusZ / TILE_SIZE)
      const wanted = new Map()
      for (let dz = -viewDistance; dz <= viewDistance; dz += 1) {
        for (let dx = -viewDistance; dx <= viewDistance; dx += 1) {
          if (!inTileArea(dx, dz, viewDistance)) continue
          const ring = Math.max(Math.abs(dx), Math.abs(dz))
          wanted.set(tileKey(centerX + dx, centerZ + dz), {
            x: centerX + dx,
            z: centerZ + dz,
            ring,
            segments: ring <= NEAR_RING ? NEAR_SEGMENTS : FAR_SEGMENTS,
          })
        }
      }
      for (const key of [...tiles.keys()]) if (!wanted.has(key)) removeTile(key)

      const todo = [...wanted.entries()]
        .filter(([key, want]) => {
          const tile = tiles.get(key)
          return !tile || tile.version !== version || tile.segments !== want.segments
        })
        .sort((a, b) => a[1].ring - b[1].ring)
      pending = todo.length

      const start = performance.now()
      for (const [key, want] of todo) {
        // Always build at least one tile per frame, then stop at the budget.
        if (performance.now() - start > budgetMs && pending < todo.length) break
        const data = buildTileData(sampler, want.x, want.z, want.segments)
        const mesh = createTileMesh(data, material, mode, depthMaterial)
        removeTile(key)
        group.add(mesh)
        tiles.set(key, { mesh, version, segments: want.segments })
        pending -= 1
      }
    },

    stats() {
      return { loaded: tiles.size, pending }
    },

    dispose() {
      for (const key of [...tiles.keys()]) removeTile(key)
      scene.remove(group)
    },
  }
}
