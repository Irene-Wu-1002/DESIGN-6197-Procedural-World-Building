import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { DENSITY_SHAPES, sampleDensity } from '../utils/densityShapes'
import { getNoise } from '../utils/noise'

const BLOCK_COLORS = {
  water: new THREE.Color('#3a7ca5'),
  sand: new THREE.Color('#c2b280'),
  grass: new THREE.Color('#5b8c3e'),
  dirt: new THREE.Color('#7a5c3e'),
  stone: new THREE.Color('#6d6a66'),
  snow: new THREE.Color('#e8eef3'),
  surface: new THREE.Color('#9bb7d4'),
}

function colorForVoxel(worldY, columnHeight, waterLevel) {
  if (worldY < waterLevel) return BLOCK_COLORS.sand
  if (worldY === columnHeight) {
    if (worldY >= waterLevel + 7) return BLOCK_COLORS.snow
    if (worldY >= waterLevel + 5) return BLOCK_COLORS.stone
    if (worldY <= waterLevel) return BLOCK_COLORS.sand
    return BLOCK_COLORS.grass
  }
  if (worldY >= columnHeight - 1) return BLOCK_COLORS.dirt
  return BLOCK_COLORS.stone
}

function colorForDensityVoxel(normalizedY, density) {
  if (density < 0.08) return BLOCK_COLORS.surface
  if (normalizedY > 0.55) return BLOCK_COLORS.snow
  if (normalizedY > 0.2) return BLOCK_COLORS.stone
  if (normalizedY > -0.15) return BLOCK_COLORS.dirt
  return BLOCK_COLORS.grass
}

function buildTerrainVoxels(params) {
  const {
    gridSize,
    maxHeight,
    noiseScale,
    seed,
    waterLevel,
    noiseType,
    octaves,
  } = params

  const positions = []
  const colors = []
  const half = (gridSize - 1) / 2

  for (let x = 0; x < gridSize; x += 1) {
    for (let z = 0; z < gridSize; z += 1) {
      const noiseValue = getNoise(x, z, {
        type: noiseType,
        scale: noiseScale,
        octaves,
        persistence: 0.5,
        lacunarity: 2,
        seed,
      })
      const columnHeight = Math.max(
        0,
        Math.round(((noiseValue + 1) * 0.5) * maxHeight)
      )

      for (let y = 0; y <= columnHeight; y += 1) {
        positions.push(x - half, y, z - half)
        const color = colorForVoxel(y, columnHeight, waterLevel)
        colors.push(color.r, color.g, color.b)
      }

      if (columnHeight < waterLevel) {
        for (let y = columnHeight + 1; y <= waterLevel; y += 1) {
          positions.push(x - half, y, z - half)
          const bed = y === waterLevel ? BLOCK_COLORS.water : BLOCK_COLORS.sand
          colors.push(bed.r, bed.g, bed.b)
        }
      }
    }
  }

  return { positions, colors, count: positions.length / 3 }
}

function buildDensityVoxels(params) {
  const { gridSize, densityShape, densityThreshold } = params
  const positions = []
  const colors = []
  const half = (gridSize - 1) / 2
  const invHalf = half === 0 ? 1 : 1 / half

  for (let x = 0; x < gridSize; x += 1) {
    for (let y = 0; y < gridSize; y += 1) {
      for (let z = 0; z < gridSize; z += 1) {
        const nx = (x - half) * invHalf
        const ny = (y - half) * invHalf
        const nz = (z - half) * invHalf
        const density = sampleDensity(densityShape, nx, ny, nz, params)

        if (density < densityThreshold) continue

        positions.push(x - half, y - half, z - half)
        const color = colorForDensityVoxel(ny, density - densityThreshold)
        colors.push(color.r, color.g, color.b)
      }
    }
  }

  return { positions, colors, count: positions.length / 3 }
}

function buildVoxelTerrain(params) {
  if (params.densityShape === 'terrain') {
    return buildTerrainVoxels(params)
  }
  return buildDensityVoxels(params)
}

