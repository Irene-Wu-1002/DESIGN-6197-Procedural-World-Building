import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { DISTRIBUTION_METHODS, distributePoints } from '../utils/distributions'

const FIELD_SIZE = 40
const MAX_POINTS = 2000

const DEFAULT_PARAMS = {
  method: 'poisson',
  count: 400,
  seed: 5,
  jitter: 0.8,
  minDistance: 1.6,
  clusterScale: 4,
}

export default function Week5Scene() {
  const mountRef = useRef(null)
  const meshRef = useRef(null)
  const [params, setParams] = useState(DEFAULT_PARAMS)

  const setParam = (key, value) =>
    setParams((current) => ({ ...current, [key]: value }))

  const points = useMemo(
    () => distributePoints({ ...params, size: FIELD_SIZE }),
    [params]
  )

  const method =
    DISTRIBUTION_METHODS.find((entry) => entry.id === params.method) ??
    DISTRIBUTION_METHODS[0]

  // Scene setup: ground, lights, and one instanced mesh for every point.
  useEffect(() => {
    const mount = mountRef.current
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0e1014')
    scene.fog = new THREE.Fog('#0e1014', 45, 110)

    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.1,
      300
    )
    camera.position.set(0, 38, 42)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.48
    controls.minDistance = 10
    controls.maxDistance = 120

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(FIELD_SIZE, FIELD_SIZE),
      new THREE.MeshStandardMaterial({ color: '#2a3324', roughness: 1 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    const grid = new THREE.GridHelper(FIELD_SIZE, 20, '#3d4a35', '#323d2c')
    grid.position.y = 0.01
    scene.add(grid)

    const treeGeometry = new THREE.ConeGeometry(0.45, 1.6, 7)
    treeGeometry.translate(0, 0.8, 0)
    const treeMaterial = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.8,
      flatShading: true,
    })
    const mesh = new THREE.InstancedMesh(treeGeometry, treeMaterial, MAX_POINTS)
    mesh.castShadow = true
    mesh.count = 0
    scene.add(mesh)
    meshRef.current = mesh

    scene.add(new THREE.HemisphereLight('#cfe3ff', '#2a2418', 0.9))
    const sun = new THREE.DirectionalLight('#fff1d6', 1.6)
    sun.position.set(18, 30, 12)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, {
      left: -26,
      right: 26,
      top: 26,
      bottom: -26,
    })
    scene.add(sun)

    let frameId
    const animate = () => {
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
      ground.geometry.dispose()
      ground.material.dispose()
      grid.geometry.dispose()
      grid.material.dispose()
      treeGeometry.dispose()
      treeMaterial.dispose()
      mesh.dispose()
      renderer.dispose()
      meshRef.current = null
    }
  }, [])

  // Place one tree per point; size and shade vary a little per instance.
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return

    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const position = new THREE.Vector3()
    const color = new THREE.Color()
    const half = FIELD_SIZE / 2
    const visible = Math.min(points.length, MAX_POINTS)

    for (let index = 0; index < visible; index += 1) {
      const point = points[index]
      const variation = Math.abs(Math.sin(index * 12.9898) * 43758.5453) % 1
      const height = 0.7 + variation * 0.7
      position.set(point.x - half, 0, point.y - half)
      scale.set(height * 0.9, height, height * 0.9)
      matrix.compose(position, quaternion, scale)
      mesh.setMatrixAt(index, matrix)
      color.setHSL(0.28 + variation * 0.08, 0.45, 0.32 + variation * 0.12)
      mesh.setColorAt(index, color)
    }

    mesh.count = visible
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [points])

  return (
    <div className="voxel-workspace">
      <div
        className="scene"
        ref={mountRef}
        aria-label="Trees scattered on a square field using the selected distribution"
      />

      <aside className="noise-panel voxel-panel basic-voxel-panel">
        <div className="panel-title">
          <h2>Distributions</h2>
        </div>
        <p className="section-note">
          Four ways to scatter objects across a field. Compare how evenly each
          one covers the ground; this is how trees, homes, and props will be
          placed in the project.
        </p>

        <div className="panel-actions">
          <button
            type="button"
            className="layer-add"
            onClick={() => setParams(DEFAULT_PARAMS)}
          >
            Reset All
          </button>
          <button
            type="button"
            className="layer-add"
            onClick={() => setParam('seed', Math.floor(Math.random() * 1000))}
          >
            Random Seed
          </button>
        </div>

        <label className="control">
          <span className="control-label">Method</span>
          <select
            value={params.method}
            onChange={(event) => setParam('method', event.target.value)}
          >
            {DISTRIBUTION_METHODS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <p className="section-note">{method.note}</p>

        <PanelSlider
          label="Points"
          value={params.count}
          min={10}
          max={MAX_POINTS}
          step={10}
          onChange={(value) => setParam('count', value)}
        />
        <PanelSlider
          label="Seed"
          value={params.seed}
          min={0}
          max={999}
          step={1}
          onChange={(value) => setParam('seed', value)}
        />
        {params.method === 'grid' && (
          <PanelSlider
            label="Jitter"
            value={params.jitter}
            displayValue={params.jitter.toFixed(2)}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => setParam('jitter', value)}
          />
        )}
        {params.method === 'poisson' && (
          <PanelSlider
            label="Min spacing"
            value={params.minDistance}
            displayValue={`${params.minDistance.toFixed(1)} m`}
            min={0.6}
            max={5}
            step={0.1}
            onChange={(value) => setParam('minDistance', value)}
          />
        )}
        {params.method === 'clustered' && (
          <PanelSlider
            label="Cluster count"
            value={params.clusterScale}
            displayValue={params.clusterScale.toFixed(1)}
            min={1}
            max={10}
            step={0.5}
            onChange={(value) => setParam('clusterScale', value)}
          />
        )}

        <p className="section-note">
          Placed {Math.min(points.length, MAX_POINTS)} of {params.count} points
          {points.length < params.count && params.method === 'poisson'
            ? ' (the field is full at this spacing)'
            : ''}
          .
        </p>
      </aside>
    </div>
  )
}

function PanelSlider({ label, value, min, max, step, displayValue = value, onChange }) {
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
