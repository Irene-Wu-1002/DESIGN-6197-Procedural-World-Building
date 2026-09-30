import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js'
import { getNoise } from '../utils/noise'

const MAX_HEIGHT = 13
const WORLD_EXTENT = 17

const RESOLUTION_PRESETS = {
  low: { voxel: 12, mesh: 16 },
  medium: { voxel: 18, mesh: 24 },
  high: { voxel: 100, mesh: 36 },
}

function createCsgOperation(id, overrides = {}) {
  return {
    id,
    enabled: true,
    operation: 'subtraction',
    shape: 'sphere',
    positionX: 0,
    positionY: 3,
    positionZ: 0,
    size: 2.5,
    smoothness: 0,
    ...overrides,
  }
}

const CSG_PRESETS = [
  {
    id: 'caveRoom',
    label: 'Cave Room',
    operations: [
      {
        operation: 'subtraction',
        shape: 'sphere',
        positionY: 3,
        size: 3,
        smoothness: 0.6,
      },
    ],
  },
  {
    id: 'tunnel',
    label: 'Tunnel',
    operations: [-2, 0, 2].map((positionX) => ({
      operation: 'subtraction',
      shape: 'sphere',
      positionX,
      positionY: 2.5,
      size: 1.75,
      smoothness: 0.8,
    })),
  },
  {
    id: 'arch',
    label: 'Arch',
    operations: [
      {
        operation: 'subtraction',
        shape: 'box',
        positionY: 1.25,
        size: 1.5,
        smoothness: 0.2,
      },
      {
        operation: 'subtraction',
        shape: 'sphere',
        positionY: 2.75,
        size: 1.5,
        smoothness: 0.4,
      },
    ],
  },
  {
    id: 'rockAddition',
    label: 'Rock Addition',
    operations: [
      {
        operation: 'union',
        shape: 'sphere',
        positionX: 2,
        positionY: 3,
        size: 2.5,
        smoothness: 0.6,
      },
    ],
  },
]

const MESHING_METHODS = [
  {
    id: 'marchingCubes',
    label: 'Marching Cubes',
    appearance: 'Smooth, rounded surfaces',
    polygonCost: 'Medium to high',
    sharpFeatures: 'Limited; corners tend to round',
    performance: 'Medium',
    implemented: true,
  },
  {
    id: 'surfaceNets',
    label: 'Surface Nets',
    appearance: 'Smooth surfaces with a simpler polygon flow',
    polygonCost: 'Usually lower than Marching Cubes',
    sharpFeatures: 'Limited to moderate',
    performance: 'Fast',
    implemented: false,
  },
  {
    id: 'dualContouring',
    label: 'Dual Contouring',
    appearance: 'Clean surfaces that can retain hard edges',
    polygonCost: 'Medium and often efficient',
    sharpFeatures: 'Strong',
    performance: 'Slower; requires feature solving',
    implemented: false,
  },
]

const DEFAULT_PARAMS = {
  densityShape: 'ground',
  resolutionPreset: 'high',
  terrainHeight: 1,
  groundLevel: 2.5,
  resolution: 100,
  showGrid: true,
  useNoise: true,
  noiseScale: 0.08,
  noiseAmplitude: 1.2,
  octaves: 4,
  persistence: 0.5,
  lacunarity: 2,
  seed: 42,
  terraceHeight: 1,
  verticalFalloff: 1,
  islandHeightBand: 7,
  planetRadius: 4.5,
  strataFrequency: 2.5,
  strataDistortion: 0.6,
  csgEnabled: false,
  csgOperations: [createCsgOperation('csg-1')],
  showCsgGizmo: true,
  chunkingEnabled: false,
  chunkSize: 6,
  activeChunkRadius: 4,
  showChunkBoundaries: true,
  meshMethod: 'marchingCubes',
  meshingEnabled: false,
  meshIsovalue: 0,
  meshGridResolution: 24,
  meshSmoothShading: true,
  meshWireframe: false,
  meshDisplayMode: 'voxels',
  skipEmptyChunks: true,
  regenerateDirtyChunks: false,
  distanceChunkActivation: true,
  reduceDistantResolution: false,
}

function createDefaultParams() {
  return {
    ...DEFAULT_PARAMS,
    csgOperations: DEFAULT_PARAMS.csgOperations.map((operation) => ({
      ...operation,
    })),
  }
}

const DENSITY_SHAPES = [
  { id: 'ground', label: 'Ground Plane' },
  { id: 'fbm3d', label: '3D fBm' },
  { id: 'ridged3d', label: 'Ridged 3D' },
  { id: 'terraced', label: 'Terraced' },
  { id: 'floatingIslands', label: 'Floating Islands' },
  { id: 'planet', label: 'Planet' },
  { id: 'strata', label: 'Strata' },
]

// A small height function used by the 3D density field.
function terrainHeight(x, z, params) {
  const baseHeight =
    params.groundLevel +
    (Math.sin(x * 0.42) * 0.7 +
      Math.cos(z * 0.36) * 0.6 +
      Math.sin((x + z) * 0.22) * 0.35) *
      params.terrainHeight

  if (params.densityShape === 'ground' && !params.useNoise) return baseHeight

  const fbm = getNoise(x, z, {
    type: 'perlin',
    scale: params.noiseScale,
    octaves: params.octaves,
    persistence: params.persistence,
    lacunarity: params.lacunarity,
    seed: params.seed,
  })

  return baseHeight + fbm * params.noiseAmplitude
}

function noiseParams(params, seedOffset = 0) {
  return {
    type: 'perlin',
    scale: params.noiseScale,
    octaves: params.octaves,
    persistence: params.persistence,
    lacunarity: params.lacunarity,
    seed: params.seed + seedOffset,
  }
}

function sampleNoise3D(x, y, z, params) {
  const xy = getNoise(x, y, noiseParams(params))
  const yz = getNoise(y, z, noiseParams(params, 101))
  const zx = getNoise(z, x, noiseParams(params, 211))
  return (xy + yz + zx) / 3
}

function boxBoundary(x, y, z) {
  const halfXZ = WORLD_EXTENT * 0.5 - 0.5
  const centerY = (MAX_HEIGHT - 1) * 0.5
  const halfY = centerY - 0.5
  return Math.min(
    halfXZ - Math.abs(x),
    halfY - Math.abs(y - centerY),
    halfXZ - Math.abs(z)
  )
}

