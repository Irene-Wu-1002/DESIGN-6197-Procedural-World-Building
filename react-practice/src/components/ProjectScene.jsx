import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  CHUNK_CELLS,
  GROUND_CLIP,
  LAYER_COLORS,
  RESOLUTION_PRESETS,
  createDefaultTreeParams,
} from '../utils/giantTrees'
import './ProjectScene.css'

// Semester project progress: three giant trees, roots to canopy, with round
// portals cut through each trunk. Geometry comes from a signed density field
// meshed per chunk with Marching Cubes in a Web Worker (see giantTrees.js).

const FOG_COLOR = '#a7b9ad'
const GROW_DURATION_MS = 5000

function createViewSettings() {
  return {
    colorMode: 'natural',
    heightFog: true,
    fogDensity: 0.55,
    wireframe: false,
    showChunks: false,
  }
}

// Adds low-lying mist to a standard material: fog is thick near the ground
// and thins with height, so each tree layer reads as a different climate.
function applyHeightFog(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogWorldPosition;')
      .replace(
        '#include <fog_vertex>',
        '#include <fog_vertex>\nvFogWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vFogWorldPosition;
uniform float uHeightFogDensity;
uniform float uHeightFogFalloff;`
      )
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
  float distanceFog = smoothstep(fogNear, fogFar, vFogDepth);
  float heightFog = uHeightFogDensity
    * exp(-max(vFogWorldPosition.y, 0.0) / uHeightFogFalloff)
    * smoothstep(0.0, 90.0, vFogDepth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(max(distanceFog, heightFog), 0.0, 1.0));
#endif`
      )
  }
}

