import * as THREE from 'three'
import { createTrunkField } from '../cover/trunks'
import { DEFAULT_HABITAT, applyHabitat, createHabitatField } from '../habitat/habitatFields'
import { TILE_SIZE, createGroundSampler } from './heightField'
import { buildTileData, decimateTileData, tileKey } from './tileData'
import { createTileMesh, recolorTileMesh } from './tileMesh'

/**
 * Streams terrain tiles around a focus point in rings. Each frame update()
 * decides which tiles should exist and at what detail, frees the rest, and
 * builds missing or outdated tiles nearest-first within a small time
 * budget, so moving never stutters. Old meshes stay visible until their
 * replacement is ready.
 *
 *   near ring    full detail with pebbles (the 3 × 3 around the focus at
 *                128 segments, the rest at 64), all ground cover, shadows
 *   middle ring  a 32-segment surface without pebble shapes and thinner,
 *                larger-featured cover (scatterTile `lite`); receives
 *                shadows but doesn't cast them
 * Beyond the rings the far ground (farGround.js) takes over.
 *
 * Habitat changes (moisture, sunlight, wind…) don't rebuild shapes: loaded
 * tiles get their fields redone, recoloured, and re-scattered, nearest
 * first, a few per frame. Ground-cover changes (refreshCover) only
 * re-scatter, the same way.
 */

// Detail: the 3 × 3 tiles around the focus are finest.
const FINE_SEGMENTS = 128
const NEAR_SEGMENTS = 64
const MIDDLE_SEGMENTS = 32
const FINE_RING = 1

/**
 * Whether the tile (dx, dz) tiles away from the focus tile is loaded: a
 * round area, so the detailed ground never ends in a square corner.
 */
export function inTileArea(dx, dz, viewDistance) {
  return Math.hypot(dx, dz) <= viewDistance + 0.5
}

/**
 * listeners (optional): onTileReady(key, data) after a tile is built,
 * onTileRemoved(key) when it's freed – used by the ground cover.
 */
