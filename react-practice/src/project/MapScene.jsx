import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import MapPanel from './MapPanel'
import { DEFAULT_COVER } from './cover/coverRules'
import { createCoverRenderer, createTrunkRenderer } from './cover/coverRenderer'
import { createFlyAgaric } from './cover/flyAgaric'
import { scatterTile } from './cover/scatterTile'
import { FOREST_COLORS, createForestSky } from './forest/sky'
import { createFarGround, morphRange } from './terrain/farGround'
import { DEFAULT_GROUND } from './terrain/heightField'
import { createGroundMaterial } from './terrain/groundMaterial'
import { createTileManager } from './terrain/tiles'

/**
 * Project > Map: the endless forest floor at real scale (metres), in a dim
 * forest. The camera orbits a focus point on the ground; W A S D slide that
 * point across the world. Detailed tiles stream in around it, a coarse far
 * ground continues to the horizon, and haze in the sky's horizon colour
 * hides where it ends.
 */

// haze and dapple are 0–100 (%).
// distance: tiles loaded around you (detail fades out toward the edge).
const DEFAULT_VIEW = { distance: 4, preview: 'off', haze: 50, dapple: 60 }
// Exponential fog density (per metre) at 0% and 100% haze. At 50% the haze
// is half-way to the sky colour about 3 m away and complete by ~10 m, well
// before the far ground ends.
const HAZE_DENSITY = [0.12, 0.45]
const hazeDensity = (haze) => HAZE_DENSITY[0] + (HAZE_DENSITY[1] - HAZE_DENSITY[0]) * (haze / 100)
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
// Small cover shrinks away just as the ground starts to smooth (m, relative
// to the start of the morph band).
const COVER_FADE = [-0.06, 0.1]