// Positive density is solid; zero or negative density is empty.
function sampleBaseDensity(x, y, z, params) {
  if (params.densityShape === 'ground') {
    return terrainHeight(x, z, params) - y
  }

  if (params.densityShape === 'terraced') {
    const height = terrainHeight(x, z, params)
    const steppedHeight =
      Math.floor(height / params.terraceHeight) * params.terraceHeight
    return steppedHeight - y
  }

  if (params.densityShape === 'fbm3d') {
    return Math.min(sampleNoise3D(x, y, z, params), boxBoundary(x, y, z))
  }

  if (params.densityShape === 'ridged3d') {
    const ridges = 0.08 - Math.abs(sampleNoise3D(x, y, z, params))
    return Math.min(ridges, boxBoundary(x, y, z))
  }

  if (params.densityShape === 'floatingIslands') {
    const noise = getNoise(x, z, noiseParams(params))
    const islandMask = noise + 0.12
    const centerY =
      params.islandHeightBand + noise * params.noiseAmplitude * 0.7
    const vertical =
      1 - Math.abs(y - centerY) * Math.max(params.verticalFalloff, 0.1)
    const edge = WORLD_EXTENT * 0.5 - 0.5 - Math.max(Math.abs(x), Math.abs(z))
    return Math.min(islandMask, vertical, edge)
  }

  if (params.densityShape === 'planet') {
    const centerY = (MAX_HEIGHT - 1) * 0.5
    const distance = Math.hypot(x, y - centerY, z)
    const surfaceNoise =
      sampleNoise3D(x, y - centerY, z, params) * params.noiseAmplitude
    return params.planetRadius + surfaceNoise - distance
  }

  const centerY = (MAX_HEIGHT - 1) * 0.5
  const distortion =
    sampleNoise3D(x, y - centerY, z, params) * params.strataDistortion
  const layers = Math.sin(
    (y - centerY + distortion) * params.strataFrequency
  )
  return Math.min(layers * 0.25 + 0.04, boxBoundary(x, y, z))
}

function sampleCsgDensity(x, y, z, operation) {
  const px = x - operation.positionX
  const py = y - operation.positionY
  const pz = z - operation.positionZ

  if (operation.shape === 'box') {
    return operation.size - Math.max(Math.abs(px), Math.abs(py), Math.abs(pz))
  }

  if (operation.shape === 'capsule') {
    const segmentHalfLength = operation.size * 0.75
    const radius = operation.size * 0.5
    const closestY = Math.max(
      -segmentHalfLength,
      Math.min(segmentHalfLength, py)
    )
    return radius - Math.hypot(px, py - closestY, pz)
  }

  return operation.size - Math.hypot(px, py, pz)
}

function smoothMin(a, b, smoothness) {
  if (smoothness <= 0) return Math.min(a, b)
  const blend = Math.max(
    0,
    Math.min(1, 0.5 + (0.5 * (b - a)) / smoothness)
  )
  return (
    b +
    (a - b) * blend -
    smoothness * blend * (1 - blend)
  )
}

function smoothMax(a, b, smoothness) {
  return -smoothMin(-a, -b, smoothness)
}

function sampleDensity(x, y, z, params) {
  let density = sampleBaseDensity(x, y, z, params)
  if (!params.csgEnabled) return density

  for (const operation of params.csgOperations) {
    if (!operation.enabled) continue
    const csgDensity = sampleCsgDensity(x, y, z, operation)
    if (operation.operation === 'union') {
      density = smoothMax(density, csgDensity, operation.smoothness)
    } else if (operation.operation === 'intersection') {
      density = smoothMin(density, csgDensity, operation.smoothness)
    } else {
      density = smoothMin(density, -csgDensity, operation.smoothness)
    }
  }

  return density
}

function getVoxelGridMetrics(params) {
  const voxelStep = WORLD_EXTENT / (params.resolution - 1)
  const verticalExtent = MAX_HEIGHT - 1
  const verticalResolution =
    Math.floor(verticalExtent / voxelStep) + 1

  return { voxelStep, verticalResolution }
}

function buildVoxelField(params) {
  const voxels = []
  const half = WORLD_EXTENT / 2
  const { voxelStep, verticalResolution } = getVoxelGridMetrics(params)
  const densities = new Float32Array(
    params.resolution * verticalResolution * params.resolution
  )
  const indexOf = (x, y, z) =>
    (y * params.resolution + z) * params.resolution + x

  for (let x = 0; x < params.resolution; x += 1) {
    for (let z = 0; z < params.resolution; z += 1) {
      const worldX = x * voxelStep - half
      const worldZ = z * voxelStep - half

      for (let y = 0; y < verticalResolution; y += 1) {
        const worldY = y * voxelStep
        densities[indexOf(x, y, z)] = sampleDensity(
          worldX,
          worldY,
          worldZ,
          params
        )
      }
    }
  }

  for (let x = 0; x < params.resolution; x += 1) {
    for (let z = 0; z < params.resolution; z += 1) {
      const worldX = x * voxelStep - half
      const worldZ = z * voxelStep - half

      for (let y = 0; y < verticalResolution; y += 1) {
        if (densities[indexOf(x, y, z)] > 0) {
          const neighborIsEmpty = (nx, ny, nz) =>
            nx < 0 ||
            nx >= params.resolution ||
            ny < 0 ||
            ny >= verticalResolution ||
            nz < 0 ||
            nz >= params.resolution ||
            densities[indexOf(nx, ny, nz)] <= 0
          const isSurface =
            neighborIsEmpty(x + 1, y, z) ||
            neighborIsEmpty(x - 1, y, z) ||
            neighborIsEmpty(x, y + 1, z) ||
            neighborIsEmpty(x, y - 1, z) ||
            neighborIsEmpty(x, y, z + 1) ||
            neighborIsEmpty(x, y, z - 1)

          voxels.push({
            x: worldX,
            y: y * voxelStep,
            z: worldZ,
            gridX: x,
            gridY: y,
            gridZ: z,
            isSurface,
          })
        }
      }
    }
  }

  return voxels
}

const DENSITY_PARAM_KEYS = [
  'densityShape',
  'terrainHeight',
  'groundLevel',
  'resolution',
  'useNoise',
  'noiseScale',
  'noiseAmplitude',
  'octaves',
  'persistence',
  'lacunarity',
  'seed',
  'terraceHeight',
  'verticalFalloff',
  'islandHeightBand',
  'planetRadius',
  'strataFrequency',
  'strataDistortion',
  'csgEnabled',
  'csgOperations',
]

function densityCacheKey(params) {
  return JSON.stringify(DENSITY_PARAM_KEYS.map((key) => params[key]))
}

function groupVoxelsIntoChunks(voxels, params) {
  if (!params.chunkingEnabled) {
    return [
      {
        key: 'single-volume',
        voxels,
        startX: 0,
        endX: params.resolution,
        startZ: 0,
        endZ: params.resolution,
        distance: 0,
      },
    ]
  }

  const chunks = new Map()
  const chunkCount = Math.ceil(params.resolution / params.chunkSize)
  const centerChunk = Math.floor(
    ((params.resolution - 1) / 2) / params.chunkSize
  )

  voxels.forEach((voxel) => {
    const chunkX = Math.floor(voxel.gridX / params.chunkSize)
    const chunkZ = Math.floor(voxel.gridZ / params.chunkSize)
    const distance = Math.max(
      Math.abs(chunkX - centerChunk),
      Math.abs(chunkZ - centerChunk)
    )

    if (
      params.distanceChunkActivation &&
      distance > params.activeChunkRadius
    ) {
      return
    }

    const key = `${chunkX}:${chunkZ}`
    if (!chunks.has(key)) {
      chunks.set(key, {
        key,
        voxels: [],
        startX: chunkX * params.chunkSize,
        endX: Math.min((chunkX + 1) * params.chunkSize, params.resolution),
        startZ: chunkZ * params.chunkSize,
        endZ: Math.min((chunkZ + 1) * params.chunkSize, params.resolution),
        distance,
      })
    }
    chunks.get(key).voxels.push(voxel)
  })

  if (params.skipEmptyChunks) return [...chunks.values()]

  // Include empty chunks when requested so their boundaries remain visible.
  for (let chunkX = 0; chunkX < chunkCount; chunkX += 1) {
    for (let chunkZ = 0; chunkZ < chunkCount; chunkZ += 1) {
      const distance = Math.max(
        Math.abs(chunkX - centerChunk),
        Math.abs(chunkZ - centerChunk)
      )
      if (
        params.distanceChunkActivation &&
        distance > params.activeChunkRadius
      ) {
        continue
      }
      const key = `${chunkX}:${chunkZ}`
      if (!chunks.has(key)) {
        chunks.set(key, {
          key,
          voxels: [],
          startX: chunkX * params.chunkSize,
          endX: Math.min((chunkX + 1) * params.chunkSize, params.resolution),
          startZ: chunkZ * params.chunkSize,
          endZ: Math.min((chunkZ + 1) * params.chunkSize, params.resolution),
          distance,
        })
      }
    }
  }

  return [...chunks.values()]
}

