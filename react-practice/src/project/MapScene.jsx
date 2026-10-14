import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import MapPanel from './MapPanel'
import { DEFAULT_COVER } from './cover/coverRules'
import { createCoverRenderer, createTrunkRenderer } from './cover/coverRenderer'
import { createFlowerField } from './cover/flowerField'
import { agaricSpot, createFlyAgaric } from './cover/flyAgaric'
import { createLeafField } from './cover/leafField'
import { createMossField } from './cover/mossField'
import { scatterTile } from './cover/scatterTile'
import { FOREST_COLORS, createForestSky } from './forest/sky'
import { DEFAULT_HABITAT, sunDirectionOf } from './habitat/habitatFields'
import { DEFAULT_PATHS, createAntTrail } from './paths/antTrail'
import { createExclusions } from './paths/exclusionZones'
import SimulationPanel from './simulation/SimulationPanel'
import { createAmbientLife } from './simulation/ambientLife'
import { HeightFog, installHeightFog } from './simulation/heightFog'
import { createRain } from './simulation/rain'
import { DEFAULT_WEATHER } from './simulation/weather'
import { DEFAULT_SEASON } from './simulation/season'
import { DEFAULT_DAY } from './simulation/dayCycle'
import { createSimulation } from './simulation/simulation'
import { createFarGround, morphRange } from './terrain/farGround'
import { DEFAULT_GROUND } from './terrain/heightField'
import { createGroundMaterial } from './terrain/groundMaterial'
import { createTileManager } from './terrain/tiles'
import Embodiment from './viewpoints/Embodiment'
import ViewAsPanel from './viewpoints/ViewAsPanel'
import { createAirLayer } from './viewpoints/airLayer'
import { createAntWorld } from './viewpoints/antWorld'
import { createBodies } from './viewpoints/bodies'
import { createViewController } from './viewpoints/viewController'
import { createViewEffects } from './viewpoints/viewEffects'
import { DEFAULT_PERCEPTION_SETTINGS, VIEWPOINTS, summaryOf } from './viewpoints/viewpointConfig'
import { createWorldQueries } from './viewpoints/worldQueries'
import './viewpoints/viewpoints.css'

/**
 * Project > Map: the endless forest floor at real scale (metres), in a dim
 * forest, seen with a free camera or through a body (VIEW AS: free,
 * butterfly, ant). The viewpoint controller (viewpoints/) owns the camera
 * and the viewer; detailed tiles stream in around the ground you're looking at, a
 * coarse far ground continues to the horizon, and haze in the sky's horizon
 * colour hides where it ends. Switching bodies never touches the world:
 * the same tiles, cover, and landmarks are seen through a different camera,
 * movement, and vision.
 */

// haze and dapple are 0–100 (%).
// distance: tiles loaded around you (detail fades out toward the edge).
const DEFAULT_VIEW = { distance: 4, preview: 'off', haze: 50, dapple: 60 }
// Exponential fog density (per metre) at 0% and 100% haze. At 50% the haze
// is half-way to the sky colour about 3 m away and complete by ~10 m, well
// before the far ground ends. Each viewpoint scales it (viewpointConfig.js).
const HAZE_DENSITY = [0.12, 0.45]
const hazeDensity = (haze) => HAZE_DENSITY[0] + (HAZE_DENSITY[1] - HAZE_DENSITY[0]) * (haze / 100)
// Start with the free camera looking at the ant hill (at the world origin)
// and the fly agaric from 65 cm away.
const START_VIEW = 'free'
const START = { distance: 0.65, yaw: 0, pitch: -0.7 }
// The sun sits this far (m) from the area you see, toward the habitat's sun
// direction; shadows only cover the area near it (the half-size comes from
// the viewpoint; the sun moves back to match).
const SUN_DISTANCE = 1.5
// Habitat, ground-cover and path changes wait until the controls have been
// still this long (ms).
const SETTLE_MS = 300
// How long Paths > Show exclusion zones paints them (ms).
const ZONE_FLASH_MS = 5000
const SHADOW_BASE = { reach: 0.6, far: 4 }
const BUILD_BUDGET_MS = 6
const STATUS_REFRESH_MS = 250
const MAX_FRAME = 0.1
// Small cover shrinks away just as the ground starts to smooth (m, relative
// to the start of the morph band).
const COVER_FADE = [-0.06, 0.1]