export default function MapScene() {
  const mountRef = useRef(null)
  const tilesRef = useRef(null)
  // Ground shader uniforms (grain, dappled light) and the fog.
  const groundUniformsRef = useRef(null)
  const fogRef = useRef(null)
  const viewRef = useRef(DEFAULT_VIEW)
  const coverRendererRef = useRef(null)
  const flyAgaricRef = useRef(null)
  // What the tile listener needs to scatter a new tile.
  const coverContextRef = useRef({ cover: DEFAULT_COVER, seed: DEFAULT_GROUND.seed })
  const [ground, setGround] = useState(DEFAULT_GROUND)
  const [view, setView] = useState(DEFAULT_VIEW)
  const [cover, setCover] = useState(DEFAULT_COVER)
  const [status, setStatus] = useState({
    loaded: 0,
    pending: 0,
    focus: [START.x, START.z],
    ground: 0,
  })

  useEffect(() => {
    const mount = mountRef.current
    const scene = new THREE.Scene()
    // Haze in the sky's horizon colour, so the far ground melts into the sky.
    scene.background = new THREE.Color(FOREST_COLORS.horizon)
    scene.fog = new THREE.FogExp2(FOREST_COLORS.horizon, hazeDensity(DEFAULT_VIEW.haze))
    fogRef.current = scene.fog
    const sky = createForestSky(SUN_OFFSET)
    scene.add(sky.mesh)

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

    const { material, depthMaterial, farMaterial, uniforms, morphUniforms, holeUniforms } =
      createGroundMaterial(SUN_OFFSET)
    groundUniformsRef.current = uniforms

    // Ground cover follows the tiles: scattered when a tile is built,
    // dropped when it's freed.
    const coverRenderer = createCoverRenderer(scene, morphUniforms)
    coverRendererRef.current = coverRenderer
    const trunkRenderer = createTrunkRenderer(scene)
    const flyAgaric = createFlyAgaric(scene)
    flyAgaricRef.current = flyAgaric
    const tiles = createTileManager(scene, material, depthMaterial, {
      onTileReady: (key, data) => {
        const { cover, seed } = coverContextRef.current
        coverRenderer.setTile(key, scatterTile(data, { cover, seed, trunks: tiles.trunks }))
      },
      onTileRemoved: (key) => coverRenderer.removeTile(key),
    })
    tilesRef.current = tiles
    tiles.setGround(DEFAULT_GROUND)
    const farGround = createFarGround(farMaterial, holeUniforms)
    scene.add(farGround.mesh)

    const startY = tiles.heightAt(START.x, START.z)
    controls.target.set(START.x, startY, START.z)
    camera.position.copy(controls.target).add(CAMERA_OFFSET)

    // Forest light: green-tinted light from the canopy above, a dim brown
    // bounce from the soil, and a warm low sun breaking through.
    scene.add(new THREE.HemisphereLight('#9fb48a', '#3a2c20', 0.6))
    const sun = new THREE.DirectionalLight('#ffd9a0', 1.8)
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

      const distance = viewRef.current.distance
      tiles.update(controls.target.x, controls.target.z, distance, BUILD_BUDGET_MS)
      farGround.update(tiles.sampler, controls.target.x, controls.target.z, distance, tiles.version)
      // Tiles fade from full detail to the smooth surface around you, so they
      // meet the far ground without a seam; this follows you continuously.
      morphUniforms.uMorphCenter.value.set(controls.target.x, controls.target.z)
      const [morphStart, morphEnd] = morphRange(distance)
      morphUniforms.uMorphRange.value.set(morphStart, morphEnd)
      coverRenderer.setFadeRange(morphStart + COVER_FADE[0], morphStart + COVER_FADE[1])
      coverRenderer.sync()
      trunkRenderer.update(tiles.trunks, tiles.sampler, controls.target.x, controls.target.z, tiles.version)
      controls.update()
      // Never let the camera dip under the ground.
      const floor = tiles.heightAt(camera.position.x, camera.position.z) + 0.01
      if (camera.position.y < floor) camera.position.y = floor
      sky.follow(camera)

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
      coverRenderer.dispose()
      trunkRenderer.dispose()
      flyAgaric.dispose()
      coverRendererRef.current = null
      flyAgaricRef.current = null
      farGround.dispose()
      sky.dispose()
      material.dispose()
      farMaterial.dispose()
      depthMaterial.dispose()
      controls.dispose()
      mount.removeChild(renderer.domElement)
      renderer.dispose()
      tilesRef.current = null
      groundUniformsRef.current = null
      fogRef.current = null
    }
  }, [])

  // Shape settings (and trunks) rebuild the tiles, which re-scatter their
  // cover as they finish; grain is only a shader uniform.
  const { seed, slopes, bumps, warp, pebbles, antHill, trunks, trunkSpacing, grain } = ground
  useEffect(() => {
    coverContextRef.current = { ...coverContextRef.current, seed }
    tilesRef.current?.setGround({ seed, slopes, bumps, warp, pebbles, antHill, trunks, trunkSpacing })
  }, [seed, slopes, bumps, warp, pebbles, antHill, trunks, trunkSpacing])

  // The fly agaric stands by the ant hill (only while there is one).
  useEffect(() => {
    flyAgaricRef.current?.place(tilesRef.current?.sampler, seed, cover.flyAgaric && antHill)
  }, [seed, slopes, bumps, warp, pebbles, antHill, cover.flyAgaric])

  // Cover settings only re-scatter the tiles already built (no ground rebuild).
  useEffect(() => {
    coverContextRef.current = { ...coverContextRef.current, cover }
    const tiles = tilesRef.current
    const renderer = coverRendererRef.current
    if (!tiles || !renderer) return
    tiles.forEachTile((key, data) => {
      renderer.setTile(key, scatterTile(data, { cover, seed: coverContextRef.current.seed, trunks: tiles.trunks }))
    })
  }, [cover])

  useEffect(() => {
    if (groundUniformsRef.current) groundUniformsRef.current.uGrain.value = grain / 100
  }, [grain])

  useEffect(() => {
    viewRef.current = view
    tilesRef.current?.setPreview(view.preview)
    if (groundUniformsRef.current) groundUniformsRef.current.uDapple.value = view.dapple / 100
    if (fogRef.current) fogRef.current.density = hazeDensity(view.haze)
  }, [view])

  return (
    <div className="voxel-workspace">
      <div className="scene" ref={mountRef} aria-label="Endless forest floor at ant scale" />
      <MapPanel
        ground={ground}
        view={view}
        cover={cover}
        status={status}
        onGroundChange={(key, value) => setGround((current) => ({ ...current, [key]: value }))}
        onViewChange={(key, value) => setView((current) => ({ ...current, [key]: value }))}
        onCoverChange={(key, value) => setCover((current) => ({ ...current, [key]: value }))}
        onReset={() => {
          setGround(DEFAULT_GROUND)
          setView(DEFAULT_VIEW)
          setCover(DEFAULT_COVER)
        }}
      />
    </div>
  )
}
