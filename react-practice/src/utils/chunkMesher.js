import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js'

// Marching Cubes over one chunk of a density field.
//
// Week 3 used three.js' MarchingCubes object, which owns a single cubic grid
// and skips its outer cells. That is fine for one small planet but leaves
// cracks when a large world is split into chunks. This mesher reuses the same
// lookup tables (Paul Bourke's edge/triangle tables) and adds:
//   - an arbitrary nx × ny × nz grid positioned anywhere in world space;
//   - a one-sample padding ring, so gradient normals on a chunk's border use
//     the same samples as its neighbour and chunks join without seams.
//
// Density convention matches Week 3: positive = solid, negative = empty.

// Cube corners in the order the Bourke tables expect.
const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
]

const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
]

/**
 * Sample density for a chunk with cells [0, n) on each axis.
 * The returned field stores points -1..n+1 per axis (n + 3 samples) so the
 * mesher can take central differences at the chunk boundary.
 */
export function sampleChunkField({ origin, cellSize, cells, sample }) {
  const [nx, ny, nz] = cells
  const px = nx + 3
  const py = ny + 3
  const pz = nz + 3
  const field = new Float32Array(px * py * pz)
  let solid = 0
  let empty = 0

  for (let k = 0; k < pz; k += 1) {
    const z = origin[2] + (k - 1) * cellSize
    for (let j = 0; j < py; j += 1) {
      const y = origin[1] + (j - 1) * cellSize
      const row = j * px + k * px * py
      for (let i = 0; i < px; i += 1) {
        const value = sample(origin[0] + (i - 1) * cellSize, y, z)
        field[row + i] = value
        if (value > 0) solid += 1
        else empty += 1
      }
    }
  }

  return { field, dims: [px, py, pz], solid, empty }
}

/**
 * Polygonize a padded field from sampleChunkField.
 * Returns non-indexed positions and normals (Float32Array, xyz per vertex).
 */
export function polygonizeChunk({ field, dims, origin, cellSize, isovalue = 0 }) {
  const [px, py] = dims
  const nx = dims[0] - 3
  const ny = dims[1] - 3
  const nz = dims[2] - 3
  const stride = [1, px, px * py]

  const positions = []
  const normals = []
  const cornerValues = new Float32Array(8)
  const cornerIndex = new Int32Array(8)
  const edgePoints = new Float32Array(12 * 3)
  const edgeNormals = new Float32Array(12 * 3)
  const gradA = new Float32Array(3)
  const gradB = new Float32Array(3)

  const index = (i, j, k) => (i + 1) + (j + 1) * stride[1] + (k + 1) * stride[2]

  // Outward surface normal = negative density gradient.
  const gradient = (fieldIndex, out) => {
    out[0] = field[fieldIndex - stride[0]] - field[fieldIndex + stride[0]]
    out[1] = field[fieldIndex - stride[1]] - field[fieldIndex + stride[1]]
    out[2] = field[fieldIndex - stride[2]] - field[fieldIndex + stride[2]]
  }

  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        let cubeIndex = 0
        for (let c = 0; c < 8; c += 1) {
          const corner = CORNERS[c]
          const fieldIndex = index(i + corner[0], j + corner[1], k + corner[2])
          cornerIndex[c] = fieldIndex
          cornerValues[c] = field[fieldIndex]
          if (cornerValues[c] < isovalue) cubeIndex |= 1 << c
        }

        const bits = edgeTable[cubeIndex]
        if (bits === 0) continue

        for (let e = 0; e < 12; e += 1) {
          if ((bits & (1 << e)) === 0) continue
          const [a, b] = EDGES[e]
          const va = cornerValues[a]
          const vb = cornerValues[b]
          const t = Math.abs(vb - va) < 1e-6 ? 0.5 : (isovalue - va) / (vb - va)
          const ca = CORNERS[a]
          const cb = CORNERS[b]
          edgePoints[e * 3] = origin[0] + (i + ca[0] + (cb[0] - ca[0]) * t) * cellSize
          edgePoints[e * 3 + 1] = origin[1] + (j + ca[1] + (cb[1] - ca[1]) * t) * cellSize
          edgePoints[e * 3 + 2] = origin[2] + (k + ca[2] + (cb[2] - ca[2]) * t) * cellSize

          gradient(cornerIndex[a], gradA)
          gradient(cornerIndex[b], gradB)
          const gx = gradA[0] + (gradB[0] - gradA[0]) * t
          const gy = gradA[1] + (gradB[1] - gradA[1]) * t
          const gz = gradA[2] + (gradB[2] - gradA[2]) * t
          const length = Math.hypot(gx, gy, gz) || 1
          edgeNormals[e * 3] = gx / length
          edgeNormals[e * 3 + 1] = gy / length
          edgeNormals[e * 3 + 2] = gz / length
        }

        const tableOffset = cubeIndex * 16
        for (let t = 0; triTable[tableOffset + t] !== -1; t += 3) {
          // Table order is counter-clockwise seen from the empty side, so
          // front faces point out of the solid.
          for (let v = 0; v < 3; v += 1) {
            const e = triTable[tableOffset + t + v]
            positions.push(edgePoints[e * 3], edgePoints[e * 3 + 1], edgePoints[e * 3 + 2])
            normals.push(edgeNormals[e * 3], edgeNormals[e * 3 + 1], edgeNormals[e * 3 + 2])
          }
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
  }
}