// Fog that thins with height (the simulation's ground mist).
installHeightFog()

const isTyping = (event) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const sunScaleFor = (reach) => Math.max(1, (reach / SHADOW_BASE.reach) * 1.5)
// Settings with just these keys put back to their defaults (the panel's
// per-tab and per-element resets).
const withDefaults = (current, defaults, keys) => ({
  ...current,
  ...Object.fromEntries(keys.map((key) => [key, defaults[key]])),
})
const sunOffsetOf = (habitat, out = new THREE.Vector3()) =>
  out.fromArray(sunDirectionOf(habitat)).multiplyScalar(SUN_DISTANCE)

/** `value`, but only once it has stopped changing for `delay` ms. */
function useDebounced(value, delay) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return settled
}

export default function MapScene() {
  const mountRef = useRef(null)
  const tilesRef = useRef(null)
  // Ground shader uniforms (grain, dappled light).
  const groundUniformsRef = useRef(null)
  const viewRef = useRef(DEFAULT_VIEW)
  const flyAgaricRef = useRef(null)
  const antWorldRef = useRef(null)
  const farGroundRef = useRef(null)
  // Where the sun light sits relative to the area you see.
  const sunOffsetRef = useRef(sunOffsetOf(DEFAULT_HABITAT))
  const controllerRef = useRef(null)
  const overlayRef = useRef(null)
  // What the tile listener needs to scatter a new tile (moss, flowers: the
  // moss patch and flower colony fields, built from the settled settings
  // below).
  const coverContextRef = useRef({
    cover: DEFAULT_COVER,
    seed: DEFAULT_GROUND.seed,
    moss: null,
    flowers: null,
    leaves: null,
    exclusions: null,
    landmarks: null,
  })
  const [ground, setGround] = useState(DEFAULT_GROUND)
  const [view, setView] = useState(DEFAULT_VIEW)
  // Cover controls update instantly; tiles re-scatter once they settle.
  const [cover, setCover] = useState(DEFAULT_COVER)
  const settledCover = useDebounced(cover, SETTLE_MS)
  // Habitat controls update instantly; the world follows once they settle.
  const [habitat, setHabitat] = useState(DEFAULT_HABITAT)
  const settledHabitat = useDebounced(habitat, SETTLE_MS)
  // Paths: the trail and exclusion zones follow once the controls settle;
  // pheromones change at once.
  const [paths, setPaths] = useState(DEFAULT_PATHS)
  const settledPaths = useDebounced(paths, SETTLE_MS)
  // Show exclusion zones: paints them for a few seconds (a counter, so a
  // second press restarts the timer).
  const [zoneFlash, setZoneFlash] = useState(0)
  // Simulation: settings here; the clock and its effects run in the frame
  // loop (simulationRef), and simStatus is its snapshot for the panel.
  const simulationRef = useRef(null)
  const [simSettings, setSimSettings] = useState({ day: DEFAULT_DAY, weather: DEFAULT_WEATHER, season: DEFAULT_SEASON })
  const [simStatus, setSimStatus] = useState({
    running: false,
    blend: 0,
    time: DEFAULT_DAY.time,
    sunAzimuth: 0,
    sunElevation: 0,
    air: 0,
    surface: 0,
    butterflies: 0,
    ants: 0,
    cloud: 0,
    rain: 0,
    wetness: 0,
    fog: 0,
    rainEnded: false,
    season: null,
    sunrise: DEFAULT_DAY.sunrise,
    sunset: DEFAULT_DAY.sunset,
  })
  const [status, setStatus] = useState({
    loaded: 0,
    pending: 0,
    focus: [0, 0],
    ground: 0,
  })
  const [viewUi, setViewUi] = useState({
    id: START_VIEW,
    target: null,
    busy: false,
    bodyView: false,
    nearTunnel: false,
    following: false,
    scentNearby: false,
    label: '',
    labelId: 0,
    hint: '',
    hintId: 0,
  })
  const [perception, setPerception] = useState(() => ({
    ...DEFAULT_PERCEPTION_SETTINGS,
    reducedMotion: prefersReducedMotion(),
  }))

  useEffect(() => {
    const mount = mountRef.current
    const scene = new THREE.Scene()
    // Haze in the sky's horizon colour, so the far ground melts into the sky.
    scene.background = new THREE.Color(FOREST_COLORS.horizon)
    scene.fog = new HeightFog(FOREST_COLORS.horizon)
    scene.fog.set(hazeDensity(DEFAULT_VIEW.haze), 0, 0.3)
    const sky = createForestSky(sunOffsetRef.current)
    scene.add(sky.mesh)

    // Millimetres to metres in one view: a logarithmic depth buffer keeps
    // near and far surfaces from flickering.
    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    mount.appendChild(renderer.domElement)

    const startConfig = VIEWPOINTS[START_VIEW]
    const camera = new THREE.PerspectiveCamera(
      startConfig.camera.fov,
      mount.clientWidth / mount.clientHeight,
      startConfig.camera.near,
      startConfig.camera.far
    )
    // Vision effects (one full-screen pass, skipped when unused).
    const effects = createViewEffects(renderer)
    effects.setSize(mount.clientWidth, mount.clientHeight, renderer.getPixelRatio())

    const { material, depthMaterial, farMaterial, uniforms, morphUniforms, holeUniforms } =
      createGroundMaterial(sunOffsetRef.current)
    groundUniformsRef.current = uniforms

    // Ground cover follows the tiles: scattered when a tile is built,
    // dropped when it's freed.
    const coverRenderer = createCoverRenderer(scene, morphUniforms)
    const trunkRenderer = createTrunkRenderer(scene)
    const flyAgaric = createFlyAgaric(scene)
    flyAgaricRef.current = flyAgaric
    // The cover the scene draws is also what bodies collide with and climb.
    let world = null
    let builds = 0
    const tiles = createTileManager(scene, material, depthMaterial, {
      onTileReady: (key, data) => {
        const { cover, seed, moss, flowers, leaves, exclusions, landmarks } = coverContextRef.current
        const items = scatterTile(data, { cover, seed, moss, flowers, leaves, exclusions, landmarks, trunks: tiles.trunks })
        coverRenderer.setTile(key, items)
        world.setTile(key, items)
        builds += 1
      },
      onTileRemoved: (key) => {
        coverRenderer.removeTile(key)
        world.removeTile(key)
      },
    })
    tilesRef.current = tiles
    tiles.setGround(DEFAULT_GROUND)
    world = createWorldQueries(tiles, () => (flyAgaric.group.visible ? flyAgaric.group.position : null))
    const farGround = createFarGround(farMaterial, holeUniforms)
    farGroundRef.current = farGround
    scene.add(farGround.mesh)

    // Shared by every viewpoint and created once: the ants' tunnels and
    // scent trails, the air (spores, currents), and the three bodies.
    const antWorld = createAntWorld(scene, morphUniforms)
    antWorldRef.current = antWorld
    const airLayer = createAirLayer(scene)
    // The simulation's clock and the life it brings (butterflies, ants).
    const simulation = createSimulation()
    simulationRef.current = simulation
    const ambientLife = createAmbientLife(scene)
    const rain = createRain(scene)
    const staticSun = new THREE.Vector3()
    const bodies = createBodies(scene)

    let latestFrame = null
    const spot = flyAgaric.spot(DEFAULT_GROUND.seed)
    const controller = createViewController({
      camera,
      world,
      bodies,
      antWorld,
      start: {
        id: START_VIEW,
        x: spot.x / 2,
        z: spot.z / 2,
        ...START,
      },
      hooks: {
        onUi: setViewUi,
        capture: () => {
          if (latestFrame) effects.capture(scene, camera, latestFrame.effects, { dark: latestFrame.dark })
        },
      },
    })
    controllerRef.current = controller

    // Forest light: green-tinted light from the canopy above, a dim brown
    // bounce from the soil, and a warm low sun breaking through.
    const hemisphere = new THREE.HemisphereLight('#9fb48a', '#3a2c20', 0.6)
    scene.add(hemisphere)
    const sun = new THREE.DirectionalLight('#ffd9a0', 1.8)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.00005
    sun.shadow.normalBias = 0.0004
    sun.shadow.camera.near = 0.05
    scene.add(sun, sun.target)
    // The shadow box covers what this body sees; a taller body needs a
    // bigger box and the sun further back.
    let shadowReach = 0
    const setShadowReach = (reach) => {
      if (Math.abs(reach - shadowReach) < 1e-3) return
      shadowReach = reach
      Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach })
      sun.shadow.camera.far = SHADOW_BASE.far * sunScaleFor(reach)
      sun.shadow.camera.updateProjectionMatrix()
    }

    // Keys: the controller decides what they mean for the current body.
    const onKeyDown = (event) => {
      if (isTyping(event)) return
      // Space or Enter on a focused button presses that button.
      const onControl = ['BUTTON', 'SUMMARY', 'A'].includes(event.target.tagName)
      if (onControl && (event.code === 'Space' || event.code === 'Enter')) return
      const scrolls = event.code === 'Space' || event.code.startsWith('Arrow')
      if (event.repeat) {
        if (scrolls) event.preventDefault()
        return
      }
      if (controller.key(event.code, true) && scrolls) event.preventDefault()
    }
    const onKeyUp = (event) => controller.key(event.code, false)
    const onBlur = () => controller.input.clear()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    // Drag to look / orbit; right-drag or Shift+drag pans (free view).
    const canvas = renderer.domElement
    let dragPointer = null
    let dragPan = false
    let dragLast = { x: 0, y: 0 }
    const onPointerDown = (event) => {
      if (dragPointer !== null || (event.button !== 0 && event.button !== 2)) return
      dragPointer = event.pointerId
      dragPan = event.button === 2 || event.shiftKey
      dragLast = { x: event.clientX, y: event.clientY }
      canvas.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event) => {
      if (event.pointerId !== dragPointer) return
      const dx = event.clientX - dragLast.x
      const dy = event.clientY - dragLast.y
      if (dragPan) controller.input.pan(dx, dy)
      else controller.input.drag(dx, dy)
      dragLast = { x: event.clientX, y: event.clientY }
    }
    const onContextMenu = (event) => event.preventDefault()
    canvas.addEventListener('contextmenu', onContextMenu)
    const onPointerUp = (event) => {
      if (event.pointerId === dragPointer) dragPointer = null
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    // Zoom with the wheel (the free camera); double-click re-centres it.
    const onWheel = (event) => {
      event.preventDefault()
      controller.input.zoom(event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY)
    }
    const onDoubleClick = (event) => {
      const rect = canvas.getBoundingClientRect()
      controller.focusAt(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('dblclick', onDoubleClick)

    // Once the first tiles exist, compile every shader for both outputs
    // (screen and the effects pass), with the hidden bodies and layers
    // shown for a moment, so switching viewpoints never stalls on it.
    let warmed = false
    const warmUp = () => {
      const hidden = [...bodies.groups, ...antWorld.meshes, ...airLayer.meshes, ...ambientLife.meshes, ...rain.meshes].filter(
        (object) => !object.visible
      )
      for (const object of hidden) object.visible = true
      effects.warmUp(scene, camera)
      for (const object of hidden) object.visible = false
      warmed = true
    }

    // Body cues: CSS variables on the overlay, written only when they change.
    const overlay = { presence: -1, turn: -1 }
    const writeOverlay = (embodiment) => {
      const element = overlayRef.current
      if (!element) return
      const values = {
        presence: embodiment.presence,
        turn: embodiment.turn,
      }
      for (const [key, value] of Object.entries(values)) {
        if (Math.abs(overlay[key] - value) < 0.004) continue
        overlay[key] = value
        element.style.setProperty(`--${key}`, value.toFixed(3))
        if (key === 'turn') element.style.setProperty('--turn-abs', Math.min(Math.abs(value), 1).toFixed(3))
      }
    }

    const agaricTop = new THREE.Vector3()
    let holeRadius = 0
    let lastTime = performance.now()
    let time = 0
    let frameId
    const animate = () => {
      const now = performance.now()
      const delta = Math.min((now - lastTime) / 1000, MAX_FRAME)
      lastTime = now
      time += delta

      const frame = controller.update(delta)
      latestFrame = frame
      const { anchor, params } = frame

      // Detail rings: the Detail distance setting plus what this viewpoint
      // adds (the butterfly sees much further than the ant). Near tiles are
      // full detail, middle tiles simplified; the far ground starts after.
      const detail = viewRef.current.distance
      const rings = { near: detail + frame.lod.near, outer: detail + frame.lod.middle }
      const distance = rings.outer
      tiles.update(anchor.x, anchor.z, rings, BUILD_BUDGET_MS)
      if (farGround.update(tiles.sampler, tiles.habitat, anchor.x, anchor.z, distance, tiles.habitatKey)) {
        holeRadius = holeUniforms.uHoleRadius.value
      }
      // While tiles are still building (e.g. right after switching body),
      // don't cut the hole: the far ground, sunk below the tiles, fills in.
      holeUniforms.uHoleRadius.value = tiles.stats().pending > 0 ? 0 : holeRadius
      // At the outer ring's edge tiles fade to the smooth surface (and small
      // cover shrinks away), so they meet the far ground without a seam.
      morphUniforms.uMorphCenter.value.set(anchor.x, anchor.z)
      const [morphStart, morphEnd] = morphRange(distance)
      morphUniforms.uMorphRange.value.set(morphStart, morphEnd)
      coverRenderer.setFadeRange(morphStart + COVER_FADE[0], morphStart + COVER_FADE[1])
      coverRenderer.setUV(params.perception.uv)
      coverRenderer.sync()
      trunkRenderer.update(tiles.trunks, tiles.sampler, anchor.x, anchor.z, tiles.version)
      sky.follow(camera)

      // Each body sees the same haze over a different range (higher eyes
      // see further, so the end of the world stays hidden).
      const haze = Math.max(hazeDensity(viewRef.current.haze) * params.hazeScale, params.hazeMin)
      antWorld.update({
        scent: params.perception.scent,
        time,
        near: frame.nearEntrance ?? -1,
        fadeStart: morphStart + COVER_FADE[0],
        fadeEnd: morphStart + COVER_FADE[1],
      })
      if (flyAgaric.group.visible) agaricTop.copy(flyAgaric.group.position).setY(flyAgaric.group.position.y + 0.12)
      airLayer.update({
        time,
        center: anchor,
        agaric: flyAgaric.group.visible ? agaricTop : null,
        perception: params.perception,
        pixels: canvas.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)),
      })

      // The light: the Habitat tab's sun, or the simulation's sun and moon,
      // sky and fog colours, flowers opening, and the life it brings.
      staticSun.copy(sunOffsetRef.current).normalize()
      const env = simulation.update(delta, staticSun)
      sun.color.copy(env.lightColor)
      sun.intensity = env.lightIntensity
      hemisphere.color.copy(env.hemiSky)
      hemisphere.groundColor.copy(env.hemiGround)
      hemisphere.intensity = env.hemiIntensity
      uniforms.uSunDirection.value.copy(env.sunDirection)
      uniforms.uDapple.value = (viewRef.current.dapple / 100) * env.dapple
      sky.setSunDirection(env.sunDirection)
      sky.setColors(env.sky)
      scene.background.copy(env.sky.horizon)
      scene.fog.color.copy(env.sky.horizon)
      coverRenderer.setFlowerOpen(env.flowerOpen)
      // Weather: haze and ground mist, wet ground and cover, wind, rain.
      scene.fog.set(haze * env.haze, env.mist, env.mistHeight)
      uniforms.uWet.value = env.wetness
      coverRenderer.setWeather({ wind: env.wind, wet: env.wetness, time })
      // Season: how much of each kind shows, and the leaves' autumn share
      // (the Scatter setting, blended toward the season's).
      const baseAutumn = coverContextRef.current.cover.leaves.autumn / 100
      coverRenderer.setSeason({
        ...env.levels,
        autumn: baseAutumn + (env.autumn.value - baseAutumn) * env.autumn.weight,
      })
      world.setPresence(env.levels)
      const pixels = canvas.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
      rain.update({
        time,
        intensity: env.rain,
        camera,
        ground: tiles.heightAt(camera.position.x, camera.position.z),
        wind: [env.windDirection[0] * env.wind, env.windDirection[1] * env.wind],
        light: Math.min(env.lightIntensity / 1.8 + env.hemiIntensity, 1),
        pixels,
      })
      ambientLife.update({
        dt: delta,
        time,
        activity: { butterflies: env.butterflies, ants: env.ants },
        anchor,
        sampler: tiles.sampler,
        trails: antWorld.trails,
        flowers: (x, z) =>
          coverContextRef.current.cover.flowers.on ? coverContextRef.current.flowers?.coloniesIn(x - 1, z - 1, x + 1, z + 1) : [],
      })

      setShadowReach(params.shadowReach)
      sun.target.position.set(frame.shadowCenter.x, anchor.y, frame.shadowCenter.y)
      sun.position
        .copy(sun.target.position)
        .addScaledVector(env.sunDirection, SUN_DISTANCE * sunScaleFor(params.shadowReach))

      if (!warmed && tiles.stats().loaded > 0) warmUp()
      effects.render(scene, camera, frame.effects, { prevMix: frame.prevMix, dark: frame.dark })
      writeOverlay(frame.embodiment)
      frameId = requestAnimationFrame(animate)
    }
    animate()

    const statusTimer = setInterval(() => {
      const viewer = latestFrame?.viewer ?? camera.position
      setStatus({
        ...tiles.stats(),
        focus: [viewer.x, viewer.z],
        ground: tiles.heightAt(viewer.x, viewer.z),
      })
      setSimStatus(simulation.snapshot())
    }, STATUS_REFRESH_MS)

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      effects.setSize(mount.clientWidth, mount.clientHeight, renderer.getPixelRatio())
    }
    window.addEventListener('resize', onResize)

    // For checks during development: the controller and how many tiles
    // have been built (switching viewpoints must not build any).
    if (import.meta.env.DEV) {
      window.__umwelt = { controller, tiles, builds: () => builds, coverRenderer, flyAgaric, antWorld, camera, bodies, uniforms, simulation, ambientLife, sun, hemisphere }
    }

    return () => {
      cancelAnimationFrame(frameId)
      clearInterval(statusTimer)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContextMenu)
      canvas.removeEventListener('dblclick', onDoubleClick)
      if (import.meta.env.DEV) delete window.__umwelt
      controllerRef.current = null
      antWorld.dispose()
      airLayer.dispose()
      ambientLife.dispose()
      rain.dispose()
      simulationRef.current = null
      bodies.dispose()
      effects.dispose()
      antWorldRef.current = null
      farGroundRef.current = null
      tiles.dispose()
      coverRenderer.dispose()
      trunkRenderer.dispose()
      flyAgaric.dispose()
      flyAgaricRef.current = null
      farGround.dispose()
      sky.dispose()
      material.dispose()
      farMaterial.dispose()
      depthMaterial.dispose()
      mount.removeChild(renderer.domElement)
      renderer.dispose()
      tilesRef.current = null
      groundUniformsRef.current = null
    }
  }, [])

  // Shape settings (and trunks) rebuild the tiles, which re-scatter their
  // cover as they finish; grain is only a shader uniform.
  const { seed, slopes, bumps, warp, pebbles, antHill, trunks, trunkSpacing, grain } = ground
  // The ant trail (part of the ground: it presses the soil down) and the
  // exclusion zones, from the settled Paths settings.
  const agaricShown = cover.flyAgaric && antHill
  const { showTrail, trailWidth, trailCurvature, trailDarkness, compression, clearing, detail } = settledPaths
  const antTrail = useMemo(
    () =>
      createAntTrail({
        seed,
        paths: { showTrail, trailWidth, trailCurvature, trailDarkness, compression, clearing, detail },
        antHill,
        agaric: agaricShown,
      }),
    [seed, antHill, agaricShown, showTrail, trailWidth, trailCurvature, trailDarkness, compression, clearing, detail]
  )
  const { antHillClearance, agaricClearance, spawnClearance, trailClearance, interactionClearance, softEdge } =
    settledPaths
  const exclusions = useMemo(
    () =>
      createExclusions({
        paths: { antHillClearance, agaricClearance, spawnClearance, trailClearance, interactionClearance, softEdge },
        seed,
        antHill,
        agaric: agaricShown,
        trail: antTrail,
      }),
    [antHillClearance, agaricClearance, spawnClearance, trailClearance, interactionClearance, softEdge, seed, antHill, agaricShown, antTrail]
  )
  useEffect(() => {
    tilesRef.current?.setGround({ seed, slopes, bumps, warp, pebbles, antHill, trunks, trunkSpacing, trail: antTrail })
  }, [seed, slopes, bumps, warp, pebbles, antHill, trunks, trunkSpacing, antTrail])

  // The fly agaric stands by the ant hill (only while there is one), and
  // the ants' tunnels and trails lead out from the hill to it and to food.
  useEffect(() => {
    const tiles = tilesRef.current
    const flyAgaric = flyAgaricRef.current
    flyAgaric?.place(tiles?.sampler, seed, cover.flyAgaric && antHill)
    antWorldRef.current?.place({
      sampler: tiles?.sampler,
      trunks: tiles?.trunks,
      seed,
      antHill,
      agaric: flyAgaric?.group.visible ? flyAgaric.spot(seed) : null,
      antTrail,
    })
  }, [seed, slopes, bumps, warp, pebbles, antHill, trunks, trunkSpacing, cover.flyAgaric, antTrail])

  // Pheromone settings change at once (no rebuild of the ground).
  const { showPheromones, pheromoneIntensity, pheromoneWidth } = paths
  useEffect(() => {
    antWorldRef.current?.setPheromones({
      show: showPheromones,
      intensity: pheromoneIntensity / 100,
      width: pheromoneWidth / 100,
    })
  }, [showPheromones, pheromoneIntensity, pheromoneWidth])

  useEffect(() => {
    if (groundUniformsRef.current) groundUniformsRef.current.uGrain.value = grain / 100
  }, [grain])

  // Habitat fields follow the settled controls (loaded tiles refresh over a
  // few frames, nearest first).
  useEffect(() => {
    tilesRef.current?.setHabitat(settledHabitat)
  }, [settledHabitat])

  // Settled cover settings (and any ground, habitat or exclusion-zone
  // change) rebuild the moss patch and flower colony fields, then loaded
  // tiles re-scatter over a few frames (no ground rebuild). Declared after
  // the ground and habitat effects, so it sees their new fields.
  useEffect(() => {
    const tiles = tilesRef.current
    if (!tiles?.habitat) return
    const moss = createMossField(settledCover.moss, { habitat: tiles.habitat, sampler: tiles.sampler, seed })
    const flowers = createFlowerField(settledCover.flowers, { habitat: tiles.habitat, seed })
    const leaves = createLeafField(settledCover.leaves, { seed, windDirection: settledHabitat.windDirection })
    // Landmarks leaves pile against.
    const landmarks = { antHill, agaric: agaricShown ? agaricSpot(seed) : null }
    coverContextRef.current = { cover: settledCover, seed, moss, flowers, leaves, exclusions, landmarks }
    farGroundRef.current?.setCover(settledCover, moss, flowers)
    tiles.setExclusions(exclusions)
    tiles.refreshCover()
  }, [settledCover, settledHabitat, seed, slopes, bumps, warp, pebbles, antHill, agaricShown, trunks, trunkSpacing, exclusions])

  // Show exclusion zones: back to the chosen preview after a few seconds.
  useEffect(() => {
    if (!zoneFlash) return undefined
    const timer = setTimeout(() => setZoneFlash(0), ZONE_FLASH_MS)
    return () => clearTimeout(timer)
  }, [zoneFlash])

  // The Habitat tab's sun is the visible sun whenever the simulation isn't
  // running (the frame loop applies it to the light, sky and dappling).
  const { sunDirection, sunElevation } = habitat
  useEffect(() => {
    sunOffsetOf({ sunDirection, sunElevation }, sunOffsetRef.current)
  }, [sunDirection, sunElevation])

  useEffect(() => {
    simulationRef.current?.setSettings(simSettings)
  }, [simSettings])

  // Haze is applied every frame (each body scales it), from viewRef.
  useEffect(() => {
    viewRef.current = view
    tilesRef.current?.setPreview(zoneFlash ? 'exclusion' : view.preview)
  }, [view, zoneFlash])

  useEffect(() => {
    controllerRef.current?.setSettings(perception)
  }, [perception])

  // Follow the system's reduced-motion setting when it changes.
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setPerception((current) => ({ ...current, reducedMotion: query.matches }))
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const viewpoint = VIEWPOINTS[viewUi.id]

  return (
    <div className="voxel-workspace">
      <div
        className="scene map-scene"
        ref={mountRef}
        role="img"
        aria-label={
          viewpoint.body
            ? `Forest floor seen as a ${viewpoint.label.toLowerCase()}, ${summaryOf(viewpoint).toLowerCase()}`
            : `Forest floor, free view: drag to orbit, right-drag to pan, scroll to zoom`
        }
      />
      <div className="scene map-overlays" style={{ pointerEvents: 'none' }}>
        <Embodiment ref={overlayRef} id={viewUi.id} motion={perception.motionEffects} />
        {viewUi.label && (
          <div key={viewUi.labelId} className="view-label" aria-hidden="true">
            {viewUi.label}
          </div>
        )}
        {viewUi.hint && (
          <div key={`hint-${viewUi.hintId}`} className="view-hint" aria-hidden="true">
            {viewUi.hint}
          </div>
        )}
      </div>
      <p className="view-sr-only" aria-live="polite">
        {viewUi.label}
        {viewUi.hint ? `. ${viewUi.hint}` : ''}
      </p>
      <div className="map-left-column">
        <ViewAsPanel
          ui={viewUi}
          settings={perception}
          onSelect={(id) => controllerRef.current?.select(id)}
          onViewBody={() => controllerRef.current?.viewBody()}
          onSettingChange={(key, value) => setPerception((current) => ({ ...current, [key]: value }))}
        />
        <SimulationPanel
          settings={simSettings}
          status={simStatus}
          onChange={(group, value) => setSimSettings((current) => ({ ...current, [group]: value }))}
          onStart={() => {
            simulationRef.current?.start()
            setSimStatus((current) => ({ ...current, running: true }))
          }}
          onEnd={() => {
            simulationRef.current?.end()
            setSimStatus((current) => ({ ...current, running: false }))
          }}
          onTime={(hours) => {
            simulationRef.current?.setTime(hours)
            setSimStatus((current) => ({ ...current, time: hours }))
          }}
        />
      </div>
      <MapPanel
        ground={ground}
        view={view}
        cover={cover}
        habitat={habitat}
        habitatSettling={habitat !== settledHabitat || status.refreshing > 0}
        coverSettling={cover !== settledCover || status.refreshing > 0}
        paths={paths}
        pathsSettling={paths !== settledPaths || status.refreshing > 0 || status.pending > 0}
        zonesShowing={zoneFlash > 0}
        onPathsChange={(key, value) => setPaths((current) => ({ ...current, [key]: value }))}
        onShowZones={() => setZoneFlash((count) => count + 1)}
        status={status}
        onGroundChange={(key, value) => setGround((current) => ({ ...current, [key]: value }))}
        onViewChange={(key, value) => setView((current) => ({ ...current, [key]: value }))}
        onCoverChange={(key, value) => setCover((current) => ({ ...current, [key]: value }))}
        onHabitatChange={(key, value) => setHabitat((current) => ({ ...current, [key]: value }))}
        onResetKeys={({ ground: groundKeys, view: viewKeys, cover: coverKeys, habitat: habitatKeys, paths: pathKeys }) => {
          if (groundKeys) setGround((current) => withDefaults(current, DEFAULT_GROUND, groundKeys))
          if (viewKeys) setView((current) => withDefaults(current, DEFAULT_VIEW, viewKeys))
          if (coverKeys) setCover((current) => withDefaults(current, DEFAULT_COVER, coverKeys))
          if (habitatKeys) setHabitat((current) => withDefaults(current, DEFAULT_HABITAT, habitatKeys))
          if (pathKeys) setPaths((current) => withDefaults(current, DEFAULT_PATHS, pathKeys))
        }}
        onReset={() => {
          setGround(DEFAULT_GROUND)
          setView(DEFAULT_VIEW)
          setCover(DEFAULT_COVER)
          setHabitat(DEFAULT_HABITAT)
          setPaths(DEFAULT_PATHS)
        }}
      />
    </div>
  )
}
