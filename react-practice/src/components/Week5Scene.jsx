import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import ScatterLayerPanel from './ScatterLayerPanel'
import Slider from './Slider'
import {
  DEFAULT_LAYER_RULES,
  SCATTER_LAYERS,
  passesRules,
  scatterLayers,
} from '../utils/scatter'
import {
  createInstancedAssetParts,
  createWindmillGeometry,
} from '../utils/scatterAssets'
import { createTerrainFields } from '../utils/terrainFields'

const TERRAIN_SIZE = 40
const SEGMENTS = 200
const BLEND_DEGREES = 4
const BLADE_SPEED = 1.2

const GRASS = new THREE.Color('#5f8a3a')
const ROCK = new THREE.Color('#85837c')
const ALLOWED_TINT = new THREE.Color('#f08a3c')
const BLOCKED_DIM = 0.45
const ALLOWED_MIX = 0.55

const DEFAULT_TERRAIN = {
  seed: 5,
  scale: 0.06,
  height: 6,
  octaves: 5,
  persistence: 0.5,
  lacunarity: 2,
  rockSlope: 30,
  waterLevel: 20,
  showWater: true,
}

const DEFAULT_SCATTER = {
  seed: 7,
  preview: false,
  rules: DEFAULT_LAYER_RULES,
}

function noiseParams(terrain) {
  return {
    type: 'perlin',
    scale: terrain.scale,
    octaves: terrain.octaves,
    persistence: terrain.persistence,
    lacunarity: terrain.lacunarity,
    seed: terrain.seed,
  }
}

