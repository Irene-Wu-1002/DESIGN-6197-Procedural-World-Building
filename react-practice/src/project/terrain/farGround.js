import * as THREE from 'three'
import { TILE_SIZE } from './heightField'
import { GROUND_COLORS, moistureOf, smoothHeightOf, soilColor } from './tileData'

/**
 * Far ground: one coarse ring-shaped mesh around the focus, out to
 * OUTER_RADIUS, so the world continues to the horizon instead of ending at
 * the tile edge.
 *
 * How it joins the detailed tiles without a seam:
 * - Tiles morph from full detail to the *smooth* surface (broad slopes +
 *   ant hill, no bumps or pebbles) with distance from the viewer
 *   (morphRange below), so the outer tiles are already smooth.
 * - The far ground is built from that same smooth surface. It changes
 *   slowly (~30 cm), so this coarse mesh follows it closely and the two
 *   meet at the same height.
 * - Where tiles cover it, it sits a little lower (more where tiles still
 *   have bumps, ~1 mm where they're smooth) so they never flicker, and its
 *   material discards pixels in a hole where tiles are surely loaded.
 * - Centred on the focus tile, so it only rebuilds when you cross a tile.
 */

const OUTER_RADIUS = 12
const INNER_RADIUS = 0.04
const RINGS = 56
const SEGMENTS = 128
// How far the viewer can be from the centre of their tile.
const HALF_DIAGONAL = TILE_SIZE * Math.SQRT1_2
// Sink below tiles that still have detail (whose finer slopes, bumps, and
// hollows can dip ~1.5 cm under the smooth surface), and below fully smooth
// tiles (just enough to cover the coarse mesh's own small error).
const SINK_DETAIL = 0.02
const SINK_SMOOTH = 0.002
// Beyond the outermost tile corners the sink fades out over this distance.
const SINK_FADE = 0.15
// The hole stays this many tiles inside the view distance (see update()).
const HOLE_MARGIN = 1.25
// The bumps' share of the colour (moisture) fades out this far past the edge.
const BUMP_COLOR_FADE = 1.5
// Average pebble colour, and the share of a cell an average pebble covers.
const PEBBLE_TONE = GROUND_COLORS.pebbleLight.map(
  (value, k) => (value + GROUND_COLORS.pebbleDark[k]) / 2
)
const PEBBLE_AREA = 0.35

const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * Distances from the viewer [start, end] over which tiles morph to the
 * smooth surface. The end is where tiles are guaranteed to exist around
 * the viewer, wherever they stand inside their tile.
 */
export function morphRange(viewDistance) {
  const end = (viewDistance + 0.5) * TILE_SIZE - 2 * HALF_DIAGONAL - 0.01
  return [Math.max(end - 0.2, 0), Math.max(end, 0.01)]
}

function ringRadius(ring) {
  return INNER_RADIUS * (OUTER_RADIUS / INNER_RADIUS) ** (ring / (RINGS - 1))
}

/**
 * material: the far-ground material; holeUniforms: its uHoleCenter and
 * uHoleRadius, updated here as the far ground moves.
 */
export function createFarGround(material, holeUniforms) {
  // Vertex 0 is the centre; then RINGS rings of SEGMENTS vertices.
  const count = 1 + RINGS * SEGMENTS
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const indices = []
  const vertex = (ring, segment) => 1 + ring * SEGMENTS + (segment % SEGMENTS)
  for (let segment = 0; segment < SEGMENTS; segment += 1) {
    indices.push(0, vertex(0, segment + 1), vertex(0, segment))
  }
  for (let ring = 0; ring < RINGS - 1; ring += 1) {
    for (let segment = 0; segment < SEGMENTS; segment += 1) {
      const a = vertex(ring, segment)
      const b = vertex(ring, segment + 1)
      const c = vertex(ring + 1, segment)
      const d = vertex(ring + 1, segment + 1)
      indices.push(a, b, c, b, d, c)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(indices)

  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  // Big and always around the camera; skip culling.
  mesh.frustumCulled = false

  const out = {}
  const color = [0, 0, 0]
  let lastKey = null

  return {
    mesh,
    /**
     * Rebuild around the focus tile when it, the ground, or the view
     * distance changed. Returns true if it rebuilt.
     */
    update(sampler, focusX, focusZ, viewDistance, version) {
      const tileX = Math.floor(focusX / TILE_SIZE)
      const tileZ = Math.floor(focusZ / TILE_SIZE)
      const key = `${tileX},${tileZ},${viewDistance},${version}`
      if (key === lastKey || !sampler) return false
      lastKey = key

      // Centre on the middle of the focus tile.
      const centerX = (tileX + 0.5) * TILE_SIZE
      const centerZ = (tileZ + 0.5) * TILE_SIZE
      // Outermost tile corners reach this far from the centre.
      const outerEdge = (viewDistance + 0.5) * TILE_SIZE + HALF_DIAGONAL
      const [morphStart, morphEnd] = morphRange(viewDistance)

      // The viewer is within HALF_DIAGONAL of the centre, so be conservative.
      const sinkAt = (distance) => {
        const detail =
          1 - smoothstep(morphStart - HALF_DIAGONAL, morphEnd + HALF_DIAGONAL, distance)
        const sink = SINK_SMOOTH + (SINK_DETAIL - SINK_SMOOTH) * detail
        return sink * (1 - smoothstep(outerEdge, outerEdge + SINK_FADE, distance))
      }

      const write = (index, localX, localZ) => {
        sampler.sample(centerX + localX, centerZ + localZ, out)
        const distance = Math.hypot(localX, localZ)
        positions[index * 3] = localX
        positions[index * 3 + 1] = smoothHeightOf(out) - sinkAt(distance)
        positions[index * 3 + 2] = localZ
        // Colour keeps the bumps' damp/dry pattern near the tiles, then
        // fades to the broad pattern (sampling it coarsely would only alias).
        const bumps = 1 - smoothstep(outerEdge, outerEdge + BUMP_COLOR_FADE, distance)
        soilColor(moistureOf(out.broad, out.bump * bumps), out.hill, color, out.litter)
        // No pebble shapes out here, but keep their average tone so the
        // speckled ground doesn't stop at the tile edge.
        const cover = out.pebbleChance * PEBBLE_AREA
        for (let k = 0; k < 3; k += 1) color[k] += (PEBBLE_TONE[k] - color[k]) * cover
        colors.set(color, index * 3)
      }

      write(0, 0, 0)
      for (let ring = 0; ring < RINGS; ring += 1) {
        const radius = ringRadius(ring)
        for (let segment = 0; segment < SEGMENTS; segment += 1) {
          const angle = (segment / SEGMENTS) * Math.PI * 2
          write(vertex(ring, segment), Math.cos(angle) * radius, Math.sin(angle) * radius)
        }
      }
      mesh.position.set(centerX, 0, centerZ)
      // Tiles within this radius were already loaded before you stepped into
      // this tile, so the hole never opens over ground that's still building.
      holeUniforms.uHoleCenter.value.set(centerX, centerZ)
      holeUniforms.uHoleRadius.value = Math.max(viewDistance - HOLE_MARGIN, 0) * TILE_SIZE
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.needsUpdate = true
      geometry.computeVertexNormals()
      return true
    },
    dispose() {
      geometry.dispose()
    },
  }
}