export default function Week3Scene() {
  const mountRef = useRef(null)
  const meshRef = useRef(null)
  const sceneApiRef = useRef(null)
  const controlsRef = useRef(null)
  const [params, setParams] = useState({
    densityShape: 'terrain',
    densityThreshold: 0,
    noiseWarp: 0,
    gridSize: 28,
    maxHeight: 10,
    noiseScale: 0.08,
    seed: 42,
    waterLevel: 2,
    noiseType: 'perlin',
    octaves: 4,
  })

  const isTerrain = params.densityShape === 'terrain'

  useEffect(() => {
    const mount = mountRef.current
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0e1014')
    scene.fog = new THREE.Fog('#0e1014', 28, 70)

    const camera = new THREE.PerspectiveCamera(
      50,
      mount.clientWidth / mount.clientHeight,
      0.1,
      200
    )
    camera.position.set(22, 18, 22)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(0, 3, 0)
    controls.minDistance = 8
    controls.maxDistance = 80
    controlsRef.current = controls

    scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.8)
    keyLight.position.set(12, 20, 8)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight('#8eb7ff', 0.55)
    fillLight.position.set(-10, 8, -6)
    scene.add(fillLight)

    const boxGeometry = new THREE.BoxGeometry(0.95, 0.95, 0.95)
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.85,
      metalness: 0.05,
    })

    const mesh = new THREE.InstancedMesh(boxGeometry, material, 1)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(mesh)
    meshRef.current = mesh
    sceneApiRef.current = { scene, boxGeometry, material }

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
      boxGeometry.dispose()
      material.dispose()
      mesh.dispose()
      renderer.dispose()
      meshRef.current = null
      sceneApiRef.current = null
      controlsRef.current = null
    }
  }, [])

  useEffect(() => {
    const api = sceneApiRef.current
    const oldMesh = meshRef.current
    if (!api || !oldMesh) return

    const { positions, colors, count } = buildVoxelTerrain(params)
    const { scene, boxGeometry, material } = api

    scene.remove(oldMesh)
    oldMesh.dispose()

    const mesh = new THREE.InstancedMesh(
      boxGeometry,
      material,
      Math.max(count, 1)
    )
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

    const colorAttribute = new THREE.InstancedBufferAttribute(
      new Float32Array(Math.max(count, 1) * 3),
      3
    )
    mesh.instanceColor = colorAttribute

    const dummy = new THREE.Object3D()
    const color = new THREE.Color()

    for (let index = 0; index < count; index += 1) {
      const i = index * 3
      dummy.position.set(positions[i], positions[i + 1], positions[i + 2])
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
      color.setRGB(colors[i], colors[i + 1], colors[i + 2])
      mesh.setColorAt(index, color)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.count = count

    scene.add(mesh)
    meshRef.current = mesh

    // Center the orbit target for volumetric shapes vs terrain columns.
    if (controlsRef.current) {
      controlsRef.current.target.set(0, isTerrain ? 3 : 0, 0)
    }
  }, [params, isTerrain])

  const updateParam = (key, value) => {
    setParams((current) => {
      const next = { ...current, [key]: value }
      if (key === 'densityShape' && value !== 'terrain' && next.gridSize > 36) {
        next.gridSize = 36
      }
      return next
    })
  }

  return (
    <div className="voxel-workspace">
      <div className="scene" ref={mountRef} />

      <aside className="noise-panel voxel-panel">
        <div className="panel-title">
          <h2>Voxel Terrain</h2>
          <span className="panel-badge">Week 3</span>
        </div>

        <label className="control">
          <span className="control-label">Density shape</span>
          <select
            value={params.densityShape}
            onChange={(event) =>
              updateParam('densityShape', event.target.value)
            }
          >
            {DENSITY_SHAPES.map((shape) => (
              <option key={shape.id} value={shape.id}>
                {shape.label}
              </option>
            ))}
          </select>
        </label>

        <label className="control">
          <span className="control-label">Noise type</span>
          <select
            value={params.noiseType}
            onChange={(event) => updateParam('noiseType', event.target.value)}
          >
            <option value="white">White Noise</option>
            <option value="perlin">Perlin Noise</option>
            <option value="cellular">Cellular Noise</option>
          </select>
        </label>

        <VoxelSlider
          label="Grid size"
          value={params.gridSize}
          min={8}
          max={isTerrain ? 48 : 36}
          step={1}
          onChange={(value) => updateParam('gridSize', value)}
        />

        {!isTerrain && (
          <>
            <VoxelSlider
              label="Density threshold"
              value={params.densityThreshold}
              min={-0.4}
              max={0.45}
              step={0.02}
              displayValue={params.densityThreshold.toFixed(2)}
              onChange={(value) => updateParam('densityThreshold', value)}
            />
            <VoxelSlider
              label="Noise warp"
              value={params.noiseWarp}
              min={0}
              max={1}
              step={0.05}
              displayValue={params.noiseWarp.toFixed(2)}
              onChange={(value) => updateParam('noiseWarp', value)}
            />
          </>
        )}

        {isTerrain && (
          <>
            <VoxelSlider
              label="Max height"
              value={params.maxHeight}
              min={2}
              max={18}
              step={1}
              onChange={(value) => updateParam('maxHeight', value)}
            />
            <VoxelSlider
              label="Water level"
              value={params.waterLevel}
              min={0}
              max={8}
              step={1}
              onChange={(value) => updateParam('waterLevel', value)}
            />
          </>
        )}

        <VoxelSlider
          label="Noise scale"
          value={params.noiseScale}
          min={0.02}
          max={0.2}
          step={0.005}
          displayValue={params.noiseScale.toFixed(3)}
          onChange={(value) => updateParam('noiseScale', value)}
        />
        <VoxelSlider
          label="Octaves"
          value={params.octaves}
          min={1}
          max={6}
          step={1}
          onChange={(value) => updateParam('octaves', value)}
        />
        <VoxelSlider
          label="Seed"
          value={params.seed}
          min={0}
          max={9999}
          step={1}
          onChange={(value) => updateParam('seed', value)}
        />

        <button
          type="button"
          className="seed-button"
          onClick={() =>
            updateParam('seed', Math.floor(Math.random() * 10000))
          }
        >
          Generate new seed
        </button>

        <div className="voxel-legend">
          <span><i style={{ background: '#5b8c3e' }} />Grass</span>
          <span><i style={{ background: '#7a5c3e' }} />Dirt</span>
          <span><i style={{ background: '#6d6a66' }} />Stone</span>
          <span><i style={{ background: '#c2b280' }} />Sand</span>
          <span><i style={{ background: '#3a7ca5' }} />Water</span>
          <span><i style={{ background: '#e8eef3' }} />Snow</span>
        </div>

        <p className="panel-hint">
          Density shapes use signed fields (positive = solid). Raise{' '}
          <code>noise warp</code> to distort the silhouette.
        </p>
      </aside>
    </div>
  )
}

function VoxelSlider({
  label,
  value,
  min,
  max,
  step,
  displayValue = value,
  onChange,
}) {
  return (
    <label className="control">
      <span className="control-header">
        <span className="control-label">{label}</span>
        <span className="control-value">{displayValue}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}