export function createTileManager(scene, material, depthMaterial, listeners = {}) {
  const group = new THREE.Group()
  scene.add(group)
  const tiles = new Map()
  let sampler = null
  let trunks = null
  let habitatSettings = DEFAULT_HABITAT
  let habitat = null
  let version = 0
  let habitatVersion = 0
  let coverVersion = 0
  let refreshing = 0
  let mode = 'off'
  // Exclusion zones, for their preview colours (paths/exclusionZones.js).
  let exclusions = null
  let pending = 0

  const removeTile = (key) => {
    const tile = tiles.get(key)
    if (!tile) return
    group.remove(tile.mesh)
    tile.mesh.geometry.dispose()
    tiles.delete(key)
    listeners.onTileRemoved?.(key)
  }

  return {
    /** New ground settings; anything shape-related rebuilds every tile. */
    setGround(next) {
      sampler = createGroundSampler(next)
      trunks = createTrunkField(next.seed, next.trunkSpacing, next.trunks)
      habitat = createHabitatField(sampler, trunks, habitatSettings)
      version += 1
    },

    /** New habitat settings; loaded tiles refresh their fields over a few frames. */
    setHabitat(next) {
      habitatSettings = next
      if (!sampler) return
      habitat = createHabitatField(sampler, trunks, habitatSettings)
      habitatVersion += 1
      // Every loaded tile is now out of date (counted properly next update).
      refreshing = tiles.size
    },

    /** Re-scatter every loaded tile's cover over the next few frames. */
    refreshCover() {
      coverVersion += 1
      refreshing = tiles.size
    },

    /** The current habitat field (shared with the far ground). */
    get habitat() {
      return habitat
    },

    /** Changes whenever the ground or the habitat changes. */
    get habitatKey() {
      return `${version}:${habitatVersion}`
    },

    /** The tree trunks of the current ground (cover/trunks.js). */
    get trunks() {
      return trunks
    },

    /** Call fn(key, data) for every loaded tile (e.g. to re-scatter cover). */
    forEachTile(fn) {
      tiles.forEach((tile, key) => fn(key, tile.data))
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
      tiles.forEach((tile) => recolorTileMesh(tile.mesh, mode, exclusions))
    },

    /** New exclusion zones (repaints tiles if they're being previewed). */
    setExclusions(next) {
      exclusions = next
      if (mode === 'exclusion') tiles.forEach((tile) => recolorTileMesh(tile.mesh, mode, exclusions))
    },

    /**
     * rings: { near, outer } in tiles (outer ≥ near; equal means no middle
     * ring).
     */
    update(focusX, focusZ, rings, budgetMs) {
      if (!sampler) return
      const { near } = rings
      const outer = Math.max(rings.outer, near)
      const centerX = Math.floor(focusX / TILE_SIZE)
      const centerZ = Math.floor(focusZ / TILE_SIZE)
      const wanted = new Map()
      for (let dz = -outer; dz <= outer; dz += 1) {
        for (let dx = -outer; dx <= outer; dx += 1) {
          if (!inTileArea(dx, dz, outer)) continue
          const ring = Math.max(Math.abs(dx), Math.abs(dz))
          const inNear = inTileArea(dx, dz, near)
          wanted.set(tileKey(centerX + dx, centerZ + dz), {
            x: centerX + dx,
            z: centerZ + dz,
            ring,
            pebbles: inNear,
            segments: !inNear ? MIDDLE_SEGMENTS : ring <= FINE_RING ? FINE_SEGMENTS : NEAR_SEGMENTS,
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
        // Cover always scatters from 64-segment data (so near and middle rings
        // agree on placement); middle tiles draw a decimated copy.
        const data = buildTileData(sampler, want.x, want.z, Math.max(want.segments, NEAR_SEGMENTS), trunks, habitat, { pebbles: want.pebbles })
        const drawn = want.segments < NEAR_SEGMENTS ? decimateTileData(data, NEAR_SEGMENTS / want.segments) : data
        const mesh = createTileMesh(drawn, material, mode, depthMaterial, exclusions)
        // Middle-ring tiles only receive shadows (fewer draws in the shadow pass).
        if (!want.pebbles) mesh.castShadow = false
        removeTile(key)
        group.add(mesh)
        tiles.set(key, { mesh, data, version, habitatVersion, coverVersion, segments: want.segments, pebbles: want.pebbles })
        listeners.onTileReady?.(key, data)
        pending -= 1
      }

      // Habitat and cover refresh for tiles whose shape is current: redo
      // the habitat fields (if they changed), then re-scatter.
      const stale = [...wanted.entries()]
        .filter(([key]) => {
          const tile = tiles.get(key)
          return (
            tile &&
            tile.version === version &&
            (tile.habitatVersion !== habitatVersion || tile.coverVersion !== coverVersion)
          )
        })
        .sort((a, b) => a[1].ring - b[1].ring)
      refreshing = stale.length
      for (const [key] of stale) {
        if (performance.now() - start > budgetMs) break
        const tile = tiles.get(key)
        if (tile.habitatVersion !== habitatVersion) {
          applyHabitat(tile.data, habitat)
          if (tile.mesh.userData.data !== tile.data) {
            tile.mesh.userData.data = decimateTileData(tile.data, NEAR_SEGMENTS / tile.segments)
          }
          recolorTileMesh(tile.mesh, mode, exclusions)
          tile.habitatVersion = habitatVersion
        }
        tile.coverVersion = coverVersion
        listeners.onTileReady?.(key, tile.data)
        refreshing -= 1
      }
    },

    stats() {
      let middle = 0
      tiles.forEach((tile) => {
        if (!tile.pebbles) middle += 1
      })
      return { loaded: tiles.size, near: tiles.size - middle, middle, pending, refreshing }
    },

    dispose() {
      for (const key of [...tiles.keys()]) removeTile(key)
      scene.remove(group)
    },
  }
}
