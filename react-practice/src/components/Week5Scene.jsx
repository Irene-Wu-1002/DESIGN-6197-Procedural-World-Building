import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import PathsPanel from './PathsPanel'
import ScatterLayerPanel from './ScatterLayerPanel'
import Slider from './Slider'
import WindPanel from './WindPanel'
import {
  createLeafRenderer,
  createPointsRenderer,
  createWindStreaks,
} from '../utils/particleRenderers'
import { createGround } from '../utils/particles'
import { createPathMeshes } from '../utils/pathMeshes'
import { DEFAULT_RIVERS, carveRivers } from '../utils/rivers'
import { DEFAULT_ROADS, buildRoads } from '../utils/roads'
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
import {
  SUN_DIRECTION,
  buildTerrainFields,
  createHeightGrid,
} from '../utils/terrainFields'
import { applySway, createSwayDepthMaterial, createSwayUniforms } from '../utils/treeSway'
import { DEFAULT_WIND, buildWindField, windVector } from '../utils/windField'
import { createWindParticles } from '../utils/windParticles'

const TERRAIN_SIZE = 40
const SEGMENTS = 200
const BLEND_DEGREES = 4
const CAMERA_FOV = 45
// Blade turn rate (rad/s) per m/s of local wind at the hub.
const BLADE_PER_WIND = 0.3
const HUB_HEIGHT = 3.2
// Particles advance in steps of at most MAX_STEP, so slow frames are split
// into several steps instead of slowing the simulation down. Frames longer
// than MAX_FRAME (e.g. after switching browser tabs) are cut short.
const MAX_STEP = 1 / 30
const MAX_FRAME = 0.25
// How stiff each layer's foliage is in the wind (1 = fully flexible).
const SWAY_STIFFNESS = { pine: 0.6, round: 1, bush: 0.5 }
// Sheltered trees sway this much less (at full shelter).
const SHELTER_CALM = 0.7
// Rough canopy size per unit of tree scale, for where leaves start.
const CANOPY = {
  pine: { radius: 0.6, base: 0.6, height: 1.9 },
  round: { radius: 0.75, base: 0.9, height: 1.3 },
}
const COUNT_REFRESH_MS = 500

const GRASS = new THREE.Color('#5f8a3a')
const ROCK = new THREE.Color('#85837c')
const ALLOWED_TINT = new THREE.Color('#f08a3c')
const BLOCKED_DIM = 0.45
const ALLOWED_MIX = 0.55
const MOSS = new THREE.Color('#5c7a3a')
const MOSS_MIX = 0.55

// Data-map previews: [low colour, high colour, 0–1 value from a terrain sample].
const ROAD_PREVIEW_REACH = 6
const MAP_PREVIEWS = {
  moisture: [new THREE.Color('#c9a35f'), new THREE.Color('#1f63b8'), (s) => s.moisture],
  sun: [new THREE.Color('#2b2457'), new THREE.Color('#ffd25a'), (s) => s.sun],
  altitude: [new THREE.Color('#163323'), new THREE.Color('#f2f2ee'), (s) => s.level],
  road: [
    new THREE.Color('#1c2230'),
    new THREE.Color('#f0a040'),
    (s) => 1 - s.roadDistance / ROAD_PREVIEW_REACH,
  ],
}
const MAP_MIX = 0.8
const PREVIEW_NOTES = {
  rules: 'Orange ground is allowed for the open layer; dark ground is blocked by its rules.',
  moisture: 'Tan is dry, blue is wet. Wet ground grows bigger, darker trees and bushes.',
  sun: 'Dark is shaded, yellow faces the sun. Sunny leaves are lighter; shaded damp rock grows moss.',
  altitude: 'Dark is low, white is high. Pines shrink and thin out toward the top.',
  road: `Orange is on or near a road, fading out over ${ROAD_PREVIEW_REACH} m. Each layer's road buffer keeps it clear.`,
  wind: 'Dark is calm, bright is windy (without gusts). Hilltops catch the wind; ridges and forests shelter the ground behind them.',
}

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

const PANEL_TABS = [
  ['terrain', 'Terrain'],
  ['paths', 'Paths'],
  ['scatter', 'Scatter'],
  ['wind', 'Wind'],
]

const DEFAULT_PATHS = {
  rivers: DEFAULT_RIVERS,
  roads: DEFAULT_ROADS,
}