function createGround() {
  const geometry = new THREE.CircleGeometry(1400, 160, 0, Math.PI * 2)
  geometry.rotateX(-Math.PI / 2)
  const position = geometry.attributes.position
  const colors = new Float32Array(position.count * 3)
  const moss = new THREE.Color('#3f5a2c')
  const soil = new THREE.Color('#4a3a28')
  const color = new THREE.Color()
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const z = position.getZ(i)
    const pattern =
      Math.sin(x * 0.045) * Math.cos(z * 0.05) * 0.5 +
      Math.sin((x + z) * 0.013) * 0.5
    color.copy(soil).lerp(moss, 0.55 + pattern * 0.35)
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

export default function ProjectScene() {
  const mountRef = useRef(null)
  const sceneApiRef = useRef(null)
  const chunkMeshesRef = useRef([])
  const workerRef = useRef(null)
  const viewRef = useRef(createViewSettings())
  const growRef = useRef({ value: 1, animationStart: null })

  const [params, setParams] = useState(createDefaultTreeParams)
  const [view, setView] = useState(createViewSettings)
  const [growth, setGrowth] = useState(1)
  const [regenerateVersion, setRegenerateVersion] = useState(0)
  const [progress, setProgress] = useState({ completed: 0, total: 0, running: false })
  const [stats, setStats] = useState(null)
  const [treeInfo, setTreeInfo] = useState([])

  // Scene setup (once).
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(FOG_COLOR)
    scene.fog = new THREE.Fog(FOG_COLOR, 180, 620)

    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.5,
      2000
    )
    camera.position.set(150, 42, 132)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.localClippingEnabled = true
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(0, 34, 0)
    controls.minDistance = 12
    controls.maxDistance = 520
    controls.maxPolarAngle = Math.PI * 0.495

    scene.add(new THREE.HemisphereLight('#e4f0ff', '#3b3322', 1.6))
    const sunlight = new THREE.DirectionalLight('#fff1d6', 3)
    sunlight.position.set(110, 170, 70)
    sunlight.castShadow = true
    sunlight.shadow.mapSize.set(2048, 2048)
    sunlight.shadow.camera.left = -130
    sunlight.shadow.camera.right = 130
    sunlight.shadow.camera.top = 130
    sunlight.shadow.camera.bottom = -130
    sunlight.shadow.camera.near = 20
    sunlight.shadow.camera.far = 420
    sunlight.shadow.bias = -0.0006
    sunlight.shadow.normalBias = 0.6
    scene.add(sunlight)

    const fogUniforms = {
      uHeightFogDensity: { value: 0.55 },
      uHeightFogFalloff: { value: 16 },
    }

    const growthPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000)
    const treeMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0,
      clippingPlanes: [growthPlane],
    })
    applyHeightFog(treeMaterial, fogUniforms)

    const groundMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    })
    applyHeightFog(groundMaterial, fogUniforms)
    const ground = new THREE.Mesh(createGround(), groundMaterial)
    ground.receiveShadow = true
    scene.add(ground)

    const chunkGroup = new THREE.Group()
    const boundsGroup = new THREE.Group()
    scene.add(chunkGroup, boundsGroup)
    const boundsMaterial = new THREE.LineBasicMaterial({
      color: '#ffd27a',
      transparent: true,
      opacity: 0.35,
    })

    sceneApiRef.current = {
      scene,
      treeMaterial,
      boundsMaterial,
      chunkGroup,
      boundsGroup,
      fogUniforms,
      growthPlane,
      topY: 90,
    }

    let frameId
    const animate = (time) => {
      const grow = growRef.current
      if (grow.animationStart !== null) {
        if (grow.animationStart === undefined) grow.animationStart = time
        const t = Math.min((time - grow.animationStart) / GROW_DURATION_MS, 1)
        grow.value = 1 - Math.pow(1 - t, 2)
        setGrowth(grow.value)
        if (t >= 1) grow.animationStart = null
      }
      const api = sceneApiRef.current
      growthPlane.constant =
        grow.value >= 1 ? 1000 : GROUND_CLIP + grow.value * (api.topY - GROUND_CLIP)

      controls.update()
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    frameId = requestAnimationFrame(animate)

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
      workerRef.current?.terminate()
      workerRef.current = null
      chunkMeshesRef.current.forEach(({ mesh, box }) => {
        mesh.geometry.dispose()
        box.geometry.dispose()
      })
      chunkMeshesRef.current = []
      ground.geometry.dispose()
      groundMaterial.dispose()
      treeMaterial.dispose()
      boundsMaterial.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      sceneApiRef.current = null
    }
  }, [])

  // Regenerate geometry in a worker whenever a shape parameter changes.
  const geometryKey = JSON.stringify(params)
  useEffect(() => {
    const api = sceneApiRef.current
    if (!api) return undefined

    const timer = setTimeout(() => {
      workerRef.current?.terminate()
      chunkMeshesRef.current.forEach(({ mesh, box }) => {
        api.chunkGroup.remove(mesh)
        api.boundsGroup.remove(box)
        mesh.geometry.dispose()
        box.geometry.dispose()
      })
      chunkMeshesRef.current = []
      setStats(null)

      const worker = new Worker(
        new URL('../workers/giantTreeWorker.js', import.meta.url),
        { type: 'module' }
      )
      workerRef.current = worker
      const jobId = Date.now()

      worker.onmessage = (event) => {
        const message = event.data
        if (message.jobId !== jobId || !sceneApiRef.current) return

        if (message.type === 'plan') {
          setProgress({ completed: 0, total: message.total, running: true })
          setTreeInfo(message.trees)
          const tallest = Math.max(...message.trees.map((tree) => tree.height))
          api.topY = tallest * 1.25
          return
        }

        if (message.type === 'chunks') {
          const currentView = viewRef.current
          message.chunks.forEach((chunk) => {
            const geometry = new THREE.BufferGeometry()
            geometry.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3))
            geometry.setAttribute('normal', new THREE.BufferAttribute(chunk.normals, 3))
            const colors = currentView.colorMode === 'layers' ? chunk.layers : chunk.natural
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
            geometry.userData = { natural: chunk.natural, layers: chunk.layers }
            geometry.computeBoundingSphere()

            const mesh = new THREE.Mesh(geometry, api.treeMaterial)
            mesh.castShadow = true
            mesh.receiveShadow = true
            api.chunkGroup.add(mesh)

            const half = chunk.size / 2
            const box = new THREE.LineSegments(
              new THREE.EdgesGeometry(new THREE.BoxGeometry(chunk.size, chunk.size, chunk.size)),
              api.boundsMaterial
            )
            box.position.set(chunk.min[0] + half, chunk.min[1] + half, chunk.min[2] + half)
            box.visible = currentView.showChunks
            api.boundsGroup.add(box)

            chunkMeshesRef.current.push({ mesh, box })
          })
          return
        }

        if (message.type === 'progress') {
          setProgress((current) => ({ ...current, completed: message.completed }))
          return
        }

        if (message.type === 'done') {
          setStats(message.stats)
          setProgress((current) => ({ ...current, running: false }))
          worker.terminate()
          if (workerRef.current === worker) workerRef.current = null
        }
      }

      worker.postMessage({ jobId, params: JSON.parse(geometryKey) })
    }, 220)

    return () => clearTimeout(timer)
  }, [geometryKey, regenerateVersion])

  // View-only settings: no regeneration needed.
  useEffect(() => {
    viewRef.current = view
    const api = sceneApiRef.current
    if (!api) return

    api.fogUniforms.uHeightFogDensity.value = view.heightFog ? view.fogDensity : 0
    api.scene.fog.near = view.heightFog ? 180 : 5000
    api.scene.fog.far = view.heightFog ? 620 : 6000
    api.treeMaterial.wireframe = view.wireframe
    api.boundsGroup.visible = view.showChunks

    chunkMeshesRef.current.forEach(({ mesh, box }) => {
      box.visible = view.showChunks
      const colors = mesh.geometry.userData[view.colorMode]
      const attribute = mesh.geometry.attributes.color
      if (colors && attribute.array !== colors) {
        mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      }
    })
  }, [view, stats])

  const setParam = (key, value) => setParams((current) => ({ ...current, [key]: value }))
  const setViewSetting = (key, value) => setView((current) => ({ ...current, [key]: value }))

  const setGrowthManually = (value) => {
    growRef.current.animationStart = null
    growRef.current.value = value
    setGrowth(value)
  }

  const playGrowth = () => {
    growRef.current.value = 0
    // undefined = "start on the next animation frame"
    growRef.current.animationStart = undefined
  }

  const randomizeSeed = () => setParam('seed', Math.floor(Math.random() * 10000))
  const resetAll = () => {
    setParams(createDefaultTreeParams())
    setView(createViewSettings())
    setGrowthManually(1)
  }

  const progressPercent = progress.total
    ? Math.round((progress.completed / progress.total) * 100)
    : 0

  const legend = useMemo(() => Object.values(LAYER_COLORS), [])

  return (
    <div className="voxel-workspace project-workspace">
      <div
        className="scene"
        ref={mountRef}
        aria-label="Three procedurally generated giant trees with portals through their trunks"
      />

      {progress.running && (
        <div className="project-progress" role="status">
          <span>Growing trees… {progressPercent}%</span>
          <div className="project-progress-bar">
            <i style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      )}

      <aside className="noise-panel voxel-panel basic-voxel-panel">
        <div className="panel-title">
          <h2>Giant Tree City</h2>
        </div>
        <p className="section-note project-intro">
          Semester project progress: a vertical city grown inside colossal
          trees. Roots, trunk, branches, and canopy are the future urban layers;
          the round portals are the first habitable openings.
        </p>

        <div className="panel-actions">
          <button type="button" className="layer-add" onClick={resetAll}>
            Reset All
          </button>
          <button type="button" className="layer-add" onClick={randomizeSeed}>
            Random Seed
          </button>
          <button
            type="button"
            className="layer-add"
            onClick={() => setRegenerateVersion((version) => version + 1)}
          >
            Regenerate
          </button>
        </div>

        <details className="control-section" open>
          <summary>World</summary>
          <div className="control-section-body">
            <PanelSlider
              label="Seed"
              tooltip="One seed rebuilds the exact same three trees"
              value={params.seed}
              min={0}
              max={9999}
              step={1}
              onChange={(value) => setParam('seed', value)}
            />
            <PanelSlider
              label="Tree spacing"
              value={params.spacing}
              min={0.6}
              max={1.6}
              step={0.05}
              displayValue={params.spacing.toFixed(2)}
              onChange={(value) => setParam('spacing', value)}
            />
            <label className="control">
              <span className="control-label" title="Marching Cubes cell size">
                Resolution
              </span>
              <select
                value={params.resolution}
                onChange={(event) => setParam('resolution', event.target.value)}
              >
                {Object.entries(RESOLUTION_PRESETS).map(([key, preset]) => (
                  <option key={key} value={key}>
                    {preset.label} ({preset.cellSize} m cells)
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>

        <details className="control-section">
          <summary>Tree Structure</summary>
          <div className="control-section-body">
            <PanelSlider
              label="Tree height"
              value={params.treeHeight}
              min={40}
              max={90}
              step={1}
              displayValue={`${params.treeHeight} m`}
              onChange={(value) => setParam('treeHeight', value)}
            />
            <PanelSlider
              label="Trunk radius"
              value={params.trunkRadius}
              min={4}
              max={9}
              step={0.1}
              displayValue={`${params.trunkRadius.toFixed(1)} m`}
              onChange={(value) => setParam('trunkRadius', value)}
            />
            <PanelSlider
              label="Roots"
              tooltip="Roots arch out of the trunk and dive below the ground"
              value={params.rootCount}
              min={3}
              max={12}
              step={1}
              onChange={(value) => setParam('rootCount', value)}
            />
            <PanelSlider
              label="Root spread"
              value={params.rootSpread}
              min={0.5}
              max={1.6}
              step={0.05}
              displayValue={params.rootSpread.toFixed(2)}
              onChange={(value) => setParam('rootSpread', value)}
            />
            <PanelSlider
              label="Branches"
              tooltip="Each branch also grows one fork"
              value={params.branchCount}
              min={2}
              max={9}
              step={1}
              onChange={(value) => setParam('branchCount', value)}
            />
            <PanelSlider
              label="Branch angle"
              value={params.branchAngle}
              min={10}
              max={60}
              step={1}
              displayValue={`${params.branchAngle}°`}
              onChange={(value) => setParam('branchAngle', value)}
            />
            <PanelSlider
              label="Canopy size"
              value={params.canopySize}
              min={0.4}
              max={1.6}
              step={0.05}
              displayValue={params.canopySize.toFixed(2)}
              onChange={(value) => setParam('canopySize', value)}
            />
            <PanelSlider
              label="Bark noise"
              tooltip="3D value-noise displacement: vertical streaks plus broad lumps"
              value={params.barkNoise}
              min={0}
              max={2}
              step={0.05}
              displayValue={params.barkNoise.toFixed(2)}
              onChange={(value) => setParam('barkNoise', value)}
            />
            <PanelSlider
              label="Blend"
              tooltip="Smooth-union radius where roots and branches flare into the trunk"
              value={params.blend}
              min={0.2}
              max={2}
              step={0.05}
              displayValue={params.blend.toFixed(2)}
              onChange={(value) => setParam('blend', value)}
            />
          </div>
        </details>

        <details className="control-section" open>
          <summary>Holes</summary>
          <div className="control-section-body">
            <PanelSlider
              label="Portals per tree"
              tooltip="Round tunnels subtracted from the trunk (CSG difference)"
              value={params.holeCount}
              min={0}
              max={8}
              step={1}
              onChange={(value) => setParam('holeCount', value)}
            />
            <PanelSlider
              label="Portal size"
              tooltip="Portal radius as a fraction of the local trunk radius"
              value={params.holeSize}
              min={0.25}
              max={0.65}
              step={0.01}
              displayValue={`${Math.round(params.holeSize * 100)}%`}
              disabled={params.holeCount === 0}
              onChange={(value) => setParam('holeSize', value)}
            />
            <label
              className={`control control-inline ${params.holeCount === 0 ? 'control-disabled' : ''}`}
            >
              <span
                className="control-label"
                title="Carve an inner shaft so portals open into a hollow interior"
              >
                Hollow core
              </span>
              <input
                type="checkbox"
                checked={params.hollowCore}
                disabled={params.holeCount === 0}
                onChange={(event) => setParam('hollowCore', event.target.checked)}
              />
            </label>
          </div>
        </details>

        <details className="control-section" open>
          <summary>View</summary>
          <div className="control-section-body">
            <label className="control">
              <span className="control-label">Colouring</span>
              <select
                value={view.colorMode}
                onChange={(event) => setViewSetting('colorMode', event.target.value)}
              >
                <option value="natural">Natural (bark, moss, leaves)</option>
                <option value="layers">City layers</option>
              </select>
            </label>
            {view.colorMode === 'layers' && (
              <div className="voxel-legend project-legend">
                {legend.map((layer) => (
                  <span key={layer.label}>
                    <i style={{ background: layer.color }} />
                    {layer.label}
                  </span>
                ))}
              </div>
            )}
            <PanelSlider
              label="Growth"
              tooltip="Clips the trees at a height to show the structure from root to top"
              value={growth}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${Math.round(growth * 100)}%`}
              onChange={setGrowthManually}
            />
            <button type="button" className="layer-add" onClick={playGrowth}>
              Grow From Roots
            </button>
            <label className="control control-inline">
              <span className="control-label">Height fog</span>
              <input
                type="checkbox"
                checked={view.heightFog}
                onChange={(event) => setViewSetting('heightFog', event.target.checked)}
              />
            </label>
            <PanelSlider
              label="Fog density"
              value={view.fogDensity}
              min={0}
              max={1}
              step={0.01}
              displayValue={view.fogDensity.toFixed(2)}
              disabled={!view.heightFog}
              onChange={(value) => setViewSetting('fogDensity', value)}
            />
            <label className="control control-inline">
              <span className="control-label">Wireframe</span>
              <input
                type="checkbox"
                checked={view.wireframe}
                onChange={(event) => setViewSetting('wireframe', event.target.checked)}
              />
            </label>
            <label className="control control-inline">
              <span className="control-label">Show chunk bounds</span>
              <input
                type="checkbox"
                checked={view.showChunks}
                onChange={(event) => setViewSetting('showChunks', event.target.checked)}
              />
            </label>
          </div>
        </details>

        <details className="control-section">
          <summary>Performance</summary>
          <div className="control-section-body performance-stats">
            {stats ? (
              <>
                <span><b>{treeInfo.length}</b> trees</span>
                <span><b>{stats.candidateChunks}</b> chunks in tree bounds</span>
                <span><b>{stats.culledChunks}</b> culled before sampling</span>
                <span><b>{stats.surfacelessChunks}</b> sampled, no surface</span>
                <span><b>{stats.meshedChunks}</b> meshed chunks</span>
                <span><b>{stats.samples.toLocaleString()}</b> density samples</span>
                <span><b>{stats.triangles.toLocaleString()}</b> triangles</span>
                <span><b>{stats.timeMs.toFixed(0)} ms</b> generation (worker)</span>
              </>
            ) : (
              <span>Generating…</span>
            )}
            <p className="section-note">
              Chunks are {CHUNK_CELLS}³ cells. Chunks with no nearby
              primitives are culled before sampling, and chunks are meshed
              bottom to top so the trees build from their roots.
            </p>
          </div>
        </details>
      </aside>
    </div>
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
