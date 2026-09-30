import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../lib/firebase'

const WORLDS_COLLECTION = 'worlds'

function serializeWorld(name, params) {
  return {
    schemaVersion: 1,
    name: name.trim() || 'Untitled World',
    seed: params.seed,
    densityShape: params.densityShape,
    voxelResolution: params.resolution,
    noise: {
      enabled: params.useNoise,
      scale: params.noiseScale,
      amplitude: params.noiseAmplitude,
      octaves: params.octaves,
      persistence: params.persistence,
      lacunarity: params.lacunarity,
    },
    densityParameters: {
      terrainHeight: params.terrainHeight,
      groundLevel: params.groundLevel,
      terraceHeight: params.terraceHeight,
      verticalFalloff: params.verticalFalloff,
      islandHeightBand: params.islandHeightBand,
      planetRadius: params.planetRadius,
      strataFrequency: params.strataFrequency,
      strataDistortion: params.strataDistortion,
    },
    chunkSize: params.chunkSize,
    chunking: {
      enabled: params.chunkingEnabled,
      activeChunkRadius: params.activeChunkRadius,
      skipEmptyChunks: params.skipEmptyChunks,
      distanceChunkActivation: params.distanceChunkActivation,
      reduceDistantResolution: params.reduceDistantResolution,
    },
    meshingMethod: params.meshMethod,
    meshing: {
      enabled: params.meshingEnabled,
      isovalue: params.meshIsovalue,
      gridResolution: params.meshGridResolution,
      smoothShading: params.meshSmoothShading,
      wireframe: params.meshWireframe,
      displayMode: params.meshDisplayMode,
    },
    csgEnabled: params.csgEnabled,
    csgOperations: params.csgOperations.map((operation, order) => ({
      order,
      enabled: operation.enabled,
      operation: operation.operation,
      shape: operation.shape,
      positionX: operation.positionX,
      positionY: operation.positionY,
      positionZ: operation.positionZ,
      size: operation.size,
      smoothness: operation.smoothness,
    })),
  }
}

export async function saveWorldConfiguration({ worldId, name, params }) {
  const world = serializeWorld(name, params)

  if (worldId) {
    await updateDoc(doc(db, WORLDS_COLLECTION, worldId), {
      ...world,
      updatedAt: serverTimestamp(),
    })
    return worldId
  }

  const worldRef = await addDoc(collection(db, WORLDS_COLLECTION), {
    ...world,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return worldRef.id
}

export async function listWorldConfigurations() {
  const savedWorldsQuery = query(
    collection(db, WORLDS_COLLECTION),
    orderBy('updatedAt', 'desc'),
  )
  const snapshot = await getDocs(savedWorldsQuery)

  return snapshot.docs.map((worldDoc) => {
    const world = worldDoc.data()
    return {
      id: worldDoc.id,
      name: world.name ?? 'Untitled World',
      updatedAt: world.updatedAt ?? null,
    }
  })
}

export async function loadWorldConfiguration(worldId) {
  const snapshot = await getDoc(doc(db, WORLDS_COLLECTION, worldId))

  if (!snapshot.exists()) return null

  return {
    id: snapshot.id,
    ...snapshot.data(),
  }
}
