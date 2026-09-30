import { polygonizeChunk, sampleChunkField } from '../utils/chunkMesher'
import {
  CHUNK_CELLS,
  RESOLUTION_PRESETS,
  colorChunkVertices,
  createWorldBlueprint,
  planChunks,
  sampleRegionDensity,
} from '../utils/giantTrees'

// Generates the giant-tree world off the main thread so sliders stay
// responsive. Chunks are streamed back bottom-to-top in small batches, which
// makes the trees visibly build from the roots up while they generate.

const BATCH_SIZE = 12

self.onmessage = (event) => {
  const { jobId, params } = event.data
  const started = performance.now()
  const cellSize = RESOLUTION_PRESETS[params.resolution]?.cellSize ?? RESOLUTION_PRESETS.medium.cellSize

  const world = createWorldBlueprint(params)
  const plan = planChunks(world, cellSize)

  self.postMessage({
    type: 'plan',
    jobId,
    total: plan.chunks.length,
    trees: world.trees.map((tree) => ({
      height: tree.height,
      radius: tree.radius,
      base: tree.base,
    })),
  })

  let batch = []
  let transfer = []
  let samples = 0
  let meshedChunks = 0
  let surfacelessChunks = 0
  let vertices = 0

  const flush = () => {
    self.postMessage({ type: 'chunks', jobId, chunks: batch }, transfer)
    batch = []
    transfer = []
  }

  plan.chunks.forEach((chunk, index) => {
    const field = sampleChunkField({
      origin: chunk.origin,
      cellSize,
      cells: [CHUNK_CELLS, CHUNK_CELLS, CHUNK_CELLS],
      sample: (x, y, z) => sampleRegionDensity(chunk.region, params, x, y, z),
    })
    samples += field.field.length

    if (field.solid === 0 || field.empty === 0) {
      // Entirely air or entirely buried inside wood: no surface to mesh.
      surfacelessChunks += 1
    } else {
      const mesh = polygonizeChunk({ ...field, origin: chunk.origin, cellSize })
      if (mesh.positions.length > 0) {
        const colors = colorChunkVertices(chunk.region, params, mesh.positions, mesh.normals)
        meshedChunks += 1
        vertices += mesh.positions.length / 3
        batch.push({
          key: chunk.key,
          min: chunk.origin,
          size: CHUNK_CELLS * cellSize,
          positions: mesh.positions,
          normals: mesh.normals,
          natural: colors.natural,
          layers: colors.layers,
        })
        transfer.push(
          mesh.positions.buffer,
          mesh.normals.buffer,
          colors.natural.buffer,
          colors.layers.buffer
        )
      } else {
        surfacelessChunks += 1
      }
    }

    if (batch.length >= BATCH_SIZE || index === plan.chunks.length - 1) {
      flush()
      self.postMessage({ type: 'progress', jobId, completed: index + 1 })
    }
  })

  self.postMessage({
    type: 'done',
    jobId,
    stats: {
      cellSize,
      candidateChunks: plan.candidates,
      culledChunks: plan.culled,
      sampledChunks: plan.chunks.length,
      surfacelessChunks,
      meshedChunks,
      samples,
      vertices,
      triangles: vertices / 3,
      timeMs: performance.now() - started,
    },
  })
}
