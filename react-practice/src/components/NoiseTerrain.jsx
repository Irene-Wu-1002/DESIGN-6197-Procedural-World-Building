import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  applySimulationShaders,
  colorForElevation,
  createTerrainPalette,
  hexToRgb,
} from '../utils/heightMaterial'
import { getFunctionLayers, getSimulationLayers } from '../utils/earthLayers'
import { getBlendedNoise } from '../utils/noise'

const GRID_SIZE = 12
const HEIGHT_MULTIPLIER = 2.5
const SAMPLE_SPAN = 512
const SCROLL_SPEED = 90
const OFFSET_REPORT_MS = 80

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

function createGridGeometry(segments) {
  const geometry = new THREE.PlaneGeometry(
    GRID_SIZE,
    GRID_SIZE,
    segments,
    segments
  )
  geometry.rotateX(-Math.PI / 2)
  geometry.setAttribute(
    'color',
    new THREE.BufferAttribute(
      new Float32Array(geometry.attributes.position.count * 3),
      3
    )
  )
  return geometry
}

function rebuildTerrain(
  geometry,
  layers,
  waterLevel,
  offset,
  shaping,
  time = 0
) {
  const positions = geometry.attributes.position
  const colors = geometry.attributes.color
  const palette = createTerrainPalette(layers)
  const functionLayers = getFunctionLayers(layers)
  const simulationLayers = getSimulationLayers(layers)
  const heights = new Float32Array(positions.count)

  for (let index = 0; index < positions.count; index += 1) {
    const sampleX =
      (positions.getX(index) / GRID_SIZE + 0.5) * SAMPLE_SPAN + offset.x
    const sampleY =
      (positions.getZ(index) / GRID_SIZE + 0.5) * SAMPLE_SPAN + offset.y
    const noiseValue = getBlendedNoise(
      sampleX,
      sampleY,
      functionLayers,
      shaping
    )
    const baseHex = colorForElevation(noiseValue, palette, waterLevel)
    const hex = applySimulationShaders(baseHex, noiseValue, simulationLayers, {
      waterLevel,
      time,
    })
    const rgb = hexToRgb(hex)

    heights[index] = noiseValue
    positions.setY(index, noiseValue * HEIGHT_MULTIPLIER)
    colors.setXYZ(index, rgb.r, rgb.g, rgb.b)
  }

  positions.needsUpdate = true
  colors.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return heights
}