function getRenderableChunkVoxels(chunk, params) {
  if (
    !params.reduceDistantResolution ||
    !params.chunkingEnabled ||
    chunk.distance === 0
  ) {
    return chunk.voxels
  }

  const coarseVoxels = new Map()
  chunk.voxels.forEach((voxel) => {
    const key = `${Math.floor(voxel.gridX / 2)}:${Math.floor(
      voxel.gridY / 2
    )}:${Math.floor(voxel.gridZ / 2)}`
    const existing = coarseVoxels.get(key)
    if (existing) {
      existing.xTotal += voxel.x
      existing.yTotal += voxel.y
      existing.zTotal += voxel.z
      existing.count += 1
      existing.isSurface ||= voxel.isSurface
      return
    }
    coarseVoxels.set(key, {
      ...voxel,
      xTotal: voxel.x,
      yTotal: voxel.y,
      zTotal: voxel.z,
      count: 1,
      lodScale: 2,
    })
  })

  return [...coarseVoxels.values()].map((voxel) => ({
    ...voxel,
    x: voxel.xTotal / voxel.count,
    y: voxel.yTotal / voxel.count,
    z: voxel.zTotal / voxel.count,
  }))
}

export default function Week3Scene() {
  const mountRef = useRef(null)
  const sceneApiRef = useRef(null)
  const meshRef = useRef([])
  const gridMeshRef = useRef([])
  const chunkBoundariesRef = useRef([])
  const marchingMeshRef = useRef(null)
  const csgGizmosRef = useRef([])
  const densityCacheRef = useRef({ key: null, voxels: [] })
  const nextCsgIdRef = useRef(2)
  const [params, setParams] = useState(createDefaultParams)
  const [voxelCount, setVoxelCount] = useState(0)
  const [activeChunkCount, setActiveChunkCount] = useState(1)
  const [meshStats, setMeshStats] = useState({
    vertices: 0,
    triangles: 0,
  })
  const [generationTimes, setGenerationTimes] = useState({
    voxel: 0,
    mesh: 0,
  })
  const [optimizationStats, setOptimizationStats] = useState({
    beforeChunks: 1,
    afterChunks: 1,
    beforeInstances: 0,
    afterInstances: 0,
    reusedDensity: false,
  })
  const [regenerationVersion, setRegenerationVersion] = useState(0)

  useEffect(() => {
    const mount = mountRef.current
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0e1014')

    const camera = new THREE.PerspectiveCamera(
      50,
      mount.clientWidth / mount.clientHeight,
      0.1,
      100
    )
    camera.position.set(17, 14, 17)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(0, 2, 0)
    controls.minDistance = 8
    controls.maxDistance = 45

    scene.add(new THREE.AmbientLight('#ffffff', 1.8))
    scene.add(new THREE.HemisphereLight('#dce9ff', '#48515d', 2.2))
    const sunlight = new THREE.DirectionalLight('#ffffff', 2.4)
    sunlight.position.set(8, 14, 6)
    scene.add(sunlight)

    const geometry = new THREE.BoxGeometry(0.94, 0.94, 0.94)
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.9,
      metalness: 0,
      emissive: '#1b2118',
      emissiveIntensity: 0.35,
    })
    const gridMaterial = new THREE.MeshBasicMaterial({
      color: '#172016',
      wireframe: true,
      transparent: true,
      opacity: 0.42,
    })
    sceneApiRef.current = { scene, geometry, material, gridMaterial }

    let frameId
    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    animate()

    const observer = new ResizeObserver(() => {
      const width = mount.clientWidth
      const height = mount.clientHeight
      if (width === 0 || height === 0) return

      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    })
    observer.observe(mount)

    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      controls.dispose()
      mount.removeChild(renderer.domElement)
      meshRef.current.forEach((mesh) => mesh.dispose())
      gridMeshRef.current.forEach((mesh) => mesh.dispose())
      chunkBoundariesRef.current.forEach((boundary) => {
        boundary.geometry.dispose()
        boundary.material.dispose()
      })
      geometry.dispose()
      material.dispose()
      gridMaterial.dispose()
      renderer.dispose()
      meshRef.current = []
      gridMeshRef.current = []
      chunkBoundariesRef.current = []
      marchingMeshRef.current = null
      sceneApiRef.current = null
    }
  }, [])

  useEffect(() => {
    const api = sceneApiRef.current
    if (!api) return

    meshRef.current.forEach((mesh) => {
      api.scene.remove(mesh)
      mesh.dispose()
    })
    gridMeshRef.current.forEach((mesh) => {
      api.scene.remove(mesh)
      mesh.dispose()
    })
    chunkBoundariesRef.current.forEach((boundary) => {
      api.scene.remove(boundary)
      boundary.geometry.dispose()
      boundary.material.dispose()
    })

    const generationStarted = performance.now()
    const cacheKey = densityCacheKey(params)
    const reusedDensity =
      params.regenerateDirtyChunks &&
      densityCacheRef.current.key === cacheKey
    const voxels = reusedDensity
      ? densityCacheRef.current.voxels
      : buildVoxelField(params)
    if (!reusedDensity) {
      densityCacheRef.current = { key: cacheKey, voxels }
    }
    const chunks = groupVoxelsIntoChunks(voxels, params)
    const transform = new THREE.Object3D()
    const grass = new THREE.Color('#6f984f')
    const dirt = new THREE.Color('#76553a')
    const meshes = []
    const gridMeshes = []
    const boundaries = []
    const { voxelStep, verticalResolution } = getVoxelGridMetrics(params)
    const half = WORLD_EXTENT / 2
    let renderedInstanceCount = 0

    chunks.forEach((chunk) => {
      const renderableVoxels = getRenderableChunkVoxels(chunk, params)
      renderedInstanceCount += renderableVoxels.length

      if (renderableVoxels.length > 0) {
        const mesh = new THREE.InstancedMesh(
          api.geometry,
          api.material,
          renderableVoxels.length
        )
        const gridMesh = new THREE.InstancedMesh(
          api.geometry,
          api.gridMaterial,
          renderableVoxels.length
        )

        renderableVoxels.forEach((voxel, index) => {
          transform.position.set(voxel.x, voxel.y, voxel.z)
          const lodScale = voxel.lodScale ?? 1
          transform.scale.set(
            voxelStep * lodScale,
            voxelStep * lodScale,
            voxelStep * lodScale
          )
          transform.updateMatrix()
          mesh.setMatrixAt(index, transform.matrix)
          gridMesh.setMatrixAt(index, transform.matrix)
          mesh.setColorAt(index, voxel.isSurface ? grass : dirt)
        })

        mesh.instanceMatrix.needsUpdate = true
        mesh.instanceColor.needsUpdate = true
        mesh.visible = params.meshDisplayMode !== 'mesh'
        gridMesh.instanceMatrix.needsUpdate = true
        gridMesh.visible = params.showGrid && params.meshDisplayMode !== 'mesh'
        api.scene.add(mesh)
        api.scene.add(gridMesh)
        meshes.push(mesh)
        gridMeshes.push(gridMesh)
      }

      if (
        params.chunkingEnabled &&
        params.showChunkBoundaries &&
        params.meshDisplayMode !== 'mesh'
      ) {
        const width = (chunk.endX - chunk.startX) * voxelStep
        const depth = (chunk.endZ - chunk.startZ) * voxelStep
        const height = verticalResolution * voxelStep
        const boxGeometry = new THREE.BoxGeometry(width, height, depth)
        const boundary = new THREE.LineSegments(
          new THREE.EdgesGeometry(boxGeometry),
          new THREE.LineBasicMaterial({
            color: '#ff9a57',
            transparent: true,
            opacity: 0.72,
          })
        )
        boxGeometry.dispose()
        boundary.position.set(
          ((chunk.startX + chunk.endX - 1) / 2) * voxelStep - half,
          ((verticalResolution - 1) * voxelStep) / 2,
          ((chunk.startZ + chunk.endZ - 1) / 2) * voxelStep - half
        )
        api.scene.add(boundary)
        boundaries.push(boundary)
      }
    })

    meshRef.current = meshes
    gridMeshRef.current = gridMeshes
    chunkBoundariesRef.current = boundaries
    const voxelGenerationTime = performance.now() - generationStarted
    requestAnimationFrame(() => {
      setGenerationTimes((current) => ({
        ...current,
        voxel: voxelGenerationTime,
      }))
    })
    setVoxelCount(renderedInstanceCount)
    setActiveChunkCount(chunks.length)
    const totalChunkCount = params.chunkingEnabled
      ? Math.ceil(params.resolution / params.chunkSize) ** 2
      : 1
    setOptimizationStats({
      beforeChunks: totalChunkCount,
      afterChunks: chunks.length,
      beforeInstances: voxels.length,
      afterInstances: renderedInstanceCount,
      reusedDensity,
    })
  }, [params, regenerationVersion])

  useEffect(() => {
    const api = sceneApiRef.current
    if (!api) return undefined

    if (marchingMeshRef.current) {
      api.scene.remove(marchingMeshRef.current)
      marchingMeshRef.current.geometry.dispose()
      marchingMeshRef.current.material.dispose()
      marchingMeshRef.current = null
    }

    if (
      !params.meshingEnabled ||
      params.meshMethod !== 'marchingCubes'
    ) {
      requestAnimationFrame(() => {
        setGenerationTimes((current) => ({ ...current, mesh: 0 }))
      })
      return undefined
    }

    const generationStarted = performance.now()
    const material = new THREE.MeshStandardMaterial({
      color: '#8fcf72',
      roughness: 0.78,
      metalness: 0,
      flatShading: !params.meshSmoothShading,
      wireframe: params.meshWireframe,
      transparent: params.meshDisplayMode === 'both' && !params.meshWireframe,
      opacity: params.meshDisplayMode === 'both' ? 0.74 : 1,
      depthWrite: params.meshDisplayMode !== 'both',
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
    const marching = new MarchingCubes(
      params.meshGridResolution,
      material,
      false,
      false,
      100000
    )
    const gridSize = params.meshGridResolution
    const horizontalExtent = WORLD_EXTENT
    const verticalExtent = MAX_HEIGHT - 1

    for (let z = 0; z < gridSize; z += 1) {
      const worldZ = (z / (gridSize - 1) - 0.5) * horizontalExtent
      for (let y = 0; y < gridSize; y += 1) {
        const worldY = (y / (gridSize - 1)) * verticalExtent
        for (let x = 0; x < gridSize; x += 1) {
          const worldX = (x / (gridSize - 1) - 0.5) * horizontalExtent
          marching.setCell(x, y, z, sampleDensity(worldX, worldY, worldZ, params))
        }
      }
    }

    marching.isolation = params.meshIsovalue
    marching.update()
    marching.scale.set(
      horizontalExtent / 2,
      verticalExtent / 2,
      horizontalExtent / 2
    )
    marching.position.y = verticalExtent / 2
    marching.visible = params.meshDisplayMode !== 'voxels'
    marching.renderOrder = params.meshDisplayMode === 'both' ? 2 : 0
    api.scene.add(marching)
    marchingMeshRef.current = marching
    const meshGenerationTime = performance.now() - generationStarted
    const statsFrame = requestAnimationFrame(() => {
      setMeshStats({
        vertices: marching.count,
        triangles: Math.floor(marching.count / 3),
      })
      setGenerationTimes((current) => ({
        ...current,
        mesh: meshGenerationTime,
      }))
    })

    return () => {
      cancelAnimationFrame(statsFrame)
      api.scene.remove(marching)
      marching.geometry.dispose()
      marching.material.dispose()
      if (marchingMeshRef.current === marching) marchingMeshRef.current = null
    }
  }, [params, regenerationVersion])

  useEffect(() => {
    const api = sceneApiRef.current
    if (!api || !params.csgEnabled || !params.showCsgGizmo) return undefined

    const colors = {
      union: '#79d98a',
      subtraction: '#ff786e',
      intersection: '#b992ff',
    }
    const gizmos = params.csgOperations
      .filter((operation) => operation.enabled)
      .map((operation, index) => {
        let geometry
        if (operation.shape === 'box') {
          geometry = new THREE.BoxGeometry(
            operation.size * 2,
            operation.size * 2,
            operation.size * 2
          )
        } else if (operation.shape === 'capsule') {
          geometry = new THREE.CapsuleGeometry(
            operation.size * 0.5,
            operation.size * 1.5,
            8,
            16
          )
        } else {
          geometry = new THREE.SphereGeometry(operation.size, 24, 16)
        }

        const material = new THREE.MeshBasicMaterial({
          color: colors[operation.operation],
          wireframe: true,
          transparent: true,
          opacity: 0.72,
          depthTest: false,
        })
        const gizmo = new THREE.Mesh(geometry, material)
        gizmo.position.set(
          operation.positionX,
          operation.positionY,
          operation.positionZ
        )
        gizmo.renderOrder = 10 + index
        api.scene.add(gizmo)
        return gizmo
      })

    csgGizmosRef.current = gizmos

    return () => {
      gizmos.forEach((gizmo) => {
        api.scene.remove(gizmo)
        gizmo.geometry.dispose()
        gizmo.material.dispose()
      })
      if (csgGizmosRef.current === gizmos) csgGizmosRef.current = []
    }
  }, [params])

  const updateCsgOperation = (id, key, value) => {
    setParams((current) => ({
      ...current,
      csgOperations: current.csgOperations.map((operation) =>
        operation.id === id ? { ...operation, [key]: value } : operation
      ),
    }))
  }

  const addCsgOperation = () => {
    const id = `csg-${nextCsgIdRef.current}`
    nextCsgIdRef.current += 1
    setParams((current) => ({
      ...current,
      csgEnabled: true,
      csgOperations: [...current.csgOperations, createCsgOperation(id)],
    }))
  }

  const addCsgPreset = (presetId) => {
    const preset = CSG_PRESETS.find((item) => item.id === presetId)
    if (!preset) return

    const operations = preset.operations.map((operation) => {
      const id = `csg-${nextCsgIdRef.current}`
      nextCsgIdRef.current += 1
      return createCsgOperation(id, operation)
    })

    setParams((current) => ({
      ...current,
      csgEnabled: true,
      csgOperations: [...current.csgOperations, ...operations],
    }))
  }

  const clearCsgOperations = () => {
    setParams((current) => ({ ...current, csgOperations: [] }))
  }

  const removeCsgOperation = (id) => {
    setParams((current) => ({
      ...current,
      csgOperations: current.csgOperations.filter(
        (operation) => operation.id !== id
      ),
    }))
  }

  const moveCsgOperation = (index, direction) => {
    setParams((current) => {
      const target = index + direction
      if (target < 0 || target >= current.csgOperations.length) return current
      const operations = [...current.csgOperations]
      ;[operations[index], operations[target]] = [
        operations[target],
        operations[index],
      ]
      return { ...current, csgOperations: operations }
    })
  }

  const resetParams = () => {
    nextCsgIdRef.current = 2
    densityCacheRef.current = { key: null, voxels: [] }
    setParams(createDefaultParams())
    setRegenerationVersion((version) => version + 1)
  }

  const randomizeSeed = () => {
    setParams((current) => ({
      ...current,
      seed: (current.seed + 1 + Math.floor(Math.random() * 9999)) % 10000,
    }))
  }

  const regenerate = () => {
    densityCacheRef.current = { key: null, voxels: [] }
    setRegenerationVersion((version) => version + 1)
  }

  const isHeightField =
    params.densityShape === 'ground' || params.densityShape === 'terraced'
  const usesNoise = params.densityShape !== 'ground' || params.useNoise
  const { verticalResolution } = getVoxelGridMetrics(params)
  const visibleMeshStats = params.meshingEnabled
    && params.meshMethod === 'marchingCubes'
    ? meshStats
    : { vertices: 0, triangles: 0 }
  const selectedMeshingMethod =
    MESHING_METHODS.find((method) => method.id === params.meshMethod) ??
    MESHING_METHODS[0]
  const generationTime =
    generationTimes.voxel +
    (params.meshingEnabled && params.meshMethod === 'marchingCubes'
      ? generationTimes.mesh
      : 0)
  const optimizationReduction =
    optimizationStats.beforeInstances > 0
      ? Math.max(
          0,
          (1 -
            optimizationStats.afterInstances /
              optimizationStats.beforeInstances) *
            100
        )
      : 0
  const showsNoiseAmplitude = [
    'ground',
    'terraced',
    'floatingIslands',
    'planet',
  ].includes(params.densityShape)

  return (
    <div className="voxel-workspace">
      <div
        className="scene"
        ref={mountRef}
        aria-label="Basic voxel terrain generated from a 3D density field"
      />

      <aside className="noise-panel voxel-panel basic-voxel-panel">
        <div className="panel-title">
          <h2>Voxel Controls</h2>
        </div>
        <div className="panel-actions">
          <button
            type="button"
            className="layer-add"
            onClick={resetParams}
            title="Restore every control to its default value"
          >
            Reset All
          </button>
          <button
            type="button"
            className="layer-add"
            onClick={randomizeSeed}
            title="Choose a new random noise seed"
          >
            Randomize Seed
          </button>
          <button
            type="button"
            className="layer-add"
            onClick={regenerate}
            title="Rebuild the voxel field and mesh with current settings"
          >
            Regenerate
          </button>
        </div>

        <details className="control-section" open>
          <summary title="Density describes whether each 3D sample is solid or empty">
            Terrain / Density
          </summary>
          <div className="control-section-body">
            <p className="section-note">
              Positive density is solid; negative density is empty.
            </p>
            <label className="control">
              <span className="control-label">Density Shape</span>
              <select
                value={params.densityShape}
                onChange={(event) =>
                  setParams((current) => ({
                    ...current,
                    densityShape: event.target.value,
                  }))
                }
              >
                {DENSITY_SHAPES.map((shape) => (
                  <option key={shape.id} value={shape.id}>
                    {shape.label}
                  </option>
                ))}
              </select>
            </label>
            <PanelSlider
              label="Voxel resolution"
              value={params.resolution}
              min={10}
              max={100}
              step={2}
              displayValue={`${params.resolution} × ${params.resolution}`}
              onChange={(value) =>
                setParams((current) => ({
                  ...current,
                  resolution: value,
                  resolutionPreset: 'custom',
                }))
              }
            />
            <label className="control control-inline">
              <span className="control-label">Show voxel grid</span>
              <input
                type="checkbox"
                checked={params.showGrid}
                onChange={(event) =>
                  setParams((current) => ({
                    ...current,
                    showGrid: event.target.checked,
                  }))
                }
              />
            </label>

            {isHeightField && (
              <>
                <PanelSlider
                  label="Terrain height"
                  value={params.terrainHeight}
                  min={0}
                  max={2}
                  step={0.1}
                  displayValue={params.terrainHeight.toFixed(1)}
                  onChange={(value) =>
                    setParams((current) => ({
                      ...current,
                      terrainHeight: value,
                    }))
                  }
                />
                <PanelSlider
                  label="Ground level"
                  value={params.groundLevel}
                  min={1}
                  max={4}
                  step={0.25}
                  displayValue={params.groundLevel.toFixed(2)}
                  onChange={(value) =>
                    setParams((current) => ({
                      ...current,
                      groundLevel: value,
                    }))
                  }
                />
              </>
            )}

            {params.densityShape === 'ground' && (
              <label className="control control-inline">
                <span className="control-label">Use Noise</span>
                <input
                  type="checkbox"
                  checked={params.useNoise}
                  onChange={(event) =>
                    setParams((current) => ({
                      ...current,
                      useNoise: event.target.checked,
                    }))
                  }
                />
              </label>
            )}

            {params.densityShape === 'terraced' && (
              <PanelSlider
                label="Terrace height / step size"
                value={params.terraceHeight}
                min={0.25}
                max={2}
                step={0.25}
                displayValue={params.terraceHeight.toFixed(2)}
                onChange={(value) =>
                  setParams((current) => ({
                    ...current,
                    terraceHeight: value,
                  }))
                }
              />
            )}

            {params.densityShape === 'floatingIslands' && (
              <>
                <PanelSlider
                  label="Vertical falloff"
                  value={params.verticalFalloff}
                  min={0.25}
                  max={2}
                  step={0.05}
                  displayValue={params.verticalFalloff.toFixed(2)}
                  onChange={(value) =>
                    setParams((current) => ({
                      ...current,
                      verticalFalloff: value,
                    }))
                  }
                />
                <PanelSlider
                  label="Island height band"
                  value={params.islandHeightBand}
                  min={3}
                  max={10}
                  step={0.5}
                  displayValue={params.islandHeightBand.toFixed(1)}
                  onChange={(value) =>
                    setParams((current) => ({
                      ...current,
                      islandHeightBand: value,
                    }))
                  }
                />
              </>
            )}

            {params.densityShape === 'planet' && (
              <PanelSlider
                label="Radius"
                value={params.planetRadius}
                min={2}
                max={5.5}
                step={0.25}
                displayValue={params.planetRadius.toFixed(2)}
                onChange={(value) =>
                  setParams((current) => ({
                    ...current,
                    planetRadius: value,
                  }))
                }
              />
            )}

            {params.densityShape === 'strata' && (
              <>
                <PanelSlider
                  label="Layer frequency"
                  value={params.strataFrequency}
                  min={0.75}
                  max={5}
                  step={0.25}
                  displayValue={params.strataFrequency.toFixed(2)}
                  onChange={(value) =>
                    setParams((current) => ({
                      ...current,
                      strataFrequency: value,
                    }))
                  }
                />
                <PanelSlider
                  label="Distortion"
                  value={params.strataDistortion}
                  min={0}
                  max={2}
                  step={0.1}
                  displayValue={params.strataDistortion.toFixed(1)}
                  onChange={(value) =>
                    setParams((current) => ({
                      ...current,
                      strataDistortion: value,
                    }))
                  }
                />
              </>
            )}

            {usesNoise && (
              <>
                <div className="settings-heading">
                  <span>
                    {['fbm3d', 'ridged3d', 'planet', 'strata'].includes(
                      params.densityShape
                    )
                      ? '3D fBm noise'
                      : '2D fBm noise'}
                  </span>
                  <small>Layered Perlin noise controls</small>
                </div>
                <PanelSlider
                  label="Noise scale"
                  value={params.noiseScale}
                  min={0.02}
                  max={0.2}
                  step={0.005}
                  displayValue={params.noiseScale.toFixed(3)}
                  onChange={(value) =>
                    setParams((current) => ({ ...current, noiseScale: value }))
                  }
                />
                {showsNoiseAmplitude && (
                  <PanelSlider
                    label="Noise amplitude"
                    value={params.noiseAmplitude}
                    min={0}
                    max={2}
                    step={0.1}
                    displayValue={params.noiseAmplitude.toFixed(1)}
                    onChange={(value) =>
                      setParams((current) => ({
                        ...current,
                        noiseAmplitude: value,
                      }))
                    }
                  />
                )}
                <PanelSlider
                  label="Octaves"
                  tooltip="Number of noise layers combined; more octaves add finer detail"
                  value={params.octaves}
                  min={1}
                  max={6}
                  step={1}
                  onChange={(value) =>
                    setParams((current) => ({ ...current, octaves: value }))
                  }
                />
                <PanelSlider
                  label="Persistence"
                  value={params.persistence}
                  min={0.1}
                  max={0.9}
                  step={0.05}
                  displayValue={params.persistence.toFixed(2)}
                  onChange={(value) =>
                    setParams((current) => ({
                      ...current,
                      persistence: value,
                    }))
                  }
                />
                <PanelSlider
                  label="Lacunarity"
                  value={params.lacunarity}
                  min={1.2}
                  max={4}
                  step={0.1}
                  displayValue={params.lacunarity.toFixed(1)}
                  onChange={(value) =>
                    setParams((current) => ({
                      ...current,
                      lacunarity: value,
                    }))
                  }
                />
                <PanelSlider
                  label="Seed"
                  tooltip="A number that deterministically changes the noise pattern"
                  value={params.seed}
                  min={0}
                  max={9999}
                  step={1}
                  onChange={(value) =>
                    setParams((current) => ({ ...current, seed: value }))
                  }
                />
              </>
            )}
          </div>
        </details>

        <details className="control-section csg-section">
          <summary title="Constructive Solid Geometry combines or cuts density shapes">
            CSG
          </summary>
          <div className="control-section-body">
            <label className="control control-inline">
              <span className="control-label">Enable CSG</span>
              <input
                type="checkbox"
                checked={params.csgEnabled}
                onChange={(event) =>
                  setParams((current) => ({
                    ...current,
                    csgEnabled: event.target.checked,
                  }))
                }
              />
            </label>

            <label className="control">
              <span className="control-label">CSG Preset</span>
              <select
                value=""
                onChange={(event) => addCsgPreset(event.target.value)}
              >
                <option value="" disabled>
                  Select a preset…
                </option>
                {CSG_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="csg-toolbar">
              <button
                type="button"
                className="seed-button"
                onClick={addCsgOperation}
              >
                + Add Operation
              </button>
              <button
                type="button"
                className="seed-button csg-clear-button"
                disabled={params.csgOperations.length === 0}
                onClick={clearCsgOperations}
              >
                Clear CSG
              </button>
            </div>

            {params.csgEnabled && (
              <>
                <label className="control control-inline">
                  <span className="control-label">Show CSG Gizmo</span>
                  <input
                    type="checkbox"
                    checked={params.showCsgGizmo}
                    onChange={(event) =>
                      setParams((current) => ({
                        ...current,
                        showCsgGizmo: event.target.checked,
                      }))
                    }
                  />
                </label>
                <p className="section-note csg-order-note">
                  Operations are applied sequentially from top to bottom.
                  Reordering them may change the final terrain.
                </p>
                {params.csgOperations.length === 0 && (
                  <p className="section-note">
                    No CSG operations. Add one or choose a preset.
                  </p>
                )}
                <div className="csg-operation-list">
                  {params.csgOperations.map((operation, index) => (
                    <CsgOperationCard
                      key={operation.id}
                      operation={operation}
                      index={index}
                      count={params.csgOperations.length}
                      onUpdate={(key, value) =>
                        updateCsgOperation(operation.id, key, value)
                      }
                      onRemove={() => removeCsgOperation(operation.id)}
                      onMove={(direction) =>
                        moveCsgOperation(index, direction)
                      }
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </details>

        <details className="control-section">
          <summary>Chunking</summary>
          <div className="control-section-body">
            <label className="control control-inline">
              <span className="control-label">Enable Chunking</span>
              <input
                type="checkbox"
                checked={params.chunkingEnabled}
                onChange={(event) =>
                  setParams((current) => ({
                    ...current,
                    chunkingEnabled: event.target.checked,
                  }))
                }
              />
            </label>
            <PanelSlider
              label="Chunk size"
              tooltip="Number of voxel columns grouped into one independently rendered region"
              value={params.chunkSize}
              min={3}
              max={12}
              step={1}
              disabled={!params.chunkingEnabled}
              displayValue={`${params.chunkSize} × ${params.chunkSize}`}
              onChange={(value) =>
                setParams((current) => ({ ...current, chunkSize: value }))
              }
            />
            <PanelSlider
              label="Active chunk radius"
              value={params.activeChunkRadius}
              min={0}
              max={4}
              step={1}
              disabled={!params.chunkingEnabled}
              onChange={(value) =>
                setParams((current) => ({
                  ...current,
                  activeChunkRadius: value,
                }))
              }
            />
            <label
              className={`control control-inline ${
                params.chunkingEnabled ? '' : 'control-disabled'
              }`}
            >
              <span className="control-label">Show chunk boundaries</span>
              <input
                type="checkbox"
                checked={params.showChunkBoundaries}
                disabled={!params.chunkingEnabled}
                onChange={(event) =>
                  setParams((current) => ({
                    ...current,
                    showChunkBoundaries: event.target.checked,
                  }))
                }
              />
            </label>
            <div className="performance-stats chunk-stats">
              <span>
                <b>{activeChunkCount}</b>{' '}
                {params.chunkingEnabled ? 'active chunks' : 'voxel volume'}
              </span>
            </div>
            <p className="section-note">
              {params.chunkingEnabled
                ? `The field is split into ${params.chunkSize} × ${params.chunkSize} voxel columns around the world center.`
                : 'Chunking is off, so the complete field renders as one large volume.'}
            </p>
            <div className="control-subsection">
              <div className="control-subsection-title">Optimization</div>
            <label
              className={`control control-inline ${
                params.chunkingEnabled ? '' : 'control-disabled'
              }`}
            >
              <span className="control-label">Skip empty chunks</span>
              <input
                type="checkbox"
                checked={params.skipEmptyChunks}
                disabled={!params.chunkingEnabled}
                onChange={(event) =>
                  setParams((current) => ({
                    ...current,
                    skipEmptyChunks: event.target.checked,
                  }))
                }
              />
            </label>
            <p className="section-note">
              Avoids creating chunk records and boundaries where the density
              field contains no solid voxels.
            </p>
            <label className="control control-inline">
              <span className="control-label">
                Regenerate only dirty chunks
              </span>
              <input
                type="checkbox"
                checked={params.regenerateDirtyChunks}
                onChange={(event) =>
                  setParams((current) => ({
                    ...current,
                    regenerateDirtyChunks: event.target.checked,
                  }))
                }
              />
            </label>
            <p className="section-note">
              Reuses the sampled density field when only display, chunk, or
              meshing settings change.
            </p>
            <label
              className={`control control-inline ${
                params.chunkingEnabled ? '' : 'control-disabled'
              }`}
            >
              <span className="control-label">
                Frustum / distance-based activation
              </span>
              <input
                type="checkbox"
                checked={params.distanceChunkActivation}
                disabled={!params.chunkingEnabled}
                onChange={(event) =>
                  setParams((current) => ({
                    ...current,
                    distanceChunkActivation: event.target.checked,
                  }))
                }
              />
            </label>
            <p className="section-note">
              Uses the active chunk radius around the world center. Camera
              frustum tracking is represented by this distance prototype.
            </p>
            <label
              className={`control control-inline ${
                params.chunkingEnabled ? '' : 'control-disabled'
              }`}
            >
              <span className="control-label">
                Reduced resolution for distant chunks
              </span>
              <input
                type="checkbox"
                checked={params.reduceDistantResolution}
                disabled={!params.chunkingEnabled}
                onChange={(event) =>
                  setParams((current) => ({
                    ...current,
                    reduceDistantResolution: event.target.checked,
                  }))
                }
              />
            </label>
            <p className="section-note">
              Combines distant 2 × 2 voxel columns into coarser render
              instances while preserving the center chunk.
            </p>
            <div className="optimization-comparison">
              <div>
                <span>Chunk workload</span>
                <b>
                  {optimizationStats.beforeChunks} →{' '}
                  {optimizationStats.afterChunks}
                </b>
              </div>
              <div>
                <span>Voxel instances</span>
                <b>
                  {optimizationStats.beforeInstances.toLocaleString()} →{' '}
                  {optimizationStats.afterInstances.toLocaleString()}
                </b>
              </div>
              <div>
                <span>Instance reduction</span>
                <b>{optimizationReduction.toFixed(1)}%</b>
              </div>
              <div>
                <span>Density sampling</span>
                <b>
                  {optimizationStats.reusedDensity ? 'Reused' : 'Rebuilt'}
                </b>
              </div>
              <div>
                <span>Latest generation</span>
                <b>{generationTime.toFixed(1)} ms</b>
              </div>
            </div>
            </div>
          </div>
        </details>

        <details className="control-section">
          <summary>Meshing</summary>
          <div className="control-section-body">
            <label className="control">
              <span
                className="control-label"
                title="Marching Cubes extracts a triangle surface where density crosses the isovalue"
              >
                Meshing Method
              </span>
              <select
                value={params.meshMethod}
                onChange={(event) => {
                  const method = event.target.value
                  const isImplemented = method === 'marchingCubes'
                  setParams((current) => ({
                    ...current,
                    meshMethod: method,
                    meshingEnabled: isImplemented
                      ? current.meshingEnabled
                      : false,
                    meshDisplayMode: isImplemented
                      ? current.meshDisplayMode
                      : 'voxels',
                  }))
                }}
              >
                {MESHING_METHODS.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="meshing-comparison">
              <div className="meshing-comparison-title">
                <b>{selectedMeshingMethod.label}</b>
                <span>
                  {selectedMeshingMethod.implemented
                    ? 'Implemented'
                    : 'Comparison only'}
                </span>
              </div>
              <dl>
                <div>
                  <dt>Expected appearance</dt>
                  <dd>{selectedMeshingMethod.appearance}</dd>
                </div>
                <div>
                  <dt>Polygon cost</dt>
                  <dd>{selectedMeshingMethod.polygonCost}</dd>
                </div>
                <div>
                  <dt>Sharp feature support</dt>
                  <dd>{selectedMeshingMethod.sharpFeatures}</dd>
                </div>
                <div>
                  <dt>Relative performance</dt>
                  <dd>{selectedMeshingMethod.performance}</dd>
                </div>
              </dl>
              {!selectedMeshingMethod.implemented && (
                <p>
                  This method is included for comparison and does not generate
                  geometry yet.
                </p>
              )}
            </div>
            <label className="control control-inline">
              <span className="control-label">Enable Meshing</span>
              <input
                type="checkbox"
                checked={params.meshingEnabled}
                disabled={!selectedMeshingMethod.implemented}
                onChange={(event) => {
                  const enabled = event.target.checked
                  setParams((current) => ({
                    ...current,
                    meshingEnabled: enabled,
                    meshDisplayMode: enabled ? 'both' : 'voxels',
                  }))
                }}
              />
            </label>
            <label className="control">
              <span className="control-label">Display mode</span>
              <select
                value={params.meshDisplayMode}
                disabled={!selectedMeshingMethod.implemented}
                onChange={(event) => {
                  const mode = event.target.value
                  setParams((current) => ({
                    ...current,
                    meshDisplayMode: mode,
                    meshingEnabled:
                      mode === 'voxels' ? current.meshingEnabled : true,
                  }))
                }}
              >
                <option value="voxels">Voxels</option>
                <option value="mesh">Mesh</option>
                <option value="both">Both</option>
              </select>
            </label>
            <PanelSlider
              label="Isovalue"
              tooltip="Density threshold where Marching Cubes creates the surface"
              value={params.meshIsovalue}
              min={-1.5}
              max={1.5}
              step={0.05}
              disabled={!params.meshingEnabled}
              displayValue={params.meshIsovalue.toFixed(2)}
              onChange={(value) =>
                setParams((current) => ({ ...current, meshIsovalue: value }))
              }
            />
            <PanelSlider
              label="Grid resolution"
              value={params.meshGridResolution}
              min={12}
              max={40}
              step={2}
              disabled={!params.meshingEnabled}
              displayValue={`${params.meshGridResolution}³`}
              onChange={(value) =>
                setParams((current) => ({
                  ...current,
                  meshGridResolution: value,
                  resolutionPreset: 'custom',
                }))
              }
            />
            <label
              className={`control control-inline ${
                params.meshingEnabled ? '' : 'control-disabled'
              }`}
            >
              <span className="control-label">Smooth shading</span>
              <input
                type="checkbox"
                checked={params.meshSmoothShading}
                disabled={!params.meshingEnabled}
                onChange={(event) =>
                  setParams((current) => ({
                    ...current,
                    meshSmoothShading: event.target.checked,
                  }))
                }
              />
            </label>
            <label
              className={`control control-inline ${
                params.meshingEnabled ? '' : 'control-disabled'
              }`}
            >
              <span className="control-label">Show wireframe</span>
              <input
                type="checkbox"
                checked={params.meshWireframe}
                disabled={!params.meshingEnabled}
                onChange={(event) =>
                  setParams((current) => ({
                    ...current,
                    meshWireframe: event.target.checked,
                  }))
                }
              />
            </label>
            <div className="performance-stats mesh-stats">
              <span>
                <b>{visibleMeshStats.vertices.toLocaleString()}</b> vertices
              </span>
              <span>
                <b>{visibleMeshStats.triangles.toLocaleString()}</b> triangles
              </span>
            </div>
            <p className="section-note">
              The mesh samples the same density and CSG field as the voxels.
              Use Both to compare block and smooth representations.
            </p>
          </div>
        </details>

        <details className="control-section">
          <summary>Performance</summary>
          <div className="control-section-body performance-stats">
            <label className="control">
              <span className="control-label">Resolution preset</span>
              <select
                value={params.resolutionPreset}
                onChange={(event) => {
                  const presetName = event.target.value
                  const preset = RESOLUTION_PRESETS[presetName]
                  if (!preset) return
                  setParams((current) => ({
                    ...current,
                    resolutionPreset: presetName,
                    resolution: preset.voxel,
                    meshGridResolution: preset.mesh,
                  }))
                }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                {params.resolutionPreset === 'custom' && (
                  <option value="custom">Custom</option>
                )}
              </select>
            </label>
            <span>
              <b>
                {params.resolution} × {verticalResolution} × {params.resolution}
              </b>{' '}
              field
            </span>
            <span><b>{voxelCount.toLocaleString()}</b> voxels</span>
            <span><b>{activeChunkCount}</b> active {activeChunkCount === 1 ? 'chunk' : 'chunks'}</span>
            <span><b>{visibleMeshStats.vertices.toLocaleString()}</b> vertices</span>
            <span><b>{visibleMeshStats.triangles.toLocaleString()}</b> triangles</span>
            <span><b>{generationTime.toFixed(1)} ms</b> generation time</span>
          </div>
        </details>
      </aside>
    </div>
  )
}

function CsgOperationCard({
  operation,
  index,
  count,
  onUpdate,
  onRemove,
  onMove,
}) {
  return (
    <article
      className={`csg-operation-card ${
        operation.enabled ? '' : 'is-disabled'
      }`}
    >
      <div className="csg-operation-header">
        <span>#{index + 1} · {operation.operation}</span>
        <div className="csg-operation-actions">
          <button
            type="button"
            disabled={index === 0}
            aria-label={`Move operation ${index + 1} up`}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            disabled={index === count - 1}
            aria-label={`Move operation ${index + 1} down`}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
          <button
            type="button"
            className="remove"
            aria-label={`Remove operation ${index + 1}`}
            onClick={onRemove}
          >
            ×
          </button>
        </div>
      </div>

      <label className="control control-inline">
        <span className="control-label">Enabled</span>
        <input
          type="checkbox"
          checked={operation.enabled}
          onChange={(event) => onUpdate('enabled', event.target.checked)}
        />
      </label>

      <label className="control">
        <span className="control-label">Operation</span>
        <select
          value={operation.operation}
          onChange={(event) => onUpdate('operation', event.target.value)}
        >
          <option value="union">Union</option>
          <option value="subtraction">Subtraction</option>
          <option value="intersection">Intersection</option>
        </select>
      </label>

      <label className="control">
        <span className="control-label">Shape</span>
        <select
          value={operation.shape}
          onChange={(event) => onUpdate('shape', event.target.value)}
        >
          <option value="sphere">Sphere</option>
          <option value="box">Box</option>
          <option value="capsule">Capsule</option>
        </select>
      </label>

      <PanelSlider
        label="Position X"
        value={operation.positionX}
        min={-8}
        max={8}
        step={0.5}
        displayValue={operation.positionX.toFixed(1)}
        onChange={(value) => onUpdate('positionX', value)}
      />
      <PanelSlider
        label="Position Y"
        value={operation.positionY}
        min={0}
        max={MAX_HEIGHT - 1}
        step={0.5}
        displayValue={operation.positionY.toFixed(1)}
        onChange={(value) => onUpdate('positionY', value)}
      />
      <PanelSlider
        label="Position Z"
        value={operation.positionZ}
        min={-8}
        max={8}
        step={0.5}
        displayValue={operation.positionZ.toFixed(1)}
        onChange={(value) => onUpdate('positionZ', value)}
      />
      <PanelSlider
        label="Size / Radius"
        value={operation.size}
        min={0.5}
        max={6}
        step={0.25}
        displayValue={operation.size.toFixed(2)}
        onChange={(value) => onUpdate('size', value)}
      />
      <PanelSlider
        label="Smoothness"
        value={operation.smoothness}
        min={0}
        max={2}
        step={0.1}
        displayValue={operation.smoothness.toFixed(1)}
        onChange={(value) => onUpdate('smoothness', value)}
      />
    </article>
  )
}

function PanelSlider({
  label,
  tooltip,
  value,
  min,
  max,
  step,
  displayValue = value,
  disabled = false,
  onChange,
}) {
  return (
    <label className={`control ${disabled ? 'control-disabled' : ''}`}>
      <span className="control-header">
        <span className="control-label" title={tooltip}>{label}</span>
        <span className="control-value">{displayValue}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}