const DEFAULT_SCATTER = {
  seed: 7,
  // off | rules (of the open layer) | moisture | sun | altitude | road | wind
  preview: 'off',
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
  const pathsRef = useRef(null)
  // Latest wind field + settings, read by the animation loop every frame.
  const windRef = useRef(null)
  const particlesRef = useRef(null)
  // Shared shader uniforms for tree sway (created with the scene).
  const swayRef = useRef(null)
  const [terrain, setTerrain] = useState(DEFAULT_TERRAIN)
  const [paths, setPaths] = useState(DEFAULT_PATHS)
  const [scatter, setScatter] = useState(DEFAULT_SCATTER)
  const [wind, setWind] = useState(DEFAULT_WIND)
  const [particleCounts, setParticleCounts] = useState({ leaves: 0, seeds: 0, dust: 0 })
  const [panelTab, setPanelTab] = useState('terrain')
  const [openLayer, setOpenLayer] = useState('pine')

  const setWindParam = (key, value) => setWind((current) => ({ ...current, [key]: value }))
  const setWindGroup = (group, key, value) =>
    setWind((current) => ({ ...current, [group]: { ...current[group], [key]: value } }))

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

  const setPathParam = (group, key, value) =>
    setPaths((current) => ({
      ...current,
      [group]: { ...current[group], [key]: value },
    }))

  // World pipeline. Each step is cached, so e.g. a tree slider only re-runs
  // the last step and never re-routes roads.
  //   1. heights from noise
  //   2. rivers traced and carved
  //   3. terrain maps (water includes rivers)
  //   4. windmills placed
  //   5. roads routed between windmills, ground flattened
  //   6. terrain maps again (adds road distance)
  //   7. everything else scattered; windmills keep their spots
  // Rock slope isn't needed for heights, so it's left out to keep the
  // rivers (and everything after them) cached while it changes.
  const { seed, scale, height, octaves, persistence, lacunarity, waterLevel, showWater } =
    terrain
  const grid = useMemo(
    () =>
      createHeightGrid({
        size: TERRAIN_SIZE,
        segments: SEGMENTS,
        height,
        noise: noiseParams({ seed, scale, octaves, persistence, lacunarity }),
        waterLevel,
        showWater,
      }),
    [seed, scale, height, octaves, persistence, lacunarity, waterLevel, showWater]
  )

  const rivers = useMemo(() => carveRivers(grid, paths.rivers), [grid, paths.rivers])
  const carvedHeights = rivers ? rivers.heights : grid.heights

  const riverFields = useMemo(
    () =>
      buildTerrainFields(grid, {
        heights: carvedHeights,
        rockSlope: terrain.rockSlope,
        rivers,
      }),
    [grid, carvedHeights, terrain.rockSlope, rivers]
  )

  // Only the windmill rules matter here, so other layers' sliders don't
  // re-place windmills (and re-route roads). Windmills are placed facing 0°
  // plus a little jitter; the wind direction turns them when drawn.
  const windmillRules = scatter.rules.windmill
  const windmillSpots = useMemo(
    () =>
      scatterLayers({
        fields: riverFields,
        seed: scatter.seed,
        rules: { windmill: windmillRules },
        only: ['windmill'],
      }).windmill,
    [riverFields, scatter.seed, windmillRules]
  )

  const roads = useMemo(
    () =>
      buildRoads(
        riverFields,
        windmillSpots.map((item) => ({ x: item.x, z: item.z, scale: item.scale[0] })),
        paths.roads,
        carvedHeights
      ),
    [riverFields, windmillSpots, paths.roads, carvedHeights]
  )

  const fields = useMemo(
    () =>
      roads
        ? buildTerrainFields(grid, {
            heights: roads.heights,
            rockSlope: terrain.rockSlope,
            rivers,
            roads,
          })
        : riverFields,
    [grid, roads, terrain.rockSlope, rivers, riverFields]
  )

  const placements = useMemo(
    () =>
      scatterLayers({
        fields,
        seed: scatter.seed,
        rules: scatter.rules,
        fixed: { windmill: windmillSpots },
      }),
    [fields, scatter.seed, scatter.rules, windmillSpots]
  )

  // Wind field: rebuilt only when terrain, trees, or the wind itself change
  // (not when particle amounts or sway are adjusted).
  const { direction, strength, gustiness, turbulence, terrainInfluence } = wind
  const windField = useMemo(
    () =>
      buildWindField(fields, [...placements.pine, ...placements.round], {
        direction,
        strength,
        gustiness,
        turbulence,
        terrainInfluence,
      }),
    [fields, placements, direction, strength, gustiness, turbulence, terrainInfluence]
  )

  // Ground preview (Scatter tab only): the open layer's rules, or a data map.
  const previewing = panelTab === 'scatter' ? scatter.preview : 'off'
  const previewRules =
    previewing === 'rules' && openLayer ? scatter.rules[openLayer] : null
  const previewMap = useMemo(() => {
    if (previewing !== 'wind') return MAP_PREVIEWS[previewing] ?? null
    // Stretch the colours over this map's own calmest → windiest range.
    const [slowest, fastest] = windField.speedRange
    const span = Math.max(fastest - slowest, 0.1)
    return [
      new THREE.Color('#14213d'),
      new THREE.Color('#e8f4ff'),
      (sample, x, z) => (windField.speedAt(x, z) - slowest) / span,
    ]
  }, [previewing, windField])

  // Scene setup: camera, lights, shadows, terrain mesh, and asset meshes.
  useEffect(() => {
    const mount = mountRef.current
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0e1014')
    scene.fog = new THREE.Fog('#0e1014', 60, 140)

    const camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
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

    // River, road, and bridge meshes are rebuilt into this group.
    const pathLayer = new THREE.Group()
    scene.add(pathLayer)
    pathsRef.current = { layer: pathLayer, meshes: null }

    // One InstancedMesh per asset part; instance colours carry the tint.
    const swayUniforms = createSwayUniforms()
    swayRef.current = swayUniforms
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
        // Foliage bends in the wind; its shadow bends with it.
        if (part.role === 'foliage') {
          applySway(partMaterial, swayUniforms)
          part.geometry.setAttribute(
            'aSway',
            new THREE.InstancedBufferAttribute(new Float32Array(asset.maxCount).fill(1), 1)
          )
          mesh.customDepthMaterial = createSwayDepthMaterial(swayUniforms)
          assetMaterials.push(mesh.customDepthMaterial)
        }
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.count = 0
        mesh.setColorAt(0, new THREE.Color(part.color))
        mesh.userData = {
          color: new THREE.Color(part.color),
          shadeRange: part.shadeRange,
          role: part.role,
        }
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
    // Same direction the sun-exposure map uses.
    sun.position.set(...SUN_DIRECTION).multiplyScalar(Math.hypot(-22, 26, 14))
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

    // Wind particles: leaves (instanced), seeds and dust (soft dots), streaks.
    const particles = createWindParticles()
    particlesRef.current = particles
    const leafRenderer = createLeafRenderer(particles.pools.leaves)
    const seedRenderer = createPointsRenderer(particles.pools.seeds)
    const dustRenderer = createPointsRenderer(particles.pools.dust)
    const streaks = createWindStreaks()
    streaks.object.visible = false
    scene.add(leafRenderer.object, seedRenderer.object, dustRenderer.object, streaks.object)
    const pointRenderers = [seedRenderer, dustRenderer]
    const setPointScale = () => {
      const heightPx = mount.clientHeight * renderer.getPixelRatio()
      pointRenderers.forEach((points) => points.setViewport(heightPx, CAMERA_FOV))
    }
    setPointScale()

    const air = { x: 0, y: 0, z: 0, gust: 1, speed: 0 }
    let simulationTime = 0
    let lastTime = performance.now()
    let frameId
    const animate = () => {
      const now = performance.now()
      const delta = Math.min((now - lastTime) / 1000, MAX_FRAME)
      lastTime = now
      const current = windRef.current
      if (current) streaks.object.visible = current.settings.showField
      if (current && current.settings.playing) {
        simulationTime += delta
        const { field, settings, ground } = current
        field.update(simulationTime)
        const steps = Math.ceil(delta / MAX_STEP)
        for (let step = 0; step < steps; step += 1) {
          particles.update(delta / steps, settings)
        }
        leafRenderer.update()
        pointRenderers.forEach((points) => points.update())
        if (settings.showField) streaks.update(delta, field, ground)
        swayUniforms.uTime.value = simulationTime
        // Blades turn with the local wind (gusts included) at hub height.
        windmillsRef.current.rotors.forEach(({ rotor, x, y, z, hub }) => {
          field.sample(x, y + hub, z, air)
          rotor.rotation.z += delta * BLADE_PER_WIND * air.speed
        })
      }
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
      setPointScale()
    }
    window.addEventListener('resize', onResize)

    // Live particle counts for the panel (twice a second, not every frame).
    const countTimer = setInterval(() => {
      const next = {
        leaves: particles.pools.leaves.alive,
        seeds: particles.pools.seeds.alive,
        dust: particles.pools.dust.alive,
      }
      setParticleCounts((previous) =>
        previous.leaves === next.leaves &&
        previous.seeds === next.seeds &&
        previous.dust === next.dust
          ? previous
          : next
      )
    }, COUNT_REFRESH_MS)

    return () => {
      cancelAnimationFrame(frameId)
      clearInterval(countTimer)
      window.removeEventListener('resize', onResize)
      leafRenderer.dispose()
      seedRenderer.dispose()
      dustRenderer.dispose()
      streaks.dispose()
      particlesRef.current = null
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
      pathsRef.current?.meshes?.dispose()
      pathsRef.current = null
      swayRef.current = null
    }
  }, [])

  // Heights from the terrain maps; color from slope (flat = grass, steep = rock).
  // Rule preview: allowed ground tinted, blocked ground dimmed.
  // Map preview: the chosen data map drawn as a two-colour gradient.
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
    const mapColor = new THREE.Color()
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
      } else if (previewMap) {
        const [low, high, valueOf] = previewMap
        const sample = fields.sampleAt(gridIndex[index])
        const value = THREE.MathUtils.clamp(
          valueOf(sample, positions.getX(index), positions.getZ(index)),
          0,
          1
        )
        color.lerp(mapColor.lerpColors(low, high, value), MAP_MIX)
      }
      colors.setXYZ(index, color.r, color.g, color.b)
    }
    colors.needsUpdate = true
    geometry.computeBoundingSphere()

    // The lake plane; rivers have their own ribbons.
    water.visible = fields.hasLake
    if (fields.hasLake) water.position.y = fields.waterY
  }, [fields, terrain.rockSlope, previewRules, previewMap])

  // Rebuild the river, road, and bridge meshes when the paths change.
  useEffect(() => {
    const pathMeshes = pathsRef.current
    if (!pathMeshes) return
    pathMeshes.meshes?.dispose()
    pathMeshes.layer.clear()
    pathMeshes.meshes = createPathMeshes(rivers, roads)
    pathMeshes.layer.add(pathMeshes.meshes.group)
  }, [rivers, roads])

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
        const { color: baseColor, shadeRange, role } = mesh.userData
        items.forEach((item, index) => {
          normal.fromArray(item.normal)
          tilt.setFromUnitVectors(up, normal)
          spin.setFromAxisAngle(up, item.rotationY)
          quaternion.multiplyQuaternions(tilt, spin)
          position.set(item.x, item.y, item.z)
          scale.fromArray(item.scale)
          // Only the canopy gets wider or narrower; trunks keep their width.
          if (role === 'foliage') {
            scale.x *= item.foliageWidth
            scale.z *= item.foliageWidth
          }
          matrix.compose(position, quaternion, scale)
          mesh.setMatrixAt(index, matrix)

          color.copy(baseColor)
          if (role === 'stone') color.lerp(MOSS, item.moss * MOSS_MIX)
          if (role === 'foliage' || role === 'stone') {
            color.offsetHSL(item.color.h, item.color.s, item.color.l)
          }
          color.multiplyScalar(1 + (item.shade - 0.5) * shadeRange)
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
      group.scale.fromArray(item.scale)
      rotor.rotation.z = item.shade * Math.PI
      windmills.layer.add(group)
      return {
        rotor,
        group,
        // Facing jitter from placement; the wind direction is added below.
        jitter: item.rotationY,
        x: item.x,
        y: item.y,
        z: item.z,
        hub: HUB_HEIGHT * item.scale[1],
      }
    })
  }, [placements])

  // Windmills turn to face into the wind (direction = where it comes from).
  useEffect(() => {
    const windmills = windmillsRef.current
    if (!windmills) return
    const facing = (direction * Math.PI) / 180
    windmills.rotors.forEach(({ group, jitter }) => {
      group.rotation.y = facing + jitter
    })
  }, [placements, direction])

  // Hand the latest wind field and settings to the animation loop.
  useEffect(() => {
    windRef.current = { field: windField, settings: wind, ground: createGround(fields) }
  }, [windField, wind, fields])

  // Particle sources: tree canopies (leaves keep their tree's colour),
  // bushes and sunny grass (seeds), and roads (dust).
  useEffect(() => {
    const particles = particlesRef.current
    const assetMeshes = assetMeshesRef.current
    if (!particles || !assetMeshes) return
    const color = new THREE.Color()
    const leafSources = []
    for (const id of ['pine', 'round']) {
      const foliage = assetMeshes[id].find((mesh) => mesh.userData.role === 'foliage')
      const { color: baseColor, shadeRange } = foliage.userData
      const canopy = CANOPY[id]
      for (const item of placements[id]) {
        color
          .copy(baseColor)
          .offsetHSL(item.color.h, item.color.s, item.color.l)
          .multiplyScalar(1 + (item.shade - 0.5) * shadeRange)
        leafSources.push({
          x: item.x,
          y: item.y + canopy.base * item.scale[1],
          z: item.z,
          radius: canopy.radius * item.scale[0] * item.foliageWidth,
          height: canopy.height * item.scale[1],
          color: [color.r, color.g, color.b],
        })
      }
    }
    particles.setEnvironment({
      fields,
      wind: windField,
      leafSources,
      bushes: placements.bush,
      roads,
    })
  }, [fields, windField, placements, roads])

  // Per-tree sway: stiffness by layer, calmer where sheltered.
  useEffect(() => {
    const assetMeshes = assetMeshesRef.current
    if (!assetMeshes) return
    for (const [id, stiffness] of Object.entries(SWAY_STIFFNESS)) {
      const foliage = assetMeshes[id].find((mesh) => mesh.userData.role === 'foliage')
      const attribute = foliage.geometry.attributes.aSway
      placements[id].forEach((item, index) => {
        attribute.setX(index, stiffness * (1 - SHELTER_CALM * windField.shelterAt(item.x, item.z)))
      })
      attribute.needsUpdate = true
    }
  }, [placements, windField])

  // Sway uniforms follow the wind settings.
  useEffect(() => {
    const uniforms = swayRef.current
    if (!uniforms) return
    const [dx, dz] = windVector(direction)
    uniforms.uWindDir.value.set(dx, dz)
    uniforms.uWindStrength.value = wind.sway.on ? strength : 0
    uniforms.uSway.value = wind.sway.strength / 100
    uniforms.uGustiness.value = gustiness / 100
  }, [direction, strength, gustiness, wind.sway])

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
          {PANEL_TABS.map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={panelTab === tab}
              className={panelTab === tab ? 'active' : ''}
              onClick={() => setPanelTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="panel-actions">
          <button
            type="button"
            className="layer-add"
            onClick={() => {
              setTerrain(DEFAULT_TERRAIN)
              setPaths(DEFAULT_PATHS)
              setScatter(DEFAULT_SCATTER)
              setWind(DEFAULT_WIND)
            }}
          >
            Reset All
          </button>
          <button
            type="button"
            className="layer-add"
            onClick={() => {
              const randomSeed = Math.floor(Math.random() * 1000)
              if (panelTab === 'terrain') setTerrainParam('seed', randomSeed)
              else if (panelTab === 'paths') setPathParam('rivers', 'seed', randomSeed)
              // On the Wind tab there's no seed, so pick a new wind direction.
              else if (panelTab === 'wind') setWindParam('direction', randomSeed % 360)
              else setScatterParam('seed', randomSeed)
            }}
          >
            Random Seed
          </button>
        </div>

        {panelTab === 'terrain' && (
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
        )}

        {panelTab === 'paths' && (
          <PathsPanel
            rivers={paths.rivers}
            roads={paths.roads}
            riverCount={rivers?.rivers.length ?? 0}
            roadCount={roads?.roads.length ?? 0}
            bridgeCount={roads?.roads.reduce((sum, road) => sum + road.bridges.length, 0) ?? 0}
            windmillCount={windmillSpots.length}
            onChange={setPathParam}
          />
        )}

        {panelTab === 'scatter' && (
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
            <label className="control">
              <span className="control-label">Preview on ground</span>
              <select
                value={scatter.preview}
                onChange={(event) => setScatterParam('preview', event.target.value)}
              >
                <option value="off">Off</option>
                <option value="rules">Rules of open layer</option>
                <option value="moisture">Moisture map</option>
                <option value="sun">Sun exposure map</option>
                <option value="altitude">Altitude map</option>
                <option value="road">Road distance map</option>
                <option value="wind">Wind speed map</option>
              </select>
            </label>
            {scatter.preview !== 'off' && (
              <p className="section-note">{PREVIEW_NOTES[scatter.preview]}</p>
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

        {panelTab === 'wind' && (
          <WindPanel
            wind={wind}
            counts={particleCounts}
            onChange={setWindParam}
            onGroupChange={setWindGroup}
          />
        )}
      </aside>
    </div>
  )
}