export default function NoiseTerrain({
  layers,
  waterLevel = 0.35,
  mapOffset = { x: 0, y: 0 },
  gridSegments = 64,
  shaping = { operation: 'none', strength: 1 },
  showWireframe = true,
  simulationTime = 0,
  onMapOffsetChange,
}) {
  const mountRef = useRef(null)
  const geometryRef = useRef(null)
  const surfaceRef = useRef(null)
  const wireframeRef = useRef(null)
  const heightCacheRef = useRef(null)
  const layersRef = useRef(layers)
  const waterLevelRef = useRef(waterLevel)
  const shapingRef = useRef(shaping)
  const simulationTimeRef = useRef(simulationTime)
  const offsetRef = useRef({ ...mapOffset })
  const keysRef = useRef({
    up: false,
    down: false,
    left: false,
    right: false,
  })
  const onOffsetChangeRef = useRef(onMapOffsetChange)

  useEffect(() => {
    layersRef.current = layers
  }, [layers])

  useEffect(() => {
    waterLevelRef.current = waterLevel
  }, [waterLevel])

  useEffect(() => {
    shapingRef.current = shaping
  }, [shaping])

  useEffect(() => {
    simulationTimeRef.current = simulationTime
  }, [simulationTime])

  useEffect(() => {
    onOffsetChangeRef.current = onMapOffsetChange
  }, [onMapOffsetChange])

  useEffect(() => {
    if (wireframeRef.current) {
      wireframeRef.current.visible = showWireframe
    }
  }, [showWireframe])

  useEffect(() => {
    const keys = keysRef.current
    const moving = keys.up || keys.down || keys.left || keys.right
    if (moving) return

    offsetRef.current = { ...mapOffset }
    const geometry = geometryRef.current
    if (!geometry) return

    heightCacheRef.current = rebuildTerrain(
      geometry,
      layersRef.current,
      waterLevelRef.current,
      offsetRef.current,
      shapingRef.current,
      simulationTimeRef.current
    )
  }, [mapOffset])

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
    camera.position.set(10, 8, 10)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(0, 0, 0)
    controls.minDistance = 5
    controls.maxDistance = 30

    const geometry = createGridGeometry(gridSegments)
    geometryRef.current = geometry

    const surfaceMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.DoubleSide,
    })
    const surface = new THREE.Mesh(geometry, surfaceMaterial)
    scene.add(surface)
    surfaceRef.current = surface

    const wireMaterial = new THREE.MeshBasicMaterial({
      color: '#101318',
      wireframe: true,
      transparent: true,
      opacity: 0.22,
    })
    const wireframe = new THREE.Mesh(geometry, wireMaterial)
    wireframe.position.y = 0.006
    wireframe.visible = true
    scene.add(wireframe)
    wireframeRef.current = wireframe

    scene.add(new THREE.HemisphereLight('#dce9ff', '#1b2028', 1.5))
    const keyLight = new THREE.DirectionalLight('#ffffff', 2.6)
    keyLight.position.set(5, 9, 4)
    scene.add(keyLight)

    heightCacheRef.current = rebuildTerrain(
      geometry,
      layersRef.current,
      waterLevelRef.current,
      offsetRef.current,
      shapingRef.current,
      simulationTimeRef.current
    )
    const setKey = (code, pressed) => {
      if (code === 'KeyW' || code === 'ArrowUp') keysRef.current.up = pressed
      if (code === 'KeyS' || code === 'ArrowDown') keysRef.current.down = pressed
      if (code === 'KeyA' || code === 'ArrowLeft') keysRef.current.left = pressed
      if (code === 'KeyD' || code === 'ArrowRight') {
        keysRef.current.right = pressed
      }
    }

    const onKeyDown = (event) => {
      if (isTypingTarget(event.target)) return
      if (
        [
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
        ].includes(event.code)
      ) {
        event.preventDefault()
        setKey(event.code, true)
      }
    }

    const onKeyUp = (event) => {
      setKey(event.code, false)
    }

    const onBlur = () => {
      keysRef.current = { up: false, down: false, left: false, right: false }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    const clock = new THREE.Clock()
    let frameId
    let lastReport = 0
    let dirty = false
    let wasMoving = false

    const reportOffset = () => {
      lastReport = performance.now()
      onOffsetChangeRef.current?.({ ...offsetRef.current })
    }

    const animate = () => {
      const delta = clock.getDelta()
      const keys = keysRef.current
      const moving = keys.up || keys.down || keys.left || keys.right

      if (moving) {
        if (keys.up) offsetRef.current.y -= SCROLL_SPEED * delta
        if (keys.down) offsetRef.current.y += SCROLL_SPEED * delta
        if (keys.left) offsetRef.current.x -= SCROLL_SPEED * delta
        if (keys.right) offsetRef.current.x += SCROLL_SPEED * delta
        dirty = true
      } else if (wasMoving) {
        reportOffset()
      }
      wasMoving = moving

      if (dirty && geometryRef.current) {
        heightCacheRef.current = rebuildTerrain(
          geometryRef.current,
          layersRef.current,
          waterLevelRef.current,
          offsetRef.current,
          shapingRef.current,
          simulationTimeRef.current
        )
        dirty = false

        const now = performance.now()
        if (now - lastReport > OFFSET_REPORT_MS) {
          reportOffset()
        }
      }

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
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      controls.dispose()
      mount.removeChild(renderer.domElement)
      geometryRef.current?.dispose()
      surfaceMaterial.dispose()
      wireMaterial.dispose()
      renderer.dispose()
      geometryRef.current = null
      surfaceRef.current = null
      wireframeRef.current = null
      heightCacheRef.current = null
    }
    // gridSegments is applied through a dedicated effect after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recreate the mesh when grid resolution changes.
  useEffect(() => {
    const surface = surfaceRef.current
    const wireframe = wireframeRef.current
    if (!surface || !wireframe) return

    const previous = geometryRef.current
    const geometry = createGridGeometry(gridSegments)
    surface.geometry = geometry
    wireframe.geometry = geometry
    geometryRef.current = geometry
    previous?.dispose()

    heightCacheRef.current = rebuildTerrain(
      geometry,
      layersRef.current,
      waterLevelRef.current,
      offsetRef.current,
      shapingRef.current,
      simulationTimeRef.current
    )
  }, [gridSegments])

  // Rebuild heights when layers, shaping, or simulation time change.
  useEffect(() => {
    const geometry = geometryRef.current
    if (!geometry) return
    heightCacheRef.current = rebuildTerrain(
      geometry,
      layers,
      waterLevelRef.current,
      offsetRef.current,
      shaping,
      simulationTime
    )
  }, [layers, shaping, simulationTime, waterLevel])

  return (
    <div
      className="terrain-scene"
      ref={mountRef}
      tabIndex={0}
      aria-label="Infinite map. Use WASD or arrow keys to scroll. Press F to toggle wireframe."
    />
  )
}
