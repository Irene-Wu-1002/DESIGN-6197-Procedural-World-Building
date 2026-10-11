import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import Slider from './Slider'
import { getNoise } from '../utils/noise'

const TERRAIN_SIZE = 40
const SEGMENTS = 200
const BLEND_DEGREES = 4

const GRASS = new THREE.Color('#5f8a3a')
const ROCK = new THREE.Color('#85837c')

const DEFAULT_PARAMS = {
  seed: 5,
  scale: 0.06,
  height: 6,
  octaves: 5,
  persistence: 0.5,
  lacunarity: 2,
  rockSlope: 30,
}

export default function Week5Scene() {
  const mountRef = useRef(null)
  const geometryRef = useRef(null)
  const [params, setParams] = useState(DEFAULT_PARAMS)

  const setParam = (key, value) =>
    setParams((current) => ({ ...current, [key]: value }))

  // Scene setup: camera, lights, shadows, and one flat terrain mesh.
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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
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
    const terrain = new THREE.Mesh(geometry, material)
    terrain.castShadow = true
    terrain.receiveShadow = true
    scene.add(terrain)

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
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      geometryRef.current = null
    }
  }, [])

  // Height from layered Perlin noise; color from slope (flat = grass, steep = rock).
  useEffect(() => {
    const geometry = geometryRef.current
    if (!geometry) return

    const positions = geometry.attributes.position
    const colors = geometry.attributes.color
    const noiseParams = {
      type: 'perlin',
      scale: params.scale,
      octaves: params.octaves,
      persistence: params.persistence,
      lacunarity: params.lacunarity,
      seed: params.seed,
    }

    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index)
      const z = positions.getZ(index)
      positions.setY(index, getNoise(x, z, noiseParams) * params.height)
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
        params.rockSlope - BLEND_DEGREES,
        params.rockSlope + BLEND_DEGREES
      )
      color.lerpColors(GRASS, ROCK, rockAmount)
      colors.setXYZ(index, color.r, color.g, color.b)
    }
    colors.needsUpdate = true
    geometry.computeBoundingSphere()
  }, [params])

  return (
    <div className="voxel-workspace">
      <div
        className="scene"
        ref={mountRef}
        aria-label="Noise terrain with grass on flat ground and rock on steep slopes"
      />

      <aside className="noise-panel voxel-panel basic-voxel-panel">
        <div className="panel-title">
          <h2>Noise Terrain</h2>
        </div>
        <p className="section-note">
          Flat ground is grass; steep slopes become rock.
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

        <Slider
          label="Seed"
          value={params.seed}
          min={0}
          max={999}
          step={1}
          format={(value) => value}
          onChange={(value) => setParam('seed', value)}
        />
        <Slider
          label="Scale"
          value={params.scale}
          min={0.01}
          max={0.2}
          step={0.005}
          format={(value) => value.toFixed(3)}
          onChange={(value) => setParam('scale', value)}
        />
        <Slider
          label="Height"
          value={params.height}
          min={0}
          max={15}
          step={0.1}
          format={(value) => value.toFixed(1)}
          onChange={(value) => setParam('height', value)}
        />
        <Slider
          label="Octaves"
          value={params.octaves}
          min={1}
          max={8}
          step={1}
          format={(value) => value}
          onChange={(value) => setParam('octaves', value)}
        />
        <Slider
          label="Persistence"
          value={params.persistence}
          min={0.1}
          max={0.9}
          step={0.05}
          onChange={(value) => setParam('persistence', value)}
        />
        <Slider
          label="Lacunarity"
          value={params.lacunarity}
          min={1.5}
          max={3.5}
          step={0.1}
          format={(value) => value.toFixed(1)}
          onChange={(value) => setParam('lacunarity', value)}
        />
        <Slider
          label="Rock slope"
          value={params.rockSlope}
          min={0}
          max={60}
          step={1}
          format={(value) => `${value}°`}
          onChange={(value) => setParam('rockSlope', value)}
        />
      </aside>
    </div>
  )
}
