import * as THREE from 'three'
import { COVER_RULES, FLOWER_COLORS, HABITAT_NORMAL, MOSS_COLORS } from '../cover/coverRules'
import { flowerMoisture, flowerPatchAt, preference } from '../cover/scatterTile'
import { TILE_SIZE } from './heightField'
import { GROUND_COLORS, smoothHeightOf, soilColor } from './tileData'

// Ground cover read from afar: moss patches (the same patch field as the
// tiles) and flower drifts tint the far ground, so they don't stop where
// the tiles end.
const averageColor = (list) => {
  const sum = list.map((hex) => new THREE.Color(hex)).reduce((a, c) => a.add(c), new THREE.Color(0, 0, 0))
  return sum.multiplyScalar(1 / list.length).toArray()
}
const MOSS_TONE = averageColor(MOSS_COLORS)
const FLOWER_TONE = averageColor(FLOWER_COLORS)
const FAR_COVER = { moss: 0.5, flowers: 0.22, flowerPatch: [0.45, 0.75] }

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
  const fields = {}
  const color = [0, 0, 0]
  let lastKey = null
  // { cover, seed, moss } for the moss / flower tints, or null (moss: the
  // moss patch field, cover/mossField.js).
  let coverSettings = null
  let coverVersion = 0

  return {
    mesh,
    /** Ground-cover settings for the far tints (rebuilds on the next update). */
    setCover(cover, seed, moss) {
      coverSettings = { cover, seed, moss }
      coverVersion += 1
    },
    /**
     * Rebuild around the focus tile when it, the ground or habitat (key),
     * the cover, or the view distance (the outer ring, in tiles) changed.
     * habitat: the habitat field (habitat/habitatFields.js). Returns true
     * if it rebuilt.
     */
    update(sampler, habitat, focusX, focusZ, viewDistance, version) {
      const tileX = Math.floor(focusX / TILE_SIZE)
      const tileZ = Math.floor(focusZ / TILE_SIZE)
      const key = `${tileX},${tileZ},${viewDistance},${version},${coverVersion}`
      if (key === lastKey || !sampler || !habitat) return false
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
        habitat.farPoint(centerX + localX, centerZ + localZ, out, bumps, fields)
        const { moisture } = fields
        soilColor(moisture, out.hill, color, out.litter)
        // No pebble shapes out here, but keep their average tone so the
        // speckled ground doesn't stop at the tile edge.
        const cover = out.pebbleChance * PEBBLE_AREA
        for (let k = 0; k < 3; k += 1) color[k] += (PEBBLE_TONE[k] - color[k]) * cover
        if (coverSettings) {
          const { cover: c, seed, moss: mossField } = coverSettings
          const offHill = 1 - out.hill
          const moss =
            c.moss.on && mossField
              ? FAR_COVER.moss *
                mossField.density(centerX + localX, centerZ + localZ, {
                  moisture,
                  shade: fields.shade,
                  concavity: fields.concavity,
                  trunk: fields.trunkDistance,
                }) *
                offHill
              : 0
          const flowers = c.flowers?.on
            ? (c.flowers.amount / 100) *
              FAR_COVER.flowers *
              flowerMoisture(moisture) *
              preference(fields.sunlight, COVER_RULES.flowers.sunPreference, HABITAT_NORMAL.sunlight) *
              smoothstep(...FAR_COVER.flowerPatch, flowerPatchAt(centerX + localX, centerZ + localZ, seed)) *
              offHill
            : 0
          for (let k = 0; k < 3; k += 1) {
            color[k] += (MOSS_TONE[k] - color[k]) * moss
            color[k] += (FLOWER_TONE[k] - color[k]) * flowers
          }
        }
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