export default function Week5Scene() {
  const mountRef = useRef(null)
  const geometryRef = useRef(null)
  const assetMeshesRef = useRef(null)
  const windmillsRef = useRef(null)
  const waterRef = useRef(null)
  const [terrain, setTerrain] = useState(DEFAULT_TERRAIN)
  const [scatter, setScatter] = useState(DEFAULT_SCATTER)
  const [panelTab, setPanelTab] = useState('terrain')
  const [openLayer, setOpenLayer] = useState('pine')

  const setTerrainParam = (key, value) =>
    setTerrain((current) => ({ ...current, [key]: value }))
  const setScatterParam = (key, value) =>
    setScatter((current) => ({ ...current, [key]: value }))
  const setLayerRule = (id, key, value) =>
    setScatter((current) => ({
      ...current,
      rules: {
        ...current.rules,
        [id]: { ...current.rules[id], [key]: value },
      },
    }))
  const resetLayer = (id) =>
    setScatter((current) => ({
      ...current,
      rules: { ...current.rules, [id]: DEFAULT_LAYER_RULES[id] },
    }))

  // Terrain maps (height, slope, cliff and water distance) shared by the
  // mesh, the scatter rules, and the rule preview.
  const fields = useMemo(
    () =>
      createTerrainFields({
        size: TERRAIN_SIZE,
        segments: SEGMENTS,
        height: terrain.height,
        noise: noiseParams(terrain),
        rockSlope: terrain.rockSlope,
        waterLevel: terrain.waterLevel,
        showWater: terrain.showWater,
      }),
    [terrain]
  )

  const placements = useMemo(
    () => scatterLayers({ fields, seed: scatter.seed, rules: scatter.rules }),
    [fields, scatter.seed, scatter.rules]
  )

  // The open layer's rules are tinted on the ground while preview is on.
  const previewRules =
    panelTab === 'scatter' && scatter.preview && openLayer
      ? scatter.rules[openLayer]
      : null

  // Scene setup: camera, lights, shadows, terrain mesh, and asset meshes.
  useEffect(() => {
    const mount = mountRef.current
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0e1014')
    scene.fog = new THREE.Fog('#0e1014', 60, 140)

    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.1,
      300
    )
    camera.position.set(0, 36, 52)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.48
    controls.minDistance = 10
    controls.maxDistance = 120

    // Rotate the plane flat so each vertex's y is its height.
    const geometry = new THREE.PlaneGeometry(
      TERRAIN_SIZE,
      TERRAIN_SIZE,
      SEGMENTS,
      SEGMENTS
    )
    geometry.rotateX(-Math.PI / 2)
    const vertexCount = geometry.attributes.position.count
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3)
    )
    geometryRef.current = geometry

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
    })
    const terrainMesh = new THREE.Mesh(geometry, material)
    terrainMesh.castShadow = true
    terrainMesh.receiveShadow = true
    scene.add(terrainMesh)

    // Flat, slightly see-through water plane; its height follows waterLevel.
    const waterGeometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE)
    waterGeometry.rotateX(-Math.PI / 2)
    const waterMaterial = new THREE.MeshStandardMaterial({
      color: '#3b7fb3',
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.72,
    })
    const water = new THREE.Mesh(waterGeometry, waterMaterial)
    water.receiveShadow = true
    scene.add(water)
    waterRef.current = water

    // One InstancedMesh per asset part; instance colours carry the tint.
    const parts = createInstancedAssetParts()
    const assetMaterials = []
    const assetMeshes = {}
    SCATTER_LAYERS.filter((asset) => parts[asset.id]).forEach((asset) => {
      assetMeshes[asset.id] = parts[asset.id].map((part) => {
        const partMaterial = new THREE.MeshStandardMaterial({
          color: '#ffffff',
          roughness: 0.9,
          flatShading: true,
        })
        assetMaterials.push(partMaterial)
        const mesh = new THREE.InstancedMesh(
          part.geometry,
          partMaterial,
          asset.maxCount
        )
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.count = 0
        mesh.setColorAt(0, new THREE.Color(part.color))
        mesh.userData = { color: new THREE.Color(part.color), shadeRange: part.shadeRange }
        scene.add(mesh)
        return mesh
      })
    })
    assetMeshesRef.current = assetMeshes

    const windmillKit = createWindmillGeometry()
    const windmillLayer = new THREE.Group()
    scene.add(windmillLayer)
    windmillsRef.current = { kit: windmillKit, layer: windmillLayer, rotors: [] }

    scene.add(new THREE.HemisphereLight('#cfe3ff', '#3a3020', 0.7))
    const sun = new THREE.DirectionalLight('#fff1d6', 2)
    sun.position.set(-22, 26, 14)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.05
    Object.assign(sun.shadow.camera, {
      left: -30,
      right: 30,
      top: 30,
      bottom: -30,
      near: 1,
      far: 100,
    })
    scene.add(sun)

    let lastTime = performance.now()
    let frameId
    const animate = () => {
      const now = performance.now()
      const delta = (now - lastTime) / 1000
      lastTime = now
      windmillsRef.current.rotors.forEach((rotor) => {
        rotor.rotation.z += delta * BLADE_SPEED
      })
      controls.update()
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    animate()

    const onResize = () => {
      const width = mount.clientWidth
      const height = mount.clientHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      mount.removeChild(renderer.domElement)
      geometry.dispose()
      material.dispose()
      Object.values(assetMeshes)
        .flat()
        .forEach((mesh) => {
          mesh.geometry.dispose()
          mesh.dispose()
        })
      assetMaterials.forEach((assetMaterial) => assetMaterial.dispose())
      windmillKit.dispose()
      renderer.dispose()
      geometryRef.current = null
      assetMeshesRef.current = null
      windmillsRef.current = null
      waterGeometry.dispose()
      waterMaterial.dispose()
      waterRef.current = null
    }
  }, [])

  // Heights from the terrain maps; color from slope (flat = grass, steep = rock).
  // With the rule preview on, allowed ground is tinted and blocked ground dimmed.
  useEffect(() => {
    const geometry = geometryRef.current
    const water = waterRef.current
    if (!geometry || !water) return

    const positions = geometry.attributes.position
    const colors = geometry.attributes.color
    const half = TERRAIN_SIZE / 2
    const gridIndex = new Int32Array(positions.count)

    for (let index = 0; index < positions.count; index += 1) {
      const column = Math.round((positions.getX(index) + half) / fields.step)
      const row = Math.round((positions.getZ(index) + half) / fields.step)
      gridIndex[index] = row * fields.points + column
      positions.setY(index, fields.heights[gridIndex[index]])
    }
    positions.needsUpdate = true
    geometry.computeVertexNormals()

    const normals = geometry.attributes.normal
    const color = new THREE.Color()
    for (let index = 0; index < positions.count; index += 1) {
      const slope = THREE.MathUtils.radToDeg(
        Math.acos(THREE.MathUtils.clamp(normals.getY(index), -1, 1))
      )
      const rockAmount = THREE.MathUtils.smoothstep(
        slope,
        terrain.rockSlope - BLEND_DEGREES,
        terrain.rockSlope + BLEND_DEGREES
      )
      color.lerpColors(GRASS, ROCK, rockAmount)
      if (previewRules) {
        const sample = fields.sampleAt(gridIndex[index])
        if (passesRules(previewRules, sample, fields)) {
          color.lerp(ALLOWED_TINT, ALLOWED_MIX)
        } else {
          color.multiplyScalar(BLOCKED_DIM)
        }
      }
      colors.setXYZ(index, color.r, color.g, color.b)
    }
    colors.needsUpdate = true
    geometry.computeBoundingSphere()

    water.visible = fields.hasWater
    if (fields.hasWater) water.position.y = fields.waterY
  }, [fields, terrain.rockSlope, previewRules])

  // Write the scatter result into the instanced meshes and windmill groups.
  useEffect(() => {
    const assetMeshes = assetMeshesRef.current
    const windmills = windmillsRef.current
    if (!assetMeshes || !windmills) return

    const up = new THREE.Vector3(0, 1, 0)
    const normal = new THREE.Vector3()
    const tilt = new THREE.Quaternion()
    const spin = new THREE.Quaternion()
    const quaternion = new THREE.Quaternion()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    const matrix = new THREE.Matrix4()
    const color = new THREE.Color()

    Object.entries(assetMeshes).forEach(([id, meshes]) => {
      const items = placements[id]
      meshes.forEach((mesh) => {
        const { color: baseColor, shadeRange } = mesh.userData
        items.forEach((item, index) => {
          normal.fromArray(item.normal)
          tilt.setFromUnitVectors(up, normal)
          spin.setFromAxisAngle(up, item.rotationY)
          quaternion.multiplyQuaternions(tilt, spin)
          position.set(item.x, item.y, item.z)
          scale.fromArray(item.scale)
          matrix.compose(position, quaternion, scale)
          mesh.setMatrixAt(index, matrix)
          color.copy(baseColor).multiplyScalar(1 + (item.shade - 0.5) * shadeRange)
          mesh.setColorAt(index, color)
        })
        mesh.count = items.length
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        mesh.computeBoundingSphere()
      })
    })

    windmills.layer.clear()
    windmills.rotors = placements.windmill.map((item) => {
      const { group, rotor } = windmills.kit.build()
      group.position.set(item.x, item.y, item.z)
      group.rotation.y = item.rotationY
      group.scale.fromArray(item.scale)
      rotor.rotation.z = item.shade * Math.PI
      windmills.layer.add(group)
      return rotor
    })
  }, [placements])

  const counts = Object.fromEntries(
    Object.entries(placements).map(([id, items]) => [id, items.length])
  )

  return (
    <div className="voxel-workspace">
      <div
        className="scene"
        ref={mountRef}
        aria-label="Noise terrain scattered with trees, bushes, rocks, and windmills"
      />

      <aside className="noise-panel voxel-panel basic-voxel-panel">
        <div className="panel-title">
          <h2>Noise Terrain</h2>
        </div>

        <div className="panel-tabs" role="tablist">
          {['terrain', 'scatter'].map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={panelTab === tab}
              className={panelTab === tab ? 'active' : ''}
              onClick={() => setPanelTab(tab)}
            >
              {tab === 'terrain' ? 'Terrain' : 'Scatter'}
            </button>
          ))}
        </div>

        <div className="panel-actions">
          <button
            type="button"
            className="layer-add"
            onClick={() => {
              setTerrain(DEFAULT_TERRAIN)
              setScatter(DEFAULT_SCATTER)
            }}
          >
            Reset All
          </button>
          <button
            type="button"
            className="layer-add"
            onClick={() => {
              const seed = Math.floor(Math.random() * 1000)
              if (panelTab === 'terrain') setTerrainParam('seed', seed)
              else setScatterParam('seed', seed)
            }}
          >
            Random Seed
          </button>
        </div>

        {panelTab === 'terrain' ? (
          <>
            <p className="section-note">
              Flat ground is grass; steep slopes become rock.
            </p>
            <Slider
              label="Seed"
              value={terrain.seed}
              min={0}
              max={999}
              step={1}
              format={(value) => value}
              onChange={(value) => setTerrainParam('seed', value)}
            />
            <Slider
              label="Scale"
              value={terrain.scale}
              min={0.01}
              max={0.2}
              step={0.005}
              format={(value) => value.toFixed(3)}
              onChange={(value) => setTerrainParam('scale', value)}
            />
            <Slider
              label="Height"
              value={terrain.height}
              min={0}
              max={15}
              step={0.1}
              format={(value) => value.toFixed(1)}
              onChange={(value) => setTerrainParam('height', value)}
            />
            <Slider
              label="Octaves"
              value={terrain.octaves}
              min={1}
              max={8}
              step={1}
              format={(value) => value}
              onChange={(value) => setTerrainParam('octaves', value)}
            />
            <Slider
              label="Persistence"
              value={terrain.persistence}
              min={0.1}
              max={0.9}
              step={0.05}
              onChange={(value) => setTerrainParam('persistence', value)}
            />
            <Slider
              label="Lacunarity"
              value={terrain.lacunarity}
              min={1.5}
              max={3.5}
              step={0.1}
              format={(value) => value.toFixed(1)}
              onChange={(value) => setTerrainParam('lacunarity', value)}
            />
            <Slider
              label="Rock slope"
              value={terrain.rockSlope}
              min={0}
              max={60}
              step={1}
              format={(value) => `${value}°`}
              onChange={(value) => setTerrainParam('rockSlope', value)}
            />
            <label className="control control-inline shader-toggle">
              <span>Show water</span>
              <input
                type="checkbox"
                checked={terrain.showWater}
                onChange={(event) => setTerrainParam('showWater', event.target.checked)}
              />
            </label>
            {terrain.showWater && (
              <Slider
                label="Water level"
                value={terrain.waterLevel}
                min={0}
                max={60}
                step={1}
                format={(value) => `${value}%`}
                onChange={(value) => setTerrainParam('waterLevel', value)}
              />
            )}
          </>
        ) : (
          <>
            <p className="section-note">
              Each layer follows its own protocol: surface, slope, height,
              distance from cliffs and water. Layers are placed in order
              windmills → rocks → pines → round trees → bushes, and never
              overlap.
            </p>
            <Slider
              label="Scatter seed"
              value={scatter.seed}
              min={0}
              max={999}
              step={1}
              format={(value) => value}
              onChange={(value) => setScatterParam('seed', value)}
            />
            <label className="control control-inline shader-toggle">
              <span>Preview rules of open layer</span>
              <input
                type="checkbox"
                checked={scatter.preview}
                onChange={(event) => setScatterParam('preview', event.target.checked)}
              />
            </label>
            {scatter.preview && (
              <p className="section-note">
                Orange ground is allowed for the open layer; dark ground is
                blocked by its rules.
              </p>
            )}
            <ScatterLayerPanel
              rules={scatter.rules}
              counts={counts}
              openLayer={openLayer}
              onOpenLayer={setOpenLayer}
              onRuleChange={setLayerRule}
              onResetLayer={resetLayer}
              hasWater={fields.hasWater}
            />
          </>
        )}
      </aside>
    </div>
  )
}
