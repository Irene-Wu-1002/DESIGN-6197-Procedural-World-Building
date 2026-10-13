import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import MapPanel from './MapPanel'
import { DEFAULT_GROUND, TILE_SIZE } from './terrain/heightField'
import { createGroundMaterial } from './terrain/groundMaterial'
import { createTileManager } from './terrain/tiles'

/**
 * Project > Map: the endless forest floor at real scale (metres).
 * The camera orbits a focus point on the ground; W A S D slide that point
 * across the world and tiles stream in around it.
 */

const BACKGROUND = '#0e1014'
const DEFAULT_VIEW = { distance: 3, preview: 'off' }
// Start beside the ant hill, which sits at the world origin.
const START = { x: 0.14, z: 0.1 }
const CAMERA_OFFSET = new THREE.Vector3(0, 0.42, 0.5)
// Walking speed of the focus point (m/s); Shift multiplies it.
const WALK_SPEED = 0.15
const RUN_FACTOR = 4
// Sun direction relative to the focus; shadows only cover the area near it.
const SUN_OFFSET = new THREE.Vector3(0.9, 1.1, 0.5)
const SHADOW_REACH = 0.6
const BUILD_BUDGET_MS = 6
const STATUS_REFRESH_MS = 250
const MAX_FRAME = 0.1
const MOVE_KEYS = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right' }

export default function MapScene() {
  const mountRef = useRef(null)
  const tilesRef = useRef(null)
  const grainRef = useRef(null)
  const viewRef = useRef(DEFAULT_VIEW)
  const [ground, setGround] = useState(DEFAULT_GROUND)
  const [view, setView] = useState(DEFAULT_VIEW)
  const [status, setStatus] = useState({
    loaded: 0,
    pending: 0,
    focus: [START.x, START.z],
    ground: 0,
  })

  useEffect(() => {
    const mount = mountRef.current
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(BACKGROUND)
    scene.fog = new THREE.Fog(BACKGROUND, 1, 2)

    // Millimetres to metres in one view: a logarithmic depth buffer keeps
    // near and far surfaces from flickering.
    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    mount.appendChild(renderer.domElement)

    const camera = new THREE.PerspectiveCamera(
      50,
      mount.clientWidth / mount.clientHeight,
      0.002,
      30
    )
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 0.06
    controls.maxDistance = 2.5
    controls.maxPolarAngle = Math.PI * 0.47

    const { material, uniforms } = createGroundMaterial()
    grainRef.current = uniforms
    const tiles = createTileManager(scene, material)
    tilesRef.current = tiles
    tiles.setGround(DEFAULT_GROUND)

    const startY = tiles.heightAt(START.x, START.z)
    controls.target.set(START.x, startY, START.z)
    camera.position.copy(controls.target).add(CAMERA_OFFSET)

    scene.add(new THREE.HemisphereLight('#cfd8e6', '#3a2c20', 0.55))
    const sun = new THREE.DirectionalLight('#ffe2b8', 2.2)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.00005
    sun.shadow.normalBias = 0.0004
    Object.assign(sun.shadow.camera, {
      left: -SHADOW_REACH,
      right: SHADOW_REACH,
      top: SHADOW_REACH,
      bottom: -SHADOW_REACH,
      near: 0.05,
      far: 4,
    })
    scene.add(sun, sun.target)

    // Walking: held keys move the focus point relative to the camera.
    const held = new Set()
    const isTyping = (event) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)
    const onKeyDown = (event) => {
      if (isTyping(event)) return
      if (MOVE_KEYS[event.code]) held.add(MOVE_KEYS[event.code])
      if (event.key === 'Shift') held.add('run')
    }
    const onKeyUp = (event) => {
      if (MOVE_KEYS[event.code]) held.delete(MOVE_KEYS[event.code])
      if (event.key === 'Shift') held.delete('run')
    }
    const onBlur = () => held.clear()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    const forward = new THREE.Vector3()
    const right = new THREE.Vector3()
    const move = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    let lastTime = performance.now()
    let frameId
    const animate = () => {
      const now = performance.now()
      const delta = Math.min((now - lastTime) / 1000, MAX_FRAME)
      lastTime = now

      if (held.size > 0) {
        camera.getWorldDirection(forward)
        forward.y = 0
        forward.normalize()
        right.crossVectors(forward, up)
        move.set(0, 0, 0)
        if (held.has('forward')) move.add(forward)
        if (held.has('back')) move.sub(forward)
        if (held.has('right')) move.add(right)
        if (held.has('left')) move.sub(right)
        if (move.lengthSq() > 0) {
          const speed = WALK_SPEED * (held.has('run') ? RUN_FACTOR : 1)
          move.normalize().multiplyScalar(speed * delta)
          controls.target.add(move)
          camera.position.add(move)
        }
      }
      // Keep the focus on the ground, carrying the camera with it.
      const groundY = tiles.heightAt(controls.target.x, controls.target.z)
      const rise = groundY - controls.target.y
      controls.target.y += rise
      camera.position.y += rise

      tiles.update(controls.target.x, controls.target.z, viewRef.current.distance, BUILD_BUDGET_MS)
      controls.update()
      // Never let the camera dip under the ground.
      const floor = tiles.heightAt(camera.position.x, camera.position.z) + 0.01
      if (camera.position.y < floor) camera.position.y = floor

      // Fog hides the edge of the loaded ring, measured from the focus.
      const reach = viewRef.current.distance * TILE_SIZE
      const cameraDistance = camera.position.distanceTo(controls.target)
      scene.fog.near = cameraDistance + reach * 0.45
      scene.fog.far = cameraDistance + reach * 0.95

      sun.position.copy(controls.target).add(SUN_OFFSET)
      sun.target.position.copy(controls.target)

      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    animate()

    const statusTimer = setInterval(() => {
      setStatus({
        ...tiles.stats(),
        focus: [controls.target.x, controls.target.z],
        ground: controls.target.y,
      })
    }, STATUS_REFRESH_MS)

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(frameId)
      clearInterval(statusTimer)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      tiles.dispose()
      material.dispose()
      controls.dispose()
      mount.removeChild(renderer.domElement)
      renderer.dispose()
      tilesRef.current = null
      grainRef.current = null
    }
  }, [])

  // Shape settings rebuild the tiles; grain is only a shader uniform.
  const { seed, slopes, bumps, warp, pebbles, antHill, grain } = ground
  useEffect(() => {
    tilesRef.current?.setGround({ seed, slopes, bumps, warp, pebbles, antHill })
  }, [seed, slopes, bumps, warp, pebbles, antHill])

  useEffect(() => {
    if (grainRef.current) grainRef.current.uGrain.value = grain / 100
  }, [grain])

  useEffect(() => {
    viewRef.current = view
    tilesRef.current?.setPreview(view.preview)
  }, [view])

  return (
    <div className="voxel-workspace">
      <div className="scene" ref={mountRef} aria-label="Endless forest floor at ant scale" />
      <MapPanel
        ground={ground}
        view={view}
        status={status}
        onGroundChange={(key, value) => setGround((current) => ({ ...current, [key]: value }))}
        onViewChange={(key, value) => setView((current) => ({ ...current, [key]: value }))}
        onReset={() => {
          setGround(DEFAULT_GROUND)
          setView(DEFAULT_VIEW)
        }}
      />
    </div>
  )
}
